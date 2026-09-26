import { db, commercialTasks, mediaCleanupJobs, projectAssets, projectVersions, projects, referenceVideos, sceneVersions, videoScenes, workflowJobs } from "@/lib/db";
import { reserveCommercialTask, settleCommercialTask, settleCommercialTaskInTransaction } from "@/lib/billing/commercial-wallet";
import { PRICING_VERSION } from "@/lib/billing/pricing-v6";
import type { FfmpegSceneAsset } from "@/lib/ffmpeg-worker/client";
import { extractR2Key } from "@/lib/cloudflare/r2";
import { processMediaCleanupJobs } from "./media-cleanup";
import { routeModel } from "@/lib/ai/model-registry";
import type { BackgroundMusicRecognition } from "@/lib/workflow/music-recognition";
import {
  analyzeSceneBlueprint,
  buildStructuredVideoOverview,
  remixSceneBlueprint,
  rewriteSceneBlueprint,
  type AiModelSelection,
  type SceneBlueprintDraft,
} from "@/lib/workflow/scene-analysis";
import { and, asc, desc, eq, sql } from "drizzle-orm";

export type { SceneBlueprintDraft } from "@/lib/workflow/scene-analysis";

function sceneVersionToBlueprint(scene: typeof sceneVersions.$inferSelect): SceneBlueprintDraft {
  return {
    story: scene.story as Record<string, unknown>,
    visual: scene.visual as Record<string, unknown>,
    dialogue: Array.isArray(scene.dialogue) ? scene.dialogue : [],
    narration: Array.isArray(scene.narration) ? scene.narration : [],
    subtitle: Array.isArray(scene.subtitle) ? scene.subtitle : [],
    audio: scene.audio as Record<string, unknown>,
    transition: scene.transition as Record<string, unknown>,
    generationPrompt: scene.generationPrompt,
    metadata: scene.metadata as Record<string, unknown>,
  };
}

function sceneAssetFromRecords(scene: typeof videoScenes.$inferSelect): FfmpegSceneAsset {
  return {
    sceneIndex: scene.sceneIndex,
    startTime: scene.startTime,
    endTime: scene.endTime,
    duration: scene.duration,
    shotGroupId: scene.shotGroupId || undefined,
    clipUrl: scene.clipUrl || undefined,
    keyframeUrls: Array.isArray(scene.keyframeUrls) ? scene.keyframeUrls as string[] : [],
    audioUrl: scene.audioUrl || undefined,
    transitionIn: scene.transitionIn || undefined,
    transitionOut: scene.transitionOut || undefined,
  };
}


function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function cleanProjectTitle(value: unknown) {
  if (typeof value !== "string") return "";
  const title = value
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^['"“”‘’]+|['"“”‘’.,;:，。；：]+$/g, "")
    .trim();

  if (!title) return "";
  if (/^(reference[- ]driven|video analysis|image analysis|untitled|uploaded reference)/i.test(title)) return "";
  if (/^(single static image|the uploaded reference|use the first scene)/i.test(title)) return "";
  return title.length > 64 ? `${title.slice(0, 61).trim()}...` : title;
}

function firstProjectTitleCandidate(...values: unknown[]) {
  for (const value of values) {
    const title = cleanProjectTitle(value);
    if (title) return title;
  }
  return "";
}

export function deriveProjectTitle(overview: Record<string, unknown>, sceneBlueprints: SceneBlueprintDraft[], fallbackTitle: string) {
  const videoSummary = parseJsonObject(overview.video_summary || overview.videoSummary || overview.summary);
  const firstScene = sceneBlueprints[0];
  const firstVisual = firstScene?.visual || {};
  const firstStory = firstScene?.story || {};

  const directTitle = firstProjectTitleCandidate(
    videoSummary?.title,
    videoSummary?.concept,
    overview.title,
    overview.name,
    firstStory.title,
    firstStory.summary,
    firstVisual.title,
    firstVisual.sceneTitle,
    firstVisual.subject,
  );
  if (directTitle) return directTitle;

  const prompt = cleanProjectTitle(firstScene?.generationPrompt);
  if (prompt) return prompt;

  return cleanProjectTitle(fallbackTitle) || "Untitled video project";
}

function backgroundMusicSummary(value?: BackgroundMusicRecognition) {
  if (!value) return undefined;
  if (value.status === "recognized") {
    return [value.title, value.artist].filter(Boolean).join(" - ") || "Recognized background music";
  }
  if (value.status === "disabled") return "Background music recognition is not enabled.";
  if (value.status === "not_found") return "No matching background music found in the first 12 seconds.";
  return value.error ? `Background music recognition failed: ${value.error}` : "Background music recognition failed.";
}

export function attachBackgroundMusicToBlueprint(blueprint: SceneBlueprintDraft, music?: BackgroundMusicRecognition): SceneBlueprintDraft {
  if (!music || music.status === "disabled") return blueprint;
  return {
    ...blueprint,
    audio: {
      ...blueprint.audio,
      recognizedBgm: music,
      recognizedBgmSummary: backgroundMusicSummary(music),
    },
    metadata: {
      ...(blueprint.metadata || {}),
      backgroundMusicRecognition: music.status,
    },
  };
}


export function buildVideoOverview(sceneCount: number) {
  return {
    theme: "Reference-driven AI video workflow",
    narrative: `The uploaded reference has ${sceneCount} detected scene${sceneCount === 1 ? "" : "s"} prepared as editable blueprint units.`,
    hook: "Use the first scene as the hook unless edited by the user.",
    editingRhythm: "Follow detected scene boundaries and preserve timing during remix.",
    audioStyle: "Dialogue and subtitles are extracted through KIE speech-to-text, then aligned to each detected scene for remix, audio, and edit steps.",
    whyThisWorks: "Scene-level structure lets users remix and generate without copy/paste between tools.",
  };
}

export async function getProjectForUser(projectId: string, userId: string) {
  return db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.userId, userId)),
  });
}

