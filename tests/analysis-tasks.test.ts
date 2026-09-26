import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";

const mocks = vi.hoisted(() => ({ db: null as unknown, mode: "trial", analyze: vi.fn(), probe: vi.fn() }));
vi.mock("@/lib/db", async () => ({ ...await import("@/lib/db/schema"), get db() { return mocks.db; } }));
vi.mock("@/lib/auth", () => ({ isAdminProfile: () => false }));
vi.mock("@/lib/billing/video-analysis", () => ({
  FREE_TRIAL_ANALYSIS_MODEL: "gemini-3-8-flash-openai",
  assertCanStartVideoAnalysis: async () => ({ mode: mocks.mode, trial: { remaining: 2 }, capabilities: { videoAnalysis: { canUseLongVideo: mocks.mode !== "trial" } } }),
  getVideoAnalysisChargeUnits: ({ sceneCount, longVideo }: { sceneCount: number; longVideo: boolean }) => sceneCount + (longVideo ? 3 : 0),
}));
vi.mock("@/lib/billing/platform-access", () => ({ getPlatformKieApiKey: () => "platform-test", resolveKieApiKeyForFeature: async () => ({ apiKey: "own-test", source: "user" }) }));
vi.mock("@/lib/billing/commercial-media", () => ({ assertOwnedUploadedVideo: async () => "owned", commercialMediaRequest: mocks.probe }));
vi.mock("@/lib/workflow/scene-analysis", () => ({ analyzeImageBlueprint: mocks.analyze, analyzeSceneBlueprint: mocks.analyze, buildFallbackSceneBlueprint: (_: unknown, reason: string) => ({ story: {}, visual: {}, dialogue: [], narration: [], subtitle: [], audio: {}, transition: {}, generationPrompt: "", metadata: { analysisProvider: "fallback", fallbackReason: reason } }) }));
vi.mock("@/lib/workflow/transcription", () => ({ buildSceneAudioContexts: () => new Map(), transcribeMediaWithKie: async () => null }));
vi.mock("@/lib/workflow/music-recognition", () => ({ recognizeBackgroundMusic: async () => ({ status: "disabled" }) }));
vi.mock("@/lib/workflow/service", () => ({ attachBackgroundMusicToBlueprint: (blueprint: unknown) => blueprint, deriveProjectTitle: () => "Analyzed project" }));

import { enqueueAnalysis, recoverAnalysisTasks, runAnalysisTask } from "@/lib/workflow/analysis-tasks";
import { getUserTrialUsage } from "@/lib/usage/trial-quota";
import { requiresAnalysisQuote } from "@/lib/workflow/analysis-routing";

const client = new PGlite();
const testDb = drizzle(client, { schema });
mocks.db = testDb;
let userId: string;
let projectId: string;
const blueprint = { story: { summary: "real result" }, visual: { subject: "person" }, dialogue: [], narration: [], subtitle: [], audio: {}, transition: {}, generationPrompt: "real prompt", metadata: { analysisProvider: "kie" } };
async function task(id: string) { return (await testDb.select().from(schema.commercialTasks)).find(t => t.id === id)!; }
async function drain(id: string) {
  for (let i = 0; i < 15; i++) {
    await runAnalysisTask(id);
    if (["completed", "failed"].includes((await task(id)).state)) return task(id);
  }
  throw new Error("Task did not finish");
}

