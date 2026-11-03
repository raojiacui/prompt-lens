type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
const timestamp = (value: unknown) => {
  const time = value instanceof Date ? value.getTime() : typeof value === "string" || typeof value === "number" ? new Date(value).getTime() : NaN;
  return Number.isFinite(time) ? time : undefined;
};
const duration = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;
const errorCodes = new Set(["MEDIA_PREPARATION_FAILED", "MEDIA_STORAGE_CONFIG_INVALID", "MEDIA_HTTP_500", "SPLIT_ASSET_MISMATCH", "ANALYSIS_INTERRUPTED", "ANALYSIS_SCENE_CHECKPOINT_MISSING", "KIE_KEY_CHANGED", "KIE_KEY_REQUIRED", "KIE_INVALID_RESULT", "TASK_REQUIRES_RECONCILIATION", "ANALYSIS_FAILED"]);
const errorCode = (value: unknown) => typeof value === "string" ? errorCodes.has(value) ? value : "ANALYSIS_FAILED" : undefined;

export type AnalysisStage = "quoted" | "queued" | "preparing" | "analyzing" | "saving" | "completed" | "failed" | "review";
export type AnalysisSceneDiagnostic = {
  index: number; stage: AnalysisStage; createdAt?: number; updatedAt?: number; startedAt?: number;
  queueMs?: number; preparationMs?: number; modelMs?: number; saveMs?: number; errorCode?: string;
};
export type AnalysisDiagnostics = {
  taskId: string; state: string; stage: AnalysisStage; modelId?: string;
  createdAt?: number; updatedAt?: number; observedAt: number; stageStartedAt?: number;
  errorCode?: string; scenes: AnalysisSceneDiagnostic[];
};
type TaskSnapshot = { id: string; state: string; input: unknown; result: unknown; createdAt?: unknown; updatedAt: unknown };
type SceneSnapshot = { sceneIndex: number; state: string; result: unknown; createdAt?: unknown; updatedAt: unknown };

// Explicit projection: never return task inputs, provider messages, URLs, keys or blueprints.
export function buildAnalysisDiagnostics(task: TaskSnapshot, jobs: SceneSnapshot[], now = Date.now()): AnalysisDiagnostics {
  const input = record(task.input), result = record(task.result);
  const assets = record(result.assets);
  const assetScenes = Array.isArray(assets.scenes) ? assets.scenes : [];
  const pricingScenes = record(input.pricing).scenes;
  const selected = Array.isArray(pricingScenes) ? pricingScenes : [];
  const retryScenes = record(input.retry).sceneVersions;
  const indexes = Array.isArray(retryScenes) ? retryScenes.map(scene => selected.findIndex(s => record(s).id === record(scene).id) + 1).filter(index => index > 0) : selected.map((_, index) => index + 1);
  const finished = Array.isArray(result.finishedSceneIds) ? result.finishedSceneIds : [];
  const successes = Array.isArray(result.successfulSceneIds) ? result.successfulSceneIds : [];
  const scenes: AnalysisSceneDiagnostic[] = indexes.map(index => {
    const job = jobs.find(job => job.sceneIndex === index);
    const data = record(job?.result), timings = record(data.timings);
    let stage: AnalysisStage;
    if (!job) {
      const id = record(selected[index - 1]).id;
      stage = finished.includes(id) ? successes.includes(id) ? "completed" : "failed" : task.state === "failed" ? "failed" : "queued";
    } else if (job.state === "running") {
      const frames = record(assetScenes[index - 1]).keyframeUrls;
      stage = data.hasPendingBlueprint === true || data.pendingBlueprint ? "saving"
        : data.phase === "preparing" ? "preparing"
        : data.phase === "analyzing" || Array.isArray(frames) && frames.length > 0 ? "analyzing" : "preparing";
    } else stage = ["completed", "failed"].includes(job.state) ? job.state as AnalysisStage : "queued";
    return { index, stage, createdAt: timestamp(job?.createdAt), updatedAt: timestamp(job?.updatedAt),
      startedAt: timestamp(data.phaseStartedAt) ?? timestamp(timings.startedAt) ?? (job?.state === "running" ? timestamp(job.updatedAt) : undefined),
      queueMs: duration(timings.queueMs), preparationMs: duration(timings.preparationMs), modelMs: duration(timings.modelMs),
      saveMs: duration(timings.checkpointToSaveMs), errorCode: errorCode(data.failureCode) };
  });
  const terminal = ["completed", "failed", "review"].includes(task.state);
  const stage: AnalysisStage = terminal ? task.state as AnalysisStage : task.state === "quoted" ? "quoted" : task.state === "queued" ? "queued"
    : scenes.some(s => s.stage === "analyzing") ? "analyzing" : scenes.some(s => s.stage === "preparing") ? "preparing"
    : scenes.some(s => s.stage === "saving") || scenes.length > 0 && scenes.every(s => ["completed", "failed"].includes(s.stage)) ? "saving"
    : result.assets ? "queued" : "preparing";
  const model = input.modelId;
  return { taskId: task.id, state: task.state, stage,
    modelId: typeof model === "string" && /^(?:analysis-)?(?:gemini|deepseek)-[a-z0-9.-]+$/.test(model) ? model : undefined,
    createdAt: timestamp(task.createdAt), updatedAt: timestamp(task.updatedAt), observedAt: now,
    stageStartedAt: timestamp(result.phaseStartedAt), errorCode: errorCode(result.code), scenes };
}