export async function getProjectBundle(projectId: string, userId: string) {
  const project = await getProjectForUser(projectId, userId);
  if (!project) return null;

  const versions = await db.query.projectVersions.findMany({
    where: eq(projectVersions.projectId, projectId),
    orderBy: [asc(projectVersions.versionNumber)],
  });
  const activeVersion =
    versions.find((version) => version.id === project.activeVersionId) || versions[versions.length - 1] || null;
  const scenes = await db.query.videoScenes.findMany({
    where: eq(videoScenes.projectId, projectId),
    orderBy: [asc(videoScenes.sceneIndex)],
  });
  const activeSceneVersionRows = activeVersion
    ? await db.query.sceneVersions.findMany({
        where: eq(sceneVersions.projectVersionId, activeVersion.id),
        orderBy: [asc(sceneVersions.sceneIndex), desc(sceneVersions.createdAt)],
      })
    : [];
  const latestSceneVersionByOriginalScene = new Map<string, typeof sceneVersions.$inferSelect>();
  for (const sceneVersion of activeSceneVersionRows) {
    if (!latestSceneVersionByOriginalScene.has(sceneVersion.originalSceneId)) {
      latestSceneVersionByOriginalScene.set(sceneVersion.originalSceneId, sceneVersion);
    }
  }
  const activeSceneVersions = Array.from(latestSceneVersionByOriginalScene.values()).sort((a, b) => a.sceneIndex - b.sceneIndex);
  const allSceneVersions = await db.query.sceneVersions.findMany({
    where: eq(sceneVersions.projectId, projectId),
    orderBy: [asc(sceneVersions.sceneIndex)],
  });
  const refs = await db.query.referenceVideos.findMany({
    where: eq(referenceVideos.projectId, projectId),
    orderBy: [desc(referenceVideos.createdAt)],
  });
  const jobs = await db.query.workflowJobs.findMany({
    where: eq(workflowJobs.projectId, projectId),
    orderBy: [desc(workflowJobs.createdAt)],
    limit: 20,
  });

  return { project, versions, activeVersion, scenes, sceneVersions: activeSceneVersions, allSceneVersions, referenceVideos: refs, jobs };
}

export async function createProject(userId: string, title: string, description?: string) {
  const [project] = await db
    .insert(projects)
    .values({ userId, title, description, status: "draft" })
    .returning();
  return project;
}

function addR2Key(keys: Set<string>, value: unknown) {
  if (typeof value !== "string" || !value.trim()) return;
  const key = value.includes("://") ? extractR2Key(value) : value.replace(/^\/+/, "");
  if (key) keys.add(key);
}

function addR2KeysFromJsonArray(keys: Set<string>, value: unknown) {
  if (!Array.isArray(value)) return;
  value.forEach((item) => addR2Key(keys, item));
}