describe("durable analysis", () => {
  beforeAll(async () => {
    for (const migration of ["0000_dear_prism", "0003_blushing_thor", "0005_v2_workflow", "0007_foamy_lily_hollister", "0008_payment_orders", "0010_commercial_wallets", "0011_commercial_purchase_lots", "0012_commercial_tasks", "0016_trial_analysis_usage", "0017_request_reservations", "0018_workflow_analysis_tasks"]) {
      await client.exec(readFileSync(`drizzle/${migration}.sql`, "utf8"));
    }
  });
  beforeEach(async () => {
    vi.stubEnv("COMMERCIAL_CONSUMPTION_ENABLED", "false");
    mocks.mode = "trial";
    mocks.analyze.mockReset().mockResolvedValue(blueprint);
    mocks.probe.mockReset();
    userId = randomUUID(); projectId = randomUUID();
    await testDb.insert(schema.user).values({ id: userId, email: `${userId}@example.com` });
    await testDb.insert(schema.projects).values({ id: projectId, userId, title: "test" });
  });
  afterAll(async () => { vi.unstubAllEnvs(); await client.close(); });

  it("keeps trial and short BYOK available with commercial billing enabled", () => {
    const input = { commercialEnabled: true, mediaType: "video" as const, longVideo: false, trialRemaining: 2 };
    expect(requiresAnalysisQuote({ ...input, mode: "trial" })).toBe(false);
    expect(requiresAnalysisQuote({ ...input, mode: "byok" })).toBe(false);
    expect(requiresAnalysisQuote({ ...input, mode: "trial", trialRemaining: 0 })).toBe(true);
    expect(requiresAnalysisQuote({ ...input, mode: "byok", longVideo: true })).toBe(true);
  });

  it("reuses a task on resubmission and consumes exactly one trial", async () => {
    vi.stubEnv("COMMERCIAL_CONSUMPTION_ENABLED", "true");
    const body = { mediaType: "image", mediaUrl: "https://r2.example/a.png", modelMode: "manual", modelId: "analysis-gemini-2-5-pro" };
    const queued = await enqueueAnalysis(userId, projectId, body);
    expect((await enqueueAnalysis(userId, projectId, body)).id).toBe(queued.id);
    await Promise.all([runAnalysisTask(queued.id), runAnalysisTask(queued.id)]);
    expect((await drain(queued.id)).state).toBe("completed");
    expect(mocks.analyze).toHaveBeenCalledTimes(1);
    expect(mocks.analyze.mock.calls[0][0]).toMatchObject({ modelId: "gemini-3-8-flash-openai", forceFreeTrialKie: true, analysisApiKey: "platform-test" });
    expect(await getUserTrialUsage(userId)).toMatchObject({ used: 1 });
    await runAnalysisTask(queued.id);
    expect(mocks.analyze).toHaveBeenCalledTimes(1);
  });

  it("returns failed trials and never persists a fabricated successful prompt", async () => {
    mocks.analyze.mockRejectedValue(new Error("provider unavailable"));
    const queued = await enqueueAnalysis(userId, projectId, { mediaType: "image", mediaUrl: "https://r2.example/a.png" });
    expect((await drain(queued.id)).state).toBe("failed");
    expect(await getUserTrialUsage(userId)).toMatchObject({ used: 0 });
    const rows = await testDb.select().from(schema.sceneVersions);
    expect(rows.find(r => r.projectId === projectId)?.generationPrompt).toBe("");
  });

  it("settles only delivered scenes, including after a worker disappears", async () => {
    mocks.mode = "platform_credits";
    await testDb.insert(schema.userCredits).values({ userId, balance: 20 });
    const scenes = [0, 1].map(i => ({ sceneIndex: i + 1, startTime: i * 10, endTime: (i + 1) * 10, duration: 10, keyframeUrls: ["https://r2.example/frame.png"] }));
    mocks.probe.mockResolvedValueOnce({ durationUs: 20_000_000, bytes: 500, sourceHash: "a".repeat(64), scenes: scenes.map((_, i) => ({ id: String(i + 1), startUs: i * 10_000_000, endUs: (i + 1) * 10_000_000 })) }).mockResolvedValueOnce({ scenes, metadata: { duration: 20 } });
    const queued = await enqueueAnalysis(userId, projectId, { mediaType: "video", mediaUrl: "https://r2.example/a.mp4", mediaDuration: 20 });
    for (let i = 0; i < 5; i++) await runAnalysisTask(queued.id);
    expect((await task(queued.id)).result).toMatchObject({ successful: 1, heldCredits: 5 });
    await client.query("UPDATE commercial_tasks SET state = 'running', updated_at = now() - interval '7 minutes' WHERE id = $1", [queued.id]);
    await recoverAnalysisTasks();
    expect((await task(queued.id)).result).toMatchObject({ chargedCredits: 4, partial: true });
    expect((await testDb.select().from(schema.userCredits)).find(r => r.userId === userId)?.balance).toBe(16);
    await recoverAnalysisTasks();
    await runAnalysisTask(queued.id);
    expect(mocks.analyze).toHaveBeenCalledTimes(1);
  });

  it("checks actual video duration before calling a trial model", async () => {
    mocks.probe.mockResolvedValue({ durationUs: 30_000_000, bytes: 500, scenes: [{ id: "1" }] });
    const queued = await enqueueAnalysis(userId, projectId, { mediaType: "video", mediaDuration: 5, mediaUrl: "https://r2.example/a.mp4" });
    expect((await drain(queued.id)).state).toBe("failed");
    expect(mocks.analyze).not.toHaveBeenCalled();
    expect(await getUserTrialUsage(userId)).toMatchObject({ used: 0 });
  });

  it("does not refund a delivered trial when the final settlement was interrupted", async () => {
    const queued = await enqueueAnalysis(userId, projectId, { mediaType: "image", mediaUrl: "https://r2.example/a.png" });
    for (let i = 0; i < 3; i++) await runAnalysisTask(queued.id);
    expect((await task(queued.id)).result).toMatchObject({ successful: 1 });
    await client.query("UPDATE trial_analysis_reservations SET expires_at = now() - interval '1 minute' WHERE user_id = $1", [userId]);
    expect(await getUserTrialUsage(userId)).toMatchObject({ used: 1 });
    await drain(queued.id);
    expect(await getUserTrialUsage(userId)).toMatchObject({ used: 1 });
    expect(mocks.analyze).toHaveBeenCalledTimes(1);
  });

  it("expires queued analysis without calling the provider or consuming a trial", async () => {
    const queued = await enqueueAnalysis(userId, projectId, { mediaType: "image", mediaUrl: "https://r2.example/a.png" });
    await client.query("UPDATE commercial_tasks SET expires_at = now() - interval '1 minute' WHERE id = $1", [queued.id]);
    await runAnalysisTask(queued.id);
    expect((await task(queued.id)).state).toBe("failed");
    expect(await getUserTrialUsage(userId)).toMatchObject({ used: 0 });
    expect(mocks.analyze).not.toHaveBeenCalled();
  });

  it("rejects a late result after recovery has released its trial", async () => {
    const queued = await enqueueAnalysis(userId, projectId, { mediaType: "image", mediaUrl: "https://r2.example/a.png" });
    await runAnalysisTask(queued.id);
    await runAnalysisTask(queued.id);
    let deliver!: (value: typeof blueprint) => void;
    let started!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    mocks.analyze.mockImplementationOnce(() => { started(); return new Promise(resolve => { deliver = resolve; }); });
    const running = runAnalysisTask(queued.id);
    await entered;
    await client.query("UPDATE commercial_tasks SET updated_at = now() - interval '7 minutes' WHERE id = $1", [queued.id]);
    await recoverAnalysisTasks();
    deliver(blueprint);
    await running;
    expect((await task(queued.id)).state).toBe("failed");
    expect((await testDb.select().from(schema.sceneVersions)).filter(row => row.projectId === projectId)).toHaveLength(0);
    expect(await getUserTrialUsage(userId)).toMatchObject({ used: 0 });
  });
});
