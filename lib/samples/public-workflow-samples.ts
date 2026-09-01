import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db, projects, projectVersions, referenceVideos, sceneVersions, user, videoScenes } from "@/lib/db";

export const PUBLIC_WORKFLOW_SAMPLES = [
  {
    id: "fb380b0f-6bd0-42b0-a96d-a5853562beba",
    title: "江湖除了爱恨情仇之外，还有龙",
  },
  {
    id: "d1e67ba2-e212-4bd0-b012-7a9fc085ce9e",
    title: "天宫之约",
  },
] as const;

const publicSampleIds: string[] = PUBLIC_WORKFLOW_SAMPLES.map((sample) => sample.id);
const publicSampleTitleById = new Map<string, string>(PUBLIC_WORKFLOW_SAMPLES.map((sample) => [sample.id, sample.title]));
const publicSampleOrderById = new Map<string, number>(PUBLIC_WORKFLOW_SAMPLES.map((sample, index) => [sample.id, index]));

type PublicProject = {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  status: string;
  activeVersionId: string | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
};

export type PublicWorkflowSample = {
  id: string;
  title: string;
  status: string;
  mediaType: "video" | "image";
  mediaUrl: string | null;
  mediaName: string | null;
  prompt: string | null;
  summary: string | null;
  sceneCount: number;
  duration: number | null;
  createdAt: Date;
  updatedAt: Date;
};

export type PublicWorkflowBundle = Awaited<ReturnType<typeof getPublicSampleBundle>>;

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

function publicTitle(project: Pick<PublicProject, "id" | "title">) {
  return publicSampleTitleById.get(project.id) || project.title;
}

async function getPublicProjects(ids = publicSampleIds) {
  if (!ids.length) return [];

  const rows = await db
    .select({
      id: projects.id,
      userId: projects.userId,
      title: projects.title,
      description: projects.description,
      status: projects.status,
      activeVersionId: projects.activeVersionId,
      metadata: projects.metadata,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
    })
    .from(projects)
    .innerJoin(user, eq(projects.userId, user.id))
    .where(and(eq(user.role, "admin"), eq(projects.status, "ready"), inArray(projects.id, ids)));

  return rows.sort((a, b) => (publicSampleOrderById.get(a.id) ?? 999) - (publicSampleOrderById.get(b.id) ?? 999));
}

export async function getPublicWorkflowSamples(limit = 60): Promise<PublicWorkflowSample[]> {
  const projectRows = (await getPublicProjects()).slice(0, limit);
  const bundles = await getBundles(projectRows);

  return bundles
    .map((bundle) => {
      const project = bundle.project;
      const metadata = asObject(project.metadata);
      const reference = bundle.referenceVideos[0] || null;
      const firstScene = bundle.scenes[0] || null;
      const firstSceneVersion = bundle.sceneVersions[0] || null;
      const mediaType: "video" | "image" = metadata.mediaType === "image" ? "image" : "video";
      const mediaUrl =
        mediaType === "image"
          ? firstString(firstScene?.keyframeUrls) || reference?.sourceUrl || firstScene?.clipUrl || null
          : reference?.sourceUrl || firstScene?.clipUrl || firstString(firstScene?.keyframeUrls) || null;
      const summary =
        textFromObject(bundle.activeVersion?.overview, ["hook", "targetAudience", "editingRhythm", "whyThisWorks"]) ||
        textFromObject(firstSceneVersion?.story, ["summary", "beat", "role", "action"]) ||
        textFromObject(firstSceneVersion?.visual, ["sceneDescription", "subject", "action"]);

      return {
        id: project.id,
        title: publicTitle(project),
        status: project.status,
        mediaType,
        mediaUrl,
        mediaName: reference?.fileName || project.title,
        prompt: firstSceneVersion?.generationPrompt || null,
        summary,
        sceneCount: bundle.scenes.length,
        duration: reference?.duration || Math.round(bundle.scenes.reduce((total, scene) => total + (Number(scene.duration) || 0), 0)) || null,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      };
    })
    .filter((sample) => sample.mediaUrl);
}

export async function getPublicSampleBundle(id: string) {
  if (!publicSampleIds.includes(id)) return null;

  const [project] = await getPublicProjects([id]);
  if (!project) return null;

  const [bundle] = await getBundles([project]);
  if (!bundle) return null;

  return {
    ...bundle,
    project: {
      ...bundle.project,
      title: publicTitle(bundle.project),
    },
  };
}

async function getBundles(projectRows: PublicProject[]) {
  const ids = projectRows.map((project) => project.id);
  if (!ids.length) return [];

  const [versions, scenes, allSceneVersions, references] = await Promise.all([
    db.query.projectVersions.findMany({
      where: inArray(projectVersions.projectId, ids),
      orderBy: [asc(projectVersions.versionNumber)],
    }),
    db.query.videoScenes.findMany({
      where: inArray(videoScenes.projectId, ids),
      orderBy: [asc(videoScenes.sceneIndex)],
    }),
    db.query.sceneVersions.findMany({
      where: inArray(sceneVersions.projectId, ids),
      orderBy: [asc(sceneVersions.sceneIndex), desc(sceneVersions.createdAt)],
    }),
    db.query.referenceVideos.findMany({
      where: inArray(referenceVideos.projectId, ids),
      orderBy: [desc(referenceVideos.createdAt)],
    }),
  ]);

  return projectRows.map((project) => {
    const projectVersionsRows = versions.filter((version) => version.projectId === project.id);
    const activeVersion =
      projectVersionsRows.find((version) => version.id === project.activeVersionId) ||
      projectVersionsRows[projectVersionsRows.length - 1] ||
      null;
    const activeSceneVersionRows = activeVersion ? allSceneVersions.filter((scene) => scene.projectVersionId === activeVersion.id) : [];
    const latestSceneVersionByOriginalScene = new Map<string, (typeof allSceneVersions)[number]>();
    for (const sceneVersion of activeSceneVersionRows) {
      if (!latestSceneVersionByOriginalScene.has(sceneVersion.originalSceneId)) {
        latestSceneVersionByOriginalScene.set(sceneVersion.originalSceneId, sceneVersion);
      }
    }
    const { userId: _userId, ...publicProject } = project;

    return {
      project: {
        ...publicProject,
        title: publicTitle(project),
        metadata: asObject(project.metadata),
      },
      versions: projectVersionsRows,
      activeVersion,
      scenes: scenes.filter((scene) => scene.projectId === project.id).sort((a, b) => a.sceneIndex - b.sceneIndex),
      sceneVersions: Array.from(latestSceneVersionByOriginalScene.values()).sort((a, b) => a.sceneIndex - b.sceneIndex),
      allSceneVersions: allSceneVersions.filter((scene) => scene.projectId === project.id),
      referenceVideos: references
        .filter((reference) => reference.projectId === project.id)
        .map(({ storageKey: _storageKey, ...reference }) => reference),
    };
  });
}