async function collectProjectR2Keys(projectId: string, tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) {
  const keys = new Set<string>();
  const [refs, scenes, sceneVersionRows, assets] = await Promise.all([
    tx.query.referenceVideos.findMany({ where: eq(referenceVideos.projectId, projectId) }),
    tx.query.videoScenes.findMany({ where: eq(videoScenes.projectId, projectId) }),
    tx.query.sceneVersions.findMany({ where: eq(sceneVersions.projectId, projectId) }),
    tx.query.projectAssets.findMany({ where: eq(projectAssets.projectId, projectId) }),
  ]);

  refs.forEach((reference) => {
    addR2Key(keys, reference.storageKey);
    addR2Key(keys, reference.sourceUrl);
    const metadata = parseJsonObject(reference.metadata);
    addR2Key(keys, metadata?.audioPreviewUrl);
  });
  scenes.forEach((scene) => {
    addR2Key(keys, scene.clipUrl);
    addR2KeysFromJsonArray(keys, scene.keyframeUrls);
    addR2Key(keys, scene.audioUrl);
  });
  sceneVersionRows.forEach((sceneVersion) => {
    addR2Key(keys, sceneVersion.generatedVideoUrl);
  });
  assets.forEach((asset) => {
    addR2Key(keys, asset.storageKey);
    addR2Key(keys, asset.url);
  });

  return Array.from(keys);
}

export async function deleteProjectForUser(projectId: string, userId: string) {
    const r2Keys = await db.transaction(async (tx) => {
      const [locked] = await tx.select({ id: projects.id }).from(projects).where(and(eq(projects.id, projectId), eq(projects.userId, userId))).for("update");
      if (!locked) throw new Error("Project not found");
      const [pending] = await tx.select({ id: commercialTasks.id }).from(commercialTasks).where(and(eq(commercialTasks.userId, userId), sql`${commercialTasks.input}->>'projectId' = ${projectId}`, sql`${commercialTasks.state} IN ('queued','running','review')`)).limit(1);
      if (pending) throw new Error("An analysis or generation task is still pending. Resolve it before deleting this project.");
      const keys = await collectProjectR2Keys(projectId, tx);
      for (const storageKey of keys) {
        await tx.insert(mediaCleanupJobs).values({ storageKey }).onConflictDoUpdate({ target: mediaCleanupJobs.storageKey, set: { state: "pending", attempts: 0, lastError: null, deletedAt: null, nextAttemptAt: new Date(), updatedAt: new Date() } });
      }
      await tx.delete(projects).where(eq(projects.id, projectId));
      return keys;
    });
    const deletedR2Objects = r2Keys.length ? await processMediaCleanupJobs(r2Keys.length, r2Keys) : 0;
    return { success: true, deletedR2Objects };
}


export async function createRemixVersion(params: {
  userId: string;
  projectId: string;
  sourceVersionId: string;
  remixPrompt: string;
} & AiModelSelection) {
  const project = await getProjectForUser(params.projectId, params.userId);
  if (!project) throw new Error("Project not found");

  const sourceScenes = await db.query.sceneVersions.findMany({
    where: eq(sceneVersions.projectVersionId, params.sourceVersionId),
    orderBy: [asc(sceneVersions.sceneIndex)],
  });
  if (!sourceScenes.length) throw new Error("Source version has no scenes");

  const versions = await db.query.projectVersions.findMany({
    where: eq(projectVersions.projectId, params.projectId),
    orderBy: [desc(projectVersions.versionNumber)],
    limit: 1,
  });
  const nextVersionNumber = (versions[0]?.versionNumber ?? 0) + 1;
  const sourceBlueprints = sourceScenes.map(sceneVersionToBlueprint);
  const remixedBlueprints: SceneBlueprintDraft[] = [];

  const [version] = await db
    .insert(projectVersions)
    .values({
      projectId: params.projectId,
      parentVersionId: params.sourceVersionId,
      versionNumber: nextVersionNumber,
      kind: "remix",
      label: `Remix V${nextVersionNumber}`,
      remixPrompt: params.remixPrompt,
      overview: { ...buildVideoOverview(sourceScenes.length), remixDirection: params.remixPrompt },
    })
    .returning();

  for (let index = 0; index < sourceScenes.length; index += 1) {
    const scene = sourceScenes[index];
    const remixed = await remixSceneBlueprint({
      userId: params.userId,
      scene: sourceBlueprints[index],
      remixPrompt: params.remixPrompt,
      sceneIndex: scene.sceneIndex,
      duration: scene.duration,
      modelMode: params.modelMode,
      modelId: params.modelId,
      modelPriority: params.modelPriority,
      outputLanguage: params.outputLanguage,
    });
    remixedBlueprints.push(remixed);
    await db.insert(sceneVersions).values({
      projectId: params.projectId,
      projectVersionId: version.id,
      originalSceneId: scene.originalSceneId,
      sceneIndex: scene.sceneIndex,
      story: remixed.story,
      visual: remixed.visual,
      dialogue: remixed.dialogue,
      narration: remixed.narration,
      subtitle: remixed.subtitle,
      audio: remixed.audio,
      transition: remixed.transition,
      generationPrompt: remixed.generationPrompt,
      duration: scene.duration,
      metadata: { ...(remixed.metadata || {}), sourceSceneVersionId: scene.id, remixPrompt: params.remixPrompt },
    });
  }

  const overview = await buildStructuredVideoOverview({ userId: params.userId, title: project.title, sceneBlueprints: remixedBlueprints, remixPrompt: params.remixPrompt, modelMode: params.modelMode, modelId: params.modelId, modelPriority: params.modelPriority, outputLanguage: params.outputLanguage, allowPlatformKeyForAnalysis: params.allowPlatformKeyForAnalysis, forceFreeTrialKie: params.forceFreeTrialKie });
  await db.update(projectVersions).set({ overview, updatedAt: new Date() }).where(eq(projectVersions.id, version.id));
  await db.update(projects).set({ activeVersionId: version.id, updatedAt: new Date() }).where(eq(projects.id, params.projectId));
  return getProjectBundle(params.projectId, params.userId);
}

