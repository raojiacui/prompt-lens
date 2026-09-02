import snapshot from "./public-workflow-samples.snapshot.json";

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

type PublicProject = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  activeVersionId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

type PublicVersion = {
  id: string;
  projectId: string;
  parentVersionId: string | null;
  versionNumber: number;
  kind: string;
  label: string;
  remixPrompt: string | null;
  overview: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

type PublicScene = {
  id: string;
  projectId: string;
  referenceVideoId: string | null;
  sceneIndex: number;
  shotGroupId: string | null;
  startTime: number;
  endTime: number;
  duration: number;
  clipUrl: string | null;
  keyframeUrls: string[];
  audioUrl: string | null;
  transitionIn: string | null;
  transitionOut: string | null;
  status: string;
  error: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

type PublicSceneVersion = {
  id: string;
  projectId: string;
  projectVersionId: string;
  originalSceneId: string;
  sceneIndex: number;
  story: Record<string, unknown>;
  visual: Record<string, unknown>;
  dialogue: unknown[];
  narration: unknown[];
  subtitle: unknown[];
  audio: Record<string, unknown>;
  transition: Record<string, unknown>;
  generationPrompt: string;
  duration: number;
  generatedVideoUrl: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

type PublicReferenceVideo = {
  id: string;
  projectId: string;
  sourceUrl: string;
  fileName: string | null;
  mimeType: string | null;
  duration: number | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type PublicWorkflowBundle = {
  project: PublicProject;
  versions: PublicVersion[];
  activeVersion: PublicVersion | null;
  scenes: PublicScene[];
  sceneVersions: PublicSceneVersion[];
  allSceneVersions: PublicSceneVersion[];
  referenceVideos: PublicReferenceVideo[];
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
  createdAt: string;
  updatedAt: string;
};

const sampleBundles = snapshot as PublicWorkflowBundle[];
const publicSampleIds: string[] = PUBLIC_WORKFLOW_SAMPLES.map((sample) => sample.id);
const publicSampleTitleById = new Map<string, string>(PUBLIC_WORKFLOW_SAMPLES.map((sample) => [sample.id, sample.title]));
const publicSampleOrderById = new Map<string, number>(PUBLIC_WORKFLOW_SAMPLES.map((sample, index) => [sample.id, index]));

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

function titleFor(project: Pick<PublicProject, "id" | "title">) {
  return publicSampleTitleById.get(project.id) || project.title;
}

function orderedBundles() {
  return sampleBundles
    .filter((bundle) => publicSampleIds.includes(bundle.project.id))
    .sort((a, b) => (publicSampleOrderById.get(a.project.id) ?? 999) - (publicSampleOrderById.get(b.project.id) ?? 999));
}

export async function getPublicWorkflowSamples(limit = 60): Promise<PublicWorkflowSample[]> {
  return orderedBundles()
    .slice(0, limit)
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
        title: titleFor(project),
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

export async function getPublicSampleBundle(id: string): Promise<PublicWorkflowBundle | null> {
  if (!publicSampleIds.includes(id)) return null;

  const bundle = sampleBundles.find((item) => item.project.id === id);
  if (!bundle) return null;

  return {
    ...bundle,
    project: {
      ...bundle.project,
      title: titleFor(bundle.project),
    },
  };
}
