import { NextRequest, NextResponse } from "next/server";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db, projectVersions, projects, referenceVideos, sceneVersions, user, videoScenes } from "@/lib/db";

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function firstString(value: unknown): string | null {
  return Array.isArray(value) ? value.find((item) => typeof item === "string" && item.trim()) || null : null;
}

function textFromObject(value: unknown, keys: string[]): string | null {
  const source = asObject(value);
  for (const key of keys) {
    const item = source[key];
    if (typeof item === "string" && item.trim()) return item;
  }
  return null;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const rawLimit = Number.parseInt(searchParams.get("limit") || "60", 10);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 60;

    const projectRows = await db
      .select({
        id: projects.id,
        title: projects.title,
        status: projects.status,
        activeVersionId: projects.activeVersionId,
        metadata: projects.metadata,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
      })
      .from(projects)
      .innerJoin(user, eq(projects.userId, user.id))
      .where(and(eq(user.role, "admin"), eq(projects.status, "ready")))
      .orderBy(desc(projects.updatedAt))
      .limit(limit);

    const projectIds = projectRows.map((project) => project.id);
    if (!projectIds.length) return NextResponse.json({ samples: [] });

    const [referenceRows, sceneRows, versionRows, sceneVersionRows] = await Promise.all([
      db
        .select({
          projectId: referenceVideos.projectId,
          sourceUrl: referenceVideos.sourceUrl,
          fileName: referenceVideos.fileName,
          mimeType: referenceVideos.mimeType,
          duration: referenceVideos.duration,
          createdAt: referenceVideos.createdAt,
        })
        .from(referenceVideos)
        .where(inArray(referenceVideos.projectId, projectIds))
        .orderBy(desc(referenceVideos.createdAt)),
      db
        .select({
          projectId: videoScenes.projectId,
          sceneIndex: videoScenes.sceneIndex,
          duration: videoScenes.duration,
          clipUrl: videoScenes.clipUrl,
          keyframeUrls: videoScenes.keyframeUrls,
          status: videoScenes.status,
        })
        .from(videoScenes)
        .where(inArray(videoScenes.projectId, projectIds))
        .orderBy(asc(videoScenes.sceneIndex)),
      db
        .select({
          id: projectVersions.id,
          projectId: projectVersions.projectId,
          versionNumber: projectVersions.versionNumber,
          overview: projectVersions.overview,
          createdAt: projectVersions.createdAt,
        })
        .from(projectVersions)
        .where(inArray(projectVersions.projectId, projectIds))
        .orderBy(desc(projectVersions.versionNumber)),
      db
        .select({
          projectId: sceneVersions.projectId,
          projectVersionId: sceneVersions.projectVersionId,
          sceneIndex: sceneVersions.sceneIndex,
          story: sceneVersions.story,
          visual: sceneVersions.visual,
          generationPrompt: sceneVersions.generationPrompt,
          duration: sceneVersions.duration,
          createdAt: sceneVersions.createdAt,
        })
        .from(sceneVersions)
        .where(inArray(sceneVersions.projectId, projectIds))
        .orderBy(asc(sceneVersions.sceneIndex), desc(sceneVersions.createdAt)),
    ]);

    const referencesByProject = new Map<string, (typeof referenceRows)[number]>();
    for (const reference of referenceRows) {
      if (!referencesByProject.has(reference.projectId)) referencesByProject.set(reference.projectId, reference);
    }

    const scenesByProject = new Map<string, typeof sceneRows>();
    for (const scene of sceneRows) {
      scenesByProject.set(scene.projectId, [...(scenesByProject.get(scene.projectId) || []), scene]);
    }

    const versionsByProject = new Map<string, typeof versionRows>();
    for (const version of versionRows) {
      versionsByProject.set(version.projectId, [...(versionsByProject.get(version.projectId) || []), version]);
    }

    const sceneVersionsByProject = new Map<string, typeof sceneVersionRows>();
    for (const sceneVersion of sceneVersionRows) {
      sceneVersionsByProject.set(sceneVersion.projectId, [...(sceneVersionsByProject.get(sceneVersion.projectId) || []), sceneVersion]);
    }

    const samples = projectRows
      .map((project) => {
        const metadata = asObject(project.metadata);
        const reference = referencesByProject.get(project.id);
        const scenes = scenesByProject.get(project.id) || [];
        const versions = versionsByProject.get(project.id) || [];
        const activeVersion = versions.find((version) => version.id === project.activeVersionId) || versions[0] || null;
        const activeSceneVersions = (sceneVersionsByProject.get(project.id) || []).filter(
          (sceneVersion) => !activeVersion || sceneVersion.projectVersionId === activeVersion.id
        );
        const firstScene = scenes[0] || null;
        const firstSceneVersion = activeSceneVersions[0] || null;
        const mediaType = metadata.mediaType === "image" ? "image" : "video";
        const mediaUrl = mediaType === "image"
          ? firstString(firstScene?.keyframeUrls) || reference?.sourceUrl || firstScene?.clipUrl || null
          : reference?.sourceUrl || firstScene?.clipUrl || firstString(firstScene?.keyframeUrls) || null;
        const summary =
          textFromObject(activeVersion?.overview, ["hook", "targetAudience", "editingRhythm", "whyThisWorks"]) ||
          textFromObject(firstSceneVersion?.story, ["summary", "beat", "role", "action"]) ||
          textFromObject(firstSceneVersion?.visual, ["sceneDescription", "subject", "action"]);

        return {
          id: project.id,
          title: project.title,
          status: project.status,
          mediaType,
          mediaUrl,
          mediaName: reference?.fileName || project.title,
          prompt: firstSceneVersion?.generationPrompt || null,
          summary,
          sceneCount: scenes.length,
          duration: reference?.duration || Math.round(scenes.reduce((total, scene) => total + (Number(scene.duration) || 0), 0)),
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
        };
      })
      .filter((sample) => sample.mediaUrl);

    return NextResponse.json({ samples });
  } catch (error) {
    console.error("Samples error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