export async function rewriteSceneVersion(params: {
  userId: string;
  projectId: string;
  sceneVersionId: string;
  instruction: string;
  currentPrompt?: string;
  allowPlatformKeyForRewrite?: boolean;
  rewriteKeySource?: "platform" | "user";
  commercialTaskKey?: string;
} & AiModelSelection) {
  const project = await getProjectForUser(params.projectId, params.userId);
  if (!project) throw new Error("Project not found");

  const scene = await db.query.sceneVersions.findFirst({
    where: and(eq(sceneVersions.id, params.sceneVersionId), eq(sceneVersions.projectId, params.projectId)),
  });
  if (!scene) throw new Error("Scene version not found");

  if (params.commercialTaskKey) {
    const reserved = await reserveCommercialTask({
      userId: params.userId, taskKey: params.commercialTaskKey, credits: 0, rewrites: 1,
      quote: { version: PRICING_VERSION, projectId: params.projectId, sceneVersionId: scene.id,
        instruction: params.instruction, currentPrompt: params.currentPrompt ?? scene.generationPrompt,
        outputLanguage: params.outputLanguage ?? "zh", modelId: params.modelId },
    });
    if (!reserved.created) {
      if (reserved.reservation.state === "held") throw new Error("REWRITE_IN_PROGRESS");
      if (reserved.reservation.settledRewrites === 0) throw new Error("REWRITE_PREVIOUSLY_FAILED");
      const result = await db.query.sceneVersions.findFirst({ where: and(
        eq(sceneVersions.projectId, params.projectId),
        sql`${sceneVersions.metadata}->>'commercialTaskKey' = ${params.commercialTaskKey}`,
      ) });
      if (!result) throw new Error("REWRITE_RESULT_UNAVAILABLE");
      return result;
    }
  }

  let rewritten: SceneBlueprintDraft;
  try {
    rewritten = await rewriteSceneBlueprint({
    userId: params.userId,
    scene: { ...sceneVersionToBlueprint(scene), generationPrompt: params.currentPrompt ?? scene.generationPrompt },
    instruction: params.instruction,
    duration: scene.duration,
    sceneIndex: scene.sceneIndex,
    modelMode: params.modelMode,
    modelId: params.modelId,
    modelPriority: params.modelPriority,
    outputLanguage: params.outputLanguage,
    allowPlatformKeyForRewrite: params.allowPlatformKeyForRewrite,
    rewriteKeySource: params.rewriteKeySource,
  });
  } catch (error) {
    if (params.commercialTaskKey) {
      await settleCommercialTask({ userId: params.userId, taskKey: params.commercialTaskKey, credits: 0, rewrites: 0 });
      throw new Error("REWRITE_PROVIDER_FAILED", { cause: error });
    }
    throw error;
  }

  // Persist the successful version and its allowance charge in the same transaction.
  return db.transaction(async (tx) => {
  const [created] = await tx
    .insert(sceneVersions)
    .values({
      projectId: scene.projectId,
      projectVersionId: scene.projectVersionId,
      originalSceneId: scene.originalSceneId,
      sceneIndex: scene.sceneIndex,
      story: rewritten.story,
      visual: rewritten.visual,
      dialogue: rewritten.dialogue,
      narration: rewritten.narration,
      subtitle: rewritten.subtitle,
      audio: rewritten.audio,
      transition: rewritten.transition,
      generationPrompt: rewritten.generationPrompt,
      duration: scene.duration,
      generatedVideoUrl: scene.generatedVideoUrl,
      metadata: {
        ...(rewritten.metadata || {}),
        rewriteInstruction: params.instruction,
        previousSceneVersionId: scene.id,
        versionKind: "rewrite",
        ...(params.commercialTaskKey ? { commercialTaskKey: params.commercialTaskKey } : {}),
      },
    })
    .returning();

  await tx.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, params.projectId));
  if (params.commercialTaskKey) await settleCommercialTaskInTransaction(tx, { userId: params.userId, taskKey: params.commercialTaskKey, credits: 0, rewrites: 1 });

  return created;
  });
}

