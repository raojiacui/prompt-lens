import { and, eq, sql } from "drizzle-orm";
import { db, projects, videoGeneration, workflowJobs } from "@/lib/db";
import { getUserCredential } from "@/lib/byok/credentials";
import { generationKeyFingerprint } from "@/lib/billing/generation-key";
import { assertPromptAllowed, PromptModerationError } from "@/lib/safety/waffo-prompt-scan";
import { createProviderVideo } from "@/lib/ai/video-client";
import { KieProviderError } from "@/lib/reference-video/kie-veo";
import { readFullVideoScript, lockedScriptVersion } from "./full-video-script-store";
import { signScriptVideoPreview, verifyScriptVideoPreview, type ScriptVideoSnapshot } from "./script-video-preview";
import { SCRIPT_VIDEO_MODEL, SCRIPT_VIDEO_REVIEW_LIMIT, type ScriptVideoSettings } from "./script-video-compiler";

type Job = typeof workflowJobs.$inferSelect;
type SnapshotInput = { kind: "full_script_video"; snapshot: ScriptVideoSnapshot; keyFingerprint: string };
export async function previewScriptVideo(input: { userId: string; projectId: string; versionId: string; revision: number; settings: ScriptVideoSettings; language: "zh" | "en"; editedPrompt?: string }) {
  const document = await readFullVideoScript(input.userId, input.projectId, input.versionId, input.language === "zh");
  if (document.revision !== input.revision) throw new Error("SCRIPT_CONFLICT");
  const preview = signScriptVideoPreview({ ...input, content: document.content });
  const credential = await getUserCredential(input.userId, "kie");
  return { ...preview, canGenerate: Boolean(credential), billing: { payer: "byok", provider: "kie", chargedCredits: 0, quantity: 1 } };
}
async function ownedScriptJob(userId: string, projectId: string, generationId: string) {
  const project = await db.query.projects.findFirst({ where: and(eq(projects.id, projectId), eq(projects.userId, userId)) });
  if (!project) throw new Error("SCRIPT_NOT_FOUND");
  const job = await db.query.workflowJobs.findFirst({ where: and(eq(workflowJobs.id, generationId), eq(workflowJobs.projectId, projectId), eq(workflowJobs.type, "GENERATE_VIDEO")) });
  if (!job || (job.input as Partial<SnapshotInput>).kind !== "full_script_video") throw new Error("SCRIPT_VIDEO_JOB_NOT_FOUND");
  return job;
}
async function registerProviderRecord(job: Job) {
  if (!job.externalTaskId) return;
  const input = job.input as SnapshotInput;
  const s = input.snapshot;
  if (!s) throw new Error("SCRIPT_VIDEO_SNAPSHOT_EXPIRED");
  await db.insert(videoGeneration).values({ userId: s.userId, projectId: s.projectId, projectVersionId: s.versionId, taskId: job.externalTaskId,
    prompt: s.prompt, model: SCRIPT_VIDEO_MODEL, provider: "kie", status: "pending", duration: s.settings.duration, resolution: s.settings.resolution,
    rawResponse: { billing: { provider: "kie", keySource: "user", keyFingerprint: input.keyFingerprint, chargedCredits: 0 } },
  }).onConflictDoNothing({ target: videoGeneration.taskId });
}
function publicJob(job: Job) {
  return { generationId: job.id, providerTaskId: job.externalTaskId, status: job.status,
    stage: (job.output as { stage?: string }).stage,
    error: job.error, snapshot: (job.input as Partial<SnapshotInput>).snapshot };
}
export async function readScriptVideoJob(userId: string, projectId: string, generationId: string) {
  const job = await ownedScriptJob(userId, projectId, generationId);
  // A saved external ID is sufficient to repair a database failure after submission.
  await registerProviderRecord(job);
  return publicJob(job);
}
export async function submitScriptVideo(userId: string, projectId: string, token: string) {
  const snapshot = verifyScriptVideoPreview(token, userId, projectId, true);
  const existing = await db.query.workflowJobs.findFirst({ where: eq(workflowJobs.id, snapshot.generationId) });
  if (existing) return readScriptVideoJob(userId, projectId, snapshot.generationId);
  if (snapshot.expiresAt <= Date.now()) throw new Error("SCRIPT_VIDEO_PREVIEW_EXPIRED");
  if (snapshot.prompt.length > SCRIPT_VIDEO_REVIEW_LIMIT) throw new Error("SCRIPT_VIDEO_REVIEW_LIMIT");
  const credential = await getUserCredential(userId, "kie");
  if (!credential) throw new Error("SCRIPT_VIDEO_KIE_KEY_REQUIRED");
  const fingerprint = generationKeyFingerprint(credential.apiKey);
  const job = await db.transaction(async tx => {
    await lockedScriptVersion(tx, userId, projectId, snapshot.versionId);
    const duplicate = await tx.query.workflowJobs.findFirst({ where: eq(workflowJobs.id, snapshot.generationId) });
    if (duplicate) return null;
    const active = await tx.select({ id: workflowJobs.id }).from(workflowJobs).where(and(eq(workflowJobs.projectId, projectId),
      eq(workflowJobs.status, "processing"), sql`${workflowJobs.input}->>'kind' = 'full_script_video'`));
    if (active.length >= 2) throw new Error("SCRIPT_VIDEO_CONCURRENCY_LIMIT");
    const [created] = await tx.insert(workflowJobs).values({ id: snapshot.generationId, projectId, type: "GENERATE_VIDEO", provider: "kie", modelId: SCRIPT_VIDEO_MODEL,
      status: "processing", input: { kind: "full_script_video", snapshot, keyFingerprint: fingerprint }, output: { stage: "moderating" } }).returning();
    return created;
  });
  if (!job) return readScriptVideoJob(userId, projectId, snapshot.generationId);
  let submitted = false;
  try {
    await assertPromptAllowed(snapshot.prompt, { userId });
    await db.update(workflowJobs).set({ output: { stage: "submitting" } }).where(eq(workflowJobs.id, job.id));
    submitted = true;
    const result = await createProviderVideo("kie", { prompt: snapshot.prompt, model: SCRIPT_VIDEO_MODEL, ...snapshot.settings }, credential.apiKey, { userId, projectId });
    // Persist the external ID before writing history, so retrieval can repair history
    // without repeating the provider call after a later database interruption.
    await db.update(workflowJobs).set({ externalTaskId: result.taskId, output: { stage: "queued" } }).where(eq(workflowJobs.id, job.id));
    return readScriptVideoJob(userId, projectId, snapshot.generationId);
  } catch (error) {
    const confirmedFailure = !submitted || error instanceof PromptModerationError ||
      error instanceof KieProviderError && ["auth", "quota_exceeded", "rate_limited"].includes(error.kind);
    const message = error instanceof PromptModerationError ? "提示词审核未通过或暂不可用，未提交视频生成。"
      : confirmedFailure ? "视频未能提交，请核对 KIE Key、余额及审核状态。" : "提交结果暂不明。请查询此任务并核对 KIE 控制台，勿重复创建付费任务。";
    await db.update(workflowJobs).set({ status: confirmedFailure ? "failed" : "processing", error: message,
      output: { stage: confirmedFailure ? "failed" : "unknown_submission" }, completedAt: confirmedFailure ? new Date() : null }).where(eq(workflowJobs.id, job.id)).catch(() => undefined);
    return readScriptVideoJob(userId, projectId, snapshot.generationId);
  }
}
