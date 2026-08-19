import { db, projectVersions, projects, referenceVideos, sceneVersions, videoScenes, workflowJobs } from "@/lib/db";
import type { FfmpegSceneAsset } from "@/lib/ffmpeg-worker/client";
import { breakdownVideoWithWorker } from "@/lib/ffmpeg-worker/client";
import { routeModel } from "@/lib/ai/model-registry";
import { and, asc, desc, eq } from "drizzle-orm";

export interface SceneBlueprintDraft {
  story: Record<string, unknown>;
  visual: Record<string, unknown>;
  dialogue: unknown[];
  narration: unknown[];
  subtitle: unknown[];
  audio: Record<string, unknown>;
  transition: Record<string, unknown>;
  generationPrompt: string;
}

export function buildSceneBlueprint(scene: FfmpegSceneAsset): SceneBlueprintDraft {
  const label = `Scene ${String(scene.sceneIndex).padStart(2, "0")}`;
  return {
    story: {
      summary: `${label} from ${scene.startTime.toFixed(1)}s to ${scene.endTime.toFixed(1)}s. Review the preview and refine the description after AI analysis is connected.`,
      role: scene.sceneIndex === 1 ? "Hook / opening beat" : "Continuation beat",
    },
    visual: {
      subject: "Primary subject visible in the reference scene",
      environment: "Reference environment from uploaded video",
      action: "Main action detected from this shot",
      camera: "Camera movement and framing pending detailed scene analysis",
      lighting: "Lighting style inferred from keyframes",
      color: "Color palette inferred from keyframes",
      style: "Reference video style",
    },
    dialogue: [],
    narration: [],
    subtitle: [],
    audio: {
      ambience: "Audio extraction ready for detailed analysis",
      music: "Pending audio analysis",
      sfx: [],
    },
    transition: {
      in: scene.transitionIn || (scene.sceneIndex === 1 ? "start" : "hard_cut"),
      out: scene.transitionOut || "hard_cut",
      rhythm: "Preserve the original timing and edit rhythm",
    },
    generationPrompt: `${label}: recreate the reference shot structure from ${scene.startTime.toFixed(1)}s to ${scene.endTime.toFixed(1)}s. Preserve camera framing, subject motion, lighting, pacing, and transition rhythm while allowing the creative details to be edited.`,
  };
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

    const insertedScenes = [];
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
          status: "completed",
        })
        .returning();
      insertedScenes.push(videoScene);
      const blueprint = buildSceneBlueprint(scene);
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
      });
    }

    await db
      .update(projects)
      .set({ status: "ready", activeVersionId: version.id, updatedAt: new Date() })
      .where(eq(projects.id, params.projectId));
    await db
      .update(workflowJobs)
      .set({ status: "completed", output: { sceneCount: insertedScenes.length }, completedAt: new Date(), updatedAt: new Date() })
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
  const [version] = await db
    .insert(projectVersions)
    .values({
      projectId: params.projectId,
      parentVersionId: params.sourceVersionId,
      versionNumber: nextVersionNumber,
      kind: "remix",
      label: `Remix V${nextVersionNumber}`,
      remixPrompt: params.remixPrompt,
      overview: {
        ...buildVideoOverview(sourceScenes.length),
        remixDirection: params.remixPrompt,
      },
    })
    .returning();

  for (const scene of sourceScenes) {
    await db.insert(sceneVersions).values({
      projectId: params.projectId,
      projectVersionId: version.id,
      originalSceneId: scene.originalSceneId,
      sceneIndex: scene.sceneIndex,
      story: { ...(scene.story as Record<string, unknown>), remixDirection: params.remixPrompt },
      visual: scene.visual,
      dialogue: scene.dialogue,
      narration: scene.narration,
      subtitle: scene.subtitle,
      audio: scene.audio,
      transition: scene.transition,
      generationPrompt: `${scene.generationPrompt}\n\nRemix direction: ${params.remixPrompt}. Preserve the original scene timing, shot structure, and editing rhythm.`,
      duration: scene.duration,
      metadata: { sourceSceneVersionId: scene.id },
    });
  }

  await db.update(projects).set({ activeVersionId: version.id, updatedAt: new Date() }).where(eq(projects.id, params.projectId));
  return getProjectBundle(params.projectId, params.userId);
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