export async function retrySceneAnalysis(params: {
  userId: string;
  projectId: string;
  sceneVersionId: string;
} & AiModelSelection) {
  const project = await getProjectForUser(params.projectId, params.userId);
  if (!project) throw new Error("Project not found");

  const sceneVersion = await db.query.sceneVersions.findFirst({
    where: and(eq(sceneVersions.id, params.sceneVersionId), eq(sceneVersions.projectId, params.projectId)),
  });
  if (!sceneVersion) throw new Error("Scene version not found");

  const videoScene = await db.query.videoScenes.findFirst({
    where: and(eq(videoScenes.id, sceneVersion.originalSceneId), eq(videoScenes.projectId, params.projectId)),
  });
  if (!videoScene) throw new Error("Original scene not found");

  const [job] = await db.insert(workflowJobs).values({
    projectId: params.projectId,
    sceneId: videoScene.id,
    type: "ANALYZE_SCENE",
    status: "processing",
    input: { retrySceneVersionId: params.sceneVersionId, modelMode: params.modelMode || "auto", modelId: params.modelId, modelPriority: params.modelPriority || "balanced" },
  }).returning();

  const asset = sceneAssetFromRecords(videoScene);
  const blueprint = await analyzeSceneBlueprint({
    userId: params.userId,
    scene: asset,
    context: { sceneCount: 1, projectTitle: project.title },
    analysisKeySource: params.analysisKeySource,
    analysisApiKey: params.analysisApiKey,
    modelMode: params.modelMode,
    modelId: params.modelId,
    modelPriority: params.modelPriority,
    outputLanguage: params.outputLanguage,
    allowPlatformKeyForAnalysis: params.allowPlatformKeyForAnalysis,
    forceFreeTrialKie: params.forceFreeTrialKie,
  });
  const usedFallback = blueprint.metadata?.analysisProvider === "fallback";
  if (params.forceFreeTrialKie && usedFallback) {
    throw new Error(String(blueprint.metadata?.fallbackReason || "Trial analysis failed"));
  }

  const [updated] = await db
    .update(sceneVersions)
    .set({
      story: blueprint.story,
      visual: blueprint.visual,
      dialogue: blueprint.dialogue,
      narration: blueprint.narration,
      subtitle: blueprint.subtitle,
      audio: blueprint.audio,
      transition: blueprint.transition,
      generationPrompt: blueprint.generationPrompt,
      metadata: { ...(blueprint.metadata || {}), retryOfSceneVersionId: params.sceneVersionId },
      updatedAt: new Date(),
    })
    .where(eq(sceneVersions.id, sceneVersion.id))
    .returning();

  await db.update(videoScenes).set({ status: usedFallback ? "failed" : "completed", error: usedFallback ? String(blueprint.metadata?.fallbackReason || "AI analysis fallback used") : null, updatedAt: new Date() }).where(eq(videoScenes.id, videoScene.id));
  await db.update(workflowJobs).set({ status: usedFallback ? "failed" : "completed", error: usedFallback ? String(blueprint.metadata?.fallbackReason || "AI analysis fallback used") : null, output: { provider: blueprint.metadata?.analysisProvider || "unknown" }, completedAt: new Date(), updatedAt: new Date() }).where(eq(workflowJobs.id, job.id));

  return updated;
}

export async function getGenerationModelForScene(duration?: number, aspectRatio?: string) {
  return routeModel({
    category: "video_generation",
    requiredCapabilities: ["text"],
    duration,
    aspectRatio,
    priority: "balanced",
  });
}




