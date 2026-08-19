import { db, projectVersions, projects, referenceVideos, sceneVersions, videoScenes, workflowJobs } from "@/lib/db";
import type { FfmpegSceneAsset } from "@/lib/ffmpeg-worker/client";
import { breakdownVideoWithWorker } from "@/lib/ffmpeg-worker/client";
import { routeModel } from "@/lib/ai/model-registry";
import {
  analyzeSceneBlueprint,
  buildFallbackSceneBlueprint,
  buildStructuredVideoOverview,
  remixSceneBlueprint,
  rewriteSceneBlueprint,
  type SceneBlueprintDraft,
} from "@/lib/workflow/scene-analysis";
import { and, asc, desc, eq } from "drizzle-orm";

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

function textValue(value: unknown) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return String(obj.summary || obj.beat || obj.role || obj.action || "");
  }
  return String(value);
}

export function buildSceneBlueprint(scene: FfmpegSceneAsset): SceneBlueprintDraft {
  return buildFallbackSceneBlueprint(scene);
}

export function buildVideoOverview(sceneCount: number) {
  return {
    theme: "Reference-driven AI video workflow",
    narrative: `The uploaded reference has ${sceneCount} detected scene${sceneCount === 1 ? "" : "s"} prepared as editable blueprint units.`,
    hook: "Use the first scene as the hook unless edited by the user.",
    editingRhythm: "Follow detected scene boundaries and preserve timing during remix.",
    audioStyle: "Dialogue, ambience, SFX, and music are reserved for the audio analysis pass.",
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
  const activeSceneVersions = activeVersion
    ? await db.query.sceneVersions.findMany({
        where: eq(sceneVersions.projectVersionId, activeVersion.id),
        orderBy: [asc(sceneVersions.sceneIndex)],
      })
    : [];
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

export async function runVideoBreakdown(params: {
  userId: string;
  projectId: string;
  mediaUrl: string;
  mediaName?: string;
  storageKey?: string;
}) {
  const project = await getProjectForUser(params.projectId, params.userId);
  if (!project) throw new Error("Project not found");

  const [job] = await db
    .insert(workflowJobs)
    .values({
      projectId: params.projectId,
      type: "ANALYZE_VIDEO",
      status: "processing",
      input: { mediaUrl: params.mediaUrl, mediaName: params.mediaName },
    })
    .returning();

  try {
    await db.update(projects).set({ status: "analyzing", updatedAt: new Date() }).where(eq(projects.id, params.projectId));
    const breakdown = await breakdownVideoWithWorker(params.mediaUrl);
    if (!breakdown.scenes.length) throw new Error("No scenes detected in the uploaded video");

    const [reference] = await db
      .insert(referenceVideos)
      .values({
        projectId: params.projectId,
        sourceUrl: params.mediaUrl,
        storageKey: params.storageKey,
        fileName: params.mediaName,
        duration: breakdown.metadata.duration,
        metadata: breakdown.metadata,
      })
      .returning();

    const [version] = await db
      .insert(projectVersions)
      .values({
        projectId: params.projectId,
        versionNumber: 0,
        kind: "original",
        label: "Original",
        overview: buildVideoOverview(breakdown.scenes.length),
      })
      .returning();

    const insertedBlueprints: SceneBlueprintDraft[] = [];
    const failedScenes: Array<{ sceneIndex: number; error: string }> = [];

    for (const scene of breakdown.scenes) {
      const [videoScene] = await db
        .insert(videoScenes)
        .values({
          projectId: params.projectId,
          referenceVideoId: reference.id,
          sceneIndex: scene.sceneIndex,
          shotGroupId: scene.shotGroupId,
          startTime: scene.startTime,
          endTime: scene.endTime,
          duration: scene.duration,
          clipUrl: scene.clipUrl,
          keyframeUrls: scene.keyframeUrls,
          audioUrl: scene.audioUrl,
          transitionIn: scene.transitionIn,
          transitionOut: scene.transitionOut,
          status: "processing",
        })
        .returning();

      const [sceneJob] = await db
        .insert(workflowJobs)
        .values({
          projectId: params.projectId,
          sceneId: videoScene.id,
          type: "ANALYZE_SCENE",
          status: "processing",
          input: { sceneIndex: scene.sceneIndex, keyframeUrls: scene.keyframeUrls, clipUrl: scene.clipUrl },
        })
        .returning();

      try {
        const context = {
          sceneCount: breakdown.scenes.length,
          projectTitle: project.title,
          previousSummary: insertedBlueprints.length ? textValue(insertedBlueprints[insertedBlueprints.length - 1].story) : undefined,
          nextSummary: breakdown.scenes[scene.sceneIndex]?.shotGroupId,
        };
        const blueprint = await analyzeSceneBlueprint({ userId: params.userId, scene, context });
        insertedBlueprints.push(blueprint);
        await db.insert(sceneVersions).values({
          projectId: params.projectId,
          projectVersionId: version.id,
          originalSceneId: videoScene.id,
          sceneIndex: scene.sceneIndex,
          story: blueprint.story,
          visual: blueprint.visual,
          dialogue: blueprint.dialogue,
          narration: blueprint.narration,
          subtitle: blueprint.subtitle,
          audio: blueprint.audio,
          transition: blueprint.transition,
          generationPrompt: blueprint.generationPrompt,
          duration: scene.duration,
          metadata: blueprint.metadata || {},
        });
        const usedFallback = blueprint.metadata?.analysisProvider === "fallback";
        await db
          .update(videoScenes)
          .set({ status: usedFallback ? "failed" : "completed", error: usedFallback ? String(blueprint.metadata?.fallbackReason || "AI analysis fallback used") : null, updatedAt: new Date() })
          .where(eq(videoScenes.id, videoScene.id));
        await db
          .update(workflowJobs)
          .set({ status: usedFallback ? "failed" : "completed", error: usedFallback ? String(blueprint.metadata?.fallbackReason || "AI analysis fallback used") : null, output: { provider: blueprint.metadata?.analysisProvider || "unknown" }, completedAt: new Date(), updatedAt: new Date() })
          .where(eq(workflowJobs.id, sceneJob.id));
        if (usedFallback) failedScenes.push({ sceneIndex: scene.sceneIndex, error: String(blueprint.metadata?.fallbackReason || "AI analysis fallback used") });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Scene analysis failed";
        const fallback = buildFallbackSceneBlueprint(scene, message);
        insertedBlueprints.push(fallback);
        failedScenes.push({ sceneIndex: scene.sceneIndex, error: message });
        await db.insert(sceneVersions).values({
          projectId: params.projectId,
          projectVersionId: version.id,
          originalSceneId: videoScene.id,
          sceneIndex: scene.sceneIndex,
          story: fallback.story,
          visual: fallback.visual,
          dialogue: fallback.dialogue,
          narration: fallback.narration,
          subtitle: fallback.subtitle,
          audio: fallback.audio,
          transition: fallback.transition,
          generationPrompt: fallback.generationPrompt,
          duration: scene.duration,
          metadata: fallback.metadata || {},
        });
        await db.update(videoScenes).set({ status: "failed", error: message, updatedAt: new Date() }).where(eq(videoScenes.id, videoScene.id));
        await db.update(workflowJobs).set({ status: "failed", error: message, updatedAt: new Date() }).where(eq(workflowJobs.id, sceneJob.id));
      }
    }

    const overview = await buildStructuredVideoOverview({ userId: params.userId, title: project.title, sceneBlueprints: insertedBlueprints });
    await db.update(projectVersions).set({ overview, updatedAt: new Date() }).where(eq(projectVersions.id, version.id));
    await db
      .update(projects)
      .set({ status: "ready", activeVersionId: version.id, updatedAt: new Date(), metadata: { failedSceneCount: failedScenes.length, failedScenes } })
      .where(eq(projects.id, params.projectId));
    await db
      .update(workflowJobs)
      .set({ status: "completed", output: { sceneCount: insertedBlueprints.length, failedSceneCount: failedScenes.length }, completedAt: new Date(), updatedAt: new Date() })
      .where(eq(workflowJobs.id, job.id));

    return getProjectBundle(params.projectId, params.userId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Video breakdown failed";
    await db.update(projects).set({ status: "failed", updatedAt: new Date() }).where(eq(projects.id, params.projectId));
    await db.update(workflowJobs).set({ status: "failed", error: message, updatedAt: new Date() }).where(eq(workflowJobs.id, job.id));
    throw error;
  }
}

export async function createRemixVersion(params: {
  userId: string;
  projectId: string;
  sourceVersionId: string;
  remixPrompt: string;
}) {
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

  const overview = await buildStructuredVideoOverview({ userId: params.userId, title: project.title, sceneBlueprints: remixedBlueprints, remixPrompt: params.remixPrompt });
  await db.update(projectVersions).set({ overview, updatedAt: new Date() }).where(eq(projectVersions.id, version.id));
  await db.update(projects).set({ activeVersionId: version.id, updatedAt: new Date() }).where(eq(projects.id, params.projectId));
  return getProjectBundle(params.projectId, params.userId);
}

export async function rewriteSceneVersion(params: {
  userId: string;
  projectId: string;
  sceneVersionId: string;
  instruction: string;
}) {
  const project = await getProjectForUser(params.projectId, params.userId);
  if (!project) throw new Error("Project not found");

  const scene = await db.query.sceneVersions.findFirst({
    where: and(eq(sceneVersions.id, params.sceneVersionId), eq(sceneVersions.projectId, params.projectId)),
  });
  if (!scene) throw new Error("Scene version not found");

  const rewritten = await rewriteSceneBlueprint({
    userId: params.userId,
    scene: sceneVersionToBlueprint(scene),
    instruction: params.instruction,
    duration: scene.duration,
    sceneIndex: scene.sceneIndex,
  });

  const [updated] = await db
    .update(sceneVersions)
    .set({
      story: rewritten.story,
      visual: rewritten.visual,
      dialogue: rewritten.dialogue,
      narration: rewritten.narration,
      subtitle: rewritten.subtitle,
      audio: rewritten.audio,
      transition: rewritten.transition,
      generationPrompt: rewritten.generationPrompt,
      metadata: { ...(rewritten.metadata || {}), rewriteInstruction: params.instruction, previousSceneVersionId: scene.id },
      updatedAt: new Date(),
    })
    .where(eq(sceneVersions.id, scene.id))
    .returning();

  return updated;
}

export async function retrySceneAnalysis(params: {
  userId: string;
  projectId: string;
  sceneVersionId: string;
}) {
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
    input: { retrySceneVersionId: params.sceneVersionId },
  }).returning();

  const asset = sceneAssetFromRecords(videoScene);
  const blueprint = await analyzeSceneBlueprint({
    userId: params.userId,
    scene: asset,
    context: { sceneCount: 1, projectTitle: project.title },
  });
  const usedFallback = blueprint.metadata?.analysisProvider === "fallback";

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
