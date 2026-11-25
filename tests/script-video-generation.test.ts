import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
const isolated = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", async () => ({ ...await import("@/lib/db/schema"), get db() { return isolated.db; } }));
vi.mock("@/lib/byok/credentials", () => ({ getUserCredential: vi.fn() }));
vi.mock("@/lib/ai/video-client", () => ({ createProviderVideo: vi.fn() }));
vi.mock("@/lib/safety/waffo-prompt-scan", () => ({ assertPromptAllowed: vi.fn(), PromptModerationError: class PromptModerationError extends Error {} }));
import { getUserCredential } from "@/lib/byok/credentials";
import { createProviderVideo } from "@/lib/ai/video-client";
import { assertPromptAllowed } from "@/lib/safety/waffo-prompt-scan";
import { previewScriptVideo, submitScriptVideo, readScriptVideoJob } from "@/lib/workflow/script-video-generation";
import { signScriptVideoPreview, verifyScriptVideoPreview } from "@/lib/workflow/script-video-preview";
import { readFullVideoScript, saveFullVideoScript } from "@/lib/workflow/full-video-script-store";
const client = new PGlite();
const testDb = drizzle(client, { schema }); isolated.db = testDb;
const userId = randomUUID();
const settings = { duration: 30, resolution: "720p" as const, aspectRatio: "16:9" as const, generateAudio: false };
async function fixture() {
  const [project] = await testDb.insert(schema.projects).values({ userId, title: "Frozen script" }).returning();
  const [version] = await testDb.insert(schema.projectVersions).values({ projectId: project.id, label: "Original", versionNumber: 1 }).returning();
  const [scene] = await testDb.insert(schema.videoScenes).values({ projectId: project.id, sceneIndex: 1, startTime: 0, endTime: 30, duration: 30 }).returning();
  await testDb.insert(schema.sceneVersions).values({ projectId: project.id, projectVersionId: version.id, originalSceneId: scene.id, sceneIndex: 1, story: { summary: "A boat crosses a lake" }, visual: { sceneDescription: "A person in white" }, generationPrompt: "A person in white crosses a lake in a boat", duration: 30 });
  return { userId, projectId: project.id, versionId: version.id, revision: 1, language: "en" as const, settings };
}
describe("signed script-video previews and durable BYOK submissions", () => {
  beforeAll(async () => {
    await client.exec('CREATE TABLE "user" (id uuid PRIMARY KEY);');
    for (const migration of ["0005_v2_workflow", "0002_video_generation", "0006_generation_workflow_links"]) await client.exec(readFileSync(`drizzle/${migration}.sql`, "utf8"));
    await client.exec("ALTER TABLE video_generation ADD COLUMN IF NOT EXISTS provider varchar(20) NOT NULL DEFAULT 'kie'");
    await client.query('INSERT INTO "user" (id) VALUES ($1)', [userId]);
  });
  beforeEach(async () => {
    vi.stubEnv("BETTER_AUTH_SECRET", "isolated-script-video-secret");
    vi.mocked(getUserCredential).mockReset().mockResolvedValue({ provider: "kie", apiKey: "own-key" });
    vi.mocked(assertPromptAllowed).mockReset().mockResolvedValue(undefined);
    vi.mocked(createProviderVideo).mockReset().mockResolvedValue({ taskId: "kie-task", raw: {} });
    await client.exec("TRUNCATE projects, video_generation CASCADE");
  });
  afterAll(async () => { vi.unstubAllEnvs(); await client.close(); });
  it("compiles freely, signs parameters and denies tampering, expiry and another user's preview", async () => {
    const input = await fixture(); const preview = await previewScriptVideo(input);
    expect(preview.payload.input).toMatchObject({ duration: 30, generate_audio: false });
    expect(preview.canGenerate).toBe(true);
    expect(await testDb.select().from(schema.workflowJobs)).toHaveLength(0);
    expect(createProviderVideo).not.toHaveBeenCalled(); expect(assertPromptAllowed).not.toHaveBeenCalled();
    expect(verifyScriptVideoPreview(preview.token, userId, input.projectId).revision).toBe(1);
    expect(() => verifyScriptVideoPreview(preview.token + "x", userId, input.projectId)).toThrow("SCRIPT_VIDEO_INVALID_PREVIEW");
    expect(() => verifyScriptVideoPreview(preview.token, randomUUID(), input.projectId)).toThrow("SCRIPT_VIDEO_INVALID_PREVIEW");
    vi.spyOn(Date, "now").mockReturnValueOnce(preview.snapshot.expiresAt + 1);
    expect(() => verifyScriptVideoPreview(preview.token, userId, input.projectId)).toThrow("SCRIPT_VIDEO_PREVIEW_EXPIRED");
    vi.restoreAllMocks();
  });
  it("freezes the exact reviewed prompt and old revision, preserves scene results, and submits once", async () => {
    const input = await fixture(); const preview = await previewScriptVideo(input);
    const source = await readFullVideoScript(userId, input.projectId, input.versionId, false);
    await saveFullVideoScript({ ...input, content: { ...source.content, summary: "Newer script after preview" } });
    const result = await submitScriptVideo(userId, input.projectId, preview.token);
    expect(result.providerTaskId).toBe("kie-task");
    await submitScriptVideo(userId, input.projectId, preview.token);
    expect(createProviderVideo).toHaveBeenCalledTimes(1);
    expect(createProviderVideo).toHaveBeenCalledWith("kie", expect.objectContaining({ prompt: preview.snapshot.prompt, duration: 30, model: "bytedance/seedance-2-5" }), "own-key", expect.objectContaining({ userId }));
    expect(assertPromptAllowed).toHaveBeenCalledWith(preview.snapshot.prompt, { userId });
    const jobs = await testDb.select().from(schema.workflowJobs);
    expect(jobs).toHaveLength(1);
    expect((jobs[0].input as { snapshot: { revision: number } }).snapshot.revision).toBe(1);
    expect((await testDb.select().from(schema.videoGeneration))[0]).toMatchObject({ projectVersionId: input.versionId, sceneId: null, prompt: preview.snapshot.prompt, duration: 30 });
    expect((await testDb.select().from(schema.sceneVersions))[0].generatedVideoUrl).toBeNull();
    await expect(readScriptVideoJob(randomUUID(), input.projectId, result.generationId)).rejects.toThrow("SCRIPT_NOT_FOUND");
  });
  it("does not call the provider twice after unknown network failure and allows safe retrieval", async () => {
    const input = await fixture(); const preview = await previewScriptVideo(input);
    vi.mocked(createProviderVideo).mockRejectedValue(new Error("network interrupted"));
    const result = await submitScriptVideo(userId, input.projectId, preview.token);
    expect(result).toMatchObject({ stage: "unknown_submission", providerTaskId: null });
    expect((await submitScriptVideo(userId, input.projectId, preview.token)).stage).toBe("unknown_submission");
    expect(createProviderVideo).toHaveBeenCalledTimes(1);
    expect(await testDb.select().from(schema.videoGeneration)).toHaveLength(0);
  });
  it("blocks missing KIE credentials and rejected prompts without a paid call", async () => {
    const input = await fixture(); const preview = await previewScriptVideo(input);
    vi.mocked(getUserCredential).mockResolvedValue(null);
    await expect(submitScriptVideo(userId, input.projectId, preview.token)).rejects.toThrow("SCRIPT_VIDEO_KIE_KEY_REQUIRED");
    vi.mocked(getUserCredential).mockResolvedValue({ provider: "kie", apiKey: "own-key" });
    vi.mocked(assertPromptAllowed).mockRejectedValue(new Error("review required"));
    expect((await submitScriptVideo(userId, input.projectId, preview.token)).status).toBe("failed");
    expect(createProviderVideo).not.toHaveBeenCalled();
    expect(getUserCredential).toHaveBeenCalledWith(userId, "kie");
  });
  it("repairs history from a saved external ID without another supplier request", async () => {
    const input = await fixture(); const content = (await readFullVideoScript(userId, input.projectId, input.versionId, false)).content;
    const { snapshot } = signScriptVideoPreview({ ...input, content });
    await testDb.insert(schema.workflowJobs).values({ id: snapshot.generationId, projectId: input.projectId, type: "GENERATE_VIDEO", status: "processing", externalTaskId: "recovered-task", input: { kind: "full_script_video", snapshot, keyFingerprint: "fingerprint" } });
    await readScriptVideoJob(userId, input.projectId, snapshot.generationId);
    await readScriptVideoJob(userId, input.projectId, snapshot.generationId);
    expect(await testDb.select().from(schema.videoGeneration)).toHaveLength(1);
    expect(createProviderVideo).not.toHaveBeenCalled();
    const [job] = await testDb.select().from(schema.workflowJobs).where(eq(schema.workflowJobs.id, snapshot.generationId));
    expect((job.input as { snapshot: { scriptRevisionId: string } }).snapshot.scriptRevisionId).toBe(`${input.versionId}:1`);
  });
});
