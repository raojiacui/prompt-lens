import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";

const mocks = vi.hoisted(() => ({ db: null as unknown, mode: "trial", provider: "kie", ownKey: true, analyze: vi.fn(), probe: vi.fn() }));
vi.mock("@/lib/db", async () => ({ ...await import("@/lib/db/schema"), get db() { return mocks.db; } }));
vi.mock("@/lib/auth", () => ({ isAdminProfile: () => false }));
vi.mock("@/lib/billing/video-analysis", () => ({
  FREE_TRIAL_ANALYSIS_MODEL: "deepseek-v4-1-flash",
  assertCanStartVideoAnalysis: async () => ({ mode: mocks.mode, trial: { remaining: 2 }, capabilities: { videoAnalysis: { canUseLongVideo: mocks.mode !== "trial" } } }),
  getWorkflowAnalysisEntitlement: async () => ({ mode: mocks.mode, trial: { remaining: 2 }, capabilities: { videoAnalysis: { canUseLongVideo: mocks.mode !== "trial" } } }),
  getVideoAnalysisChargeUnits: ({ sceneCount, longVideo }: { sceneCount: number; longVideo: boolean }) => sceneCount + (longVideo ? 3 : 0),
}));
vi.mock("@/lib/billing/platform-access", () => ({ getPlatformKieApiKey: () => "platform-test", resolveApiKeyForFeature: async () => ({ apiKey: "own-test", source: "user", provider: mocks.provider }) }));
vi.mock("@/lib/cloudflare/r2", () => ({ getR2ObjectSize: async () => 500, copyR2Object: async (_source: string, key: string) => `https://r2.example/${key}` }));
vi.mock("@/lib/byok/credentials", () => ({ getUserCredential: async (_user: string, provider?: string) => mocks.ownKey ? ({ apiKey: "own-test", provider: provider || mocks.provider }) : null }));
vi.mock("@/lib/billing/commercial-media", () => ({ assertOwnedUploadedVideo: async () => "owned", commercialMediaRequest: mocks.probe }));
vi.mock("@/lib/workflow/scene-analysis", () => ({ analyzeImageBlueprint: mocks.analyze, analyzeSceneBlueprint: mocks.analyze, buildFallbackSceneBlueprint: (_: unknown, reason: string) => ({ story: {}, visual: {}, dialogue: [], narration: [], subtitle: [], audio: {}, transition: {}, generationPrompt: "", metadata: { analysisProvider: "fallback", fallbackReason: reason } }) }));
vi.mock("@/lib/workflow/transcription", () => ({ buildSceneAudioContexts: () => new Map(), transcribeMedia: async () => null }));
vi.mock("@/lib/workflow/music-recognition", () => ({ recognizeBackgroundMusic: async () => ({ status: "disabled" }) }));
vi.mock("@/lib/workflow/service", () => ({ attachBackgroundMusicToBlueprint: (blueprint: unknown) => blueprint, deriveProjectTitle: () => "Analyzed project" }));

import { quoteImageAnalysis, enqueueAnalysis, recoverAnalysisTasks, runAnalysisTask, finalizeCheckpointedWorkflow } from "@/lib/workflow/analysis-tasks";
import { confirmCommercialTask } from "@/lib/billing/commercial-task-runner";
import { grantCommercialPurchase } from "@/lib/billing/commercial-wallet";
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
    for (const migration of ["0000_dear_prism", "0003_blushing_thor", "0005_v2_workflow", "0007_foamy_lily_hollister", "0008_payment_orders", "0010_commercial_wallets", "0011_commercial_purchase_lots", "0028_expiring_admin_entitlements", "0012_commercial_tasks", "0016_trial_analysis_usage", "0017_request_reservations", "0018_workflow_analysis_tasks", "0019_media_cleanup_jobs"]) {
      await client.exec(readFileSync(`drizzle/${migration}.sql`, "utf8"));
    }
  });
  beforeEach(async () => {
    vi.stubEnv("COMMERCIAL_CONSUMPTION_ENABLED", "false");
    mocks.mode = "trial";
    mocks.provider = "kie";
    mocks.ownKey = true;
    mocks.analyze.mockReset().mockResolvedValue(blueprint);
    mocks.probe.mockReset().mockImplementation(async (_url: string, body: { mode: string }) => body.mode === "preview"
      ? { durationUs: 3_000_000, bytes: 500, sourceHash: "a".repeat(64), scenes: [{ id: "1", startUs: 0, endUs: 3_000_000 }] }
      : { scenes: [{ sceneIndex: 1, startTime: 0, endTime: 3, duration: 3, keyframeUrls: ["https://r2.example/frame.png"] }], metadata: { duration: 3 } });
    userId = randomUUID(); projectId = randomUUID();
    await testDb.insert(schema.user).values({ id: userId, email: `${userId}@example.com`, emailVerified: true });
    await testDb.insert(schema.projects).values({ id: projectId, userId, title: "test" });
  });
  afterAll(async () => { vi.unstubAllEnvs(); await client.close(); });

  it("requires a confirmed paid quote for images and leaves video trials untouched", async () => {
    vi.stubEnv("COMMERCIAL_CONSUMPTION_ENABLED", "true");
    await expect(enqueueAnalysis(userId, projectId, { mediaType: "image", mediaUrl: "https://r2.example/a.png" })).rejects.toThrow("CONFIRMED_QUOTE_REQUIRED");
    expect(await getUserTrialUsage(userId)).toMatchObject({ used: 0 });
    expect(mocks.analyze).not.toHaveBeenCalled();
  });

  it.each([true, false])("settles a paid image exactly once after durable delivery (success=%s)", async success => {
    vi.stubEnv("COMMERCIAL_CONSUMPTION_ENABLED", "true");
    await testDb.transaction(tx => grantCommercialPurchase(tx as never, { userId, orderId: randomUUID(), packageId: "v6_trial_200", credits: 200, rewrites: 20 }));
    const source = { projectId, mediaUrl: "https://r2.example/a.png", modelId: "analysis-gemini-3-8-flash" };
    const quote = await quoteImageAnalysis(userId, source);
    expect(quote.credits).toBe(4);
    expect((await quoteImageAnalysis(userId, source)).id).toBe(quote.id);
    await expect(quoteImageAnalysis(userId, { ...source, modelId: "analysis-deepseek-v4-1-flash" })).rejects.toThrow("IMAGE_QUOTE_CONFLICT");
    expect((await task(quote.id)).state).toBe("quoted");
    await runAnalysisTask(quote.id);
    expect(mocks.analyze).not.toHaveBeenCalled();
    await confirmCommercialTask(userId, quote.id);
    await confirmCommercialTask(userId, quote.id);
    expect((await testDb.select().from(schema.commercialWallets)).find(w => w.userId === userId)).toMatchObject({ credits: 196, heldCredits: 4 });
    if (!success) mocks.analyze.mockRejectedValueOnce(new Error("Unreadable image"));
    const finished = await drain(quote.id);
    expect(finished.state).toBe(success ? "completed" : "failed");
    expect(finished.result).toMatchObject({ chargedCredits: success ? 4 : 0 });
    await runAnalysisTask(quote.id);
    expect((await testDb.select().from(schema.commercialWallets)).find(w => w.userId === userId)).toMatchObject({ credits: success ? 196 : 200, heldCredits: 0 });
    const reservations = (await testDb.select().from(schema.commercialReservations)).filter(r => r.userId === userId);
    expect(reservations).toHaveLength(1);
    expect(reservations[0]).toMatchObject({ state: "settled", settledCredits: success ? 4 : 0 });
    expect((await testDb.select().from(schema.commercialLedger)).filter(l => l.userId === userId && l.eventKey.startsWith("settle:"))).toHaveLength(1);
    expect((await testDb.select().from(schema.creditLedger)).filter(l => l.userId === userId)).toHaveLength(0);
    expect(await getUserTrialUsage(userId)).toMatchObject({ used: 0 });
    expect(mocks.analyze).toHaveBeenCalledTimes(1);
    expect(mocks.analyze.mock.calls[0][0]).toMatchObject({ analysisProvider: "kie", analysisApiKey: "platform-test" });
  });

  it("recovers a paid image checkpoint and charges once without another inference", async () => {
    vi.stubEnv("COMMERCIAL_CONSUMPTION_ENABLED", "true");
    await testDb.transaction(tx => grantCommercialPurchase(tx as never, { userId, orderId: randomUUID(), packageId: "v6_trial_200", credits: 200, rewrites: 20 }));
    const quote = await quoteImageAnalysis(userId, { projectId, mediaUrl: "https://r2.example/a.png", modelId: "analysis-deepseek-v4-1-flash" });
    await confirmCommercialTask(userId, quote.id);
    await runAnalysisTask(quote.id); await runAnalysisTask(quote.id);
    let interrupted!: { mockRestore(): void };
    mocks.analyze.mockImplementationOnce(async () => {
      interrupted = vi.spyOn(testDb, "transaction").mockResolvedValueOnce(undefined as never);
      return blueprint;
    });
    await runAnalysisTask(quote.id); interrupted.mockRestore();
    expect((await task(quote.id))).toMatchObject({ state: "running", result: { pendingScene: { blueprint: { generationPrompt: "real prompt" } } } });
    expect((await testDb.select().from(schema.commercialWallets)).find(w => w.userId === userId)).toMatchObject({ credits: 198, heldCredits: 2 });
    await client.query("UPDATE commercial_tasks SET updated_at=now()-interval '25 seconds' WHERE id=$1", [quote.id]);
    await recoverAnalysisTasks({ dispatch: false });
    await drain(quote.id);
    expect((await task(quote.id))).toMatchObject({ state: "completed", result: { chargedCredits: 2 } });
    expect((await testDb.select().from(schema.commercialWallets)).find(w => w.userId === userId)).toMatchObject({ credits: 198, heldCredits: 0 });
    expect(mocks.analyze).toHaveBeenCalledTimes(1);
  });

  it("rejects expired and other-user image quotes without reserving funds", async () => {
    vi.stubEnv("COMMERCIAL_CONSUMPTION_ENABLED", "true");
    const quote = await quoteImageAnalysis(userId, { projectId, mediaUrl: "https://r2.example/a.png", modelId: "analysis-deepseek-v4-1-flash" });
    await expect(confirmCommercialTask(randomUUID(), quote.id)).rejects.toThrow("TASK_NOT_FOUND");
    await client.query("UPDATE commercial_tasks SET expires_at=now()-interval '1 minute' WHERE id=$1", [quote.id]);
    await expect(confirmCommercialTask(userId, quote.id)).rejects.toThrow("QUOTE_EXPIRED");
    expect((await testDb.select().from(schema.commercialReservations)).filter(r => r.userId === userId)).toHaveLength(0);
    expect(mocks.analyze).not.toHaveBeenCalled();
  });

  it("quotes KIE 3.7 at the 3.8 rate and persists the requested and actual models", async () => {
    vi.stubEnv("COMMERCIAL_CONSUMPTION_ENABLED", "true");
    const quote = await quoteImageAnalysis(userId, { projectId, mediaUrl: "https://r2.example/a.png", modelId: "analysis-gemini-3-7-flash" });
    expect(quote).toMatchObject({ credits: 4, modelId: "analysis-gemini-3-7-flash" });
    expect((await task(quote.id)).input).toMatchObject({ modelId: "gemini-3-8-flash-openai", commercialImage: { modelId: "analysis-gemini-3-7-flash", version: "2026-11-28-image-v2" } });
    expect(mocks.analyze).not.toHaveBeenCalled();
  });

  it("does not start an image without sufficient purchased credits", async () => {
    vi.stubEnv("COMMERCIAL_CONSUMPTION_ENABLED", "true");
    const quote = await quoteImageAnalysis(userId, { projectId, mediaUrl: "https://r2.example/a.png", modelId: "analysis-deepseek-v4-1-flash" });
    await expect(confirmCommercialTask(userId, quote.id)).rejects.toThrow("INSUFFICIENT_COMMERCIAL_BALANCE");
    expect((await task(quote.id)).state).toBe("quoted");
    expect(mocks.analyze).not.toHaveBeenCalled();
  });

  it("keeps introductory trials direct and requires a quote for BYOK and splitting", () => {
    const input = { commercialEnabled: true, mediaType: "video" as const, trialRemaining: 2 };
    expect(requiresAnalysisQuote({ ...input, mode: "trial" })).toBe(false);
    expect(requiresAnalysisQuote({ ...input, mode: "byok" })).toBe(true);
    expect(requiresAnalysisQuote({ ...input, mode: "trial", trialRemaining: 0 })).toBe(true);
    expect(requiresAnalysisQuote({ ...input, mode: "byok", automaticSplit: true })).toBe(true);
    expect(requiresAnalysisQuote({ ...input, mode: "trial", automaticSplit: true })).toBe(true);
  });

  it("reuses a task on resubmission and consumes exactly one trial", async () => {
    vi.stubEnv("COMMERCIAL_CONSUMPTION_ENABLED", "true");
    const body = { mediaType: mocks.mode === "trial" ? "video" : "image", mediaUrl: "https://r2.example/a.png", modelMode: "manual", modelId: "analysis-gemini-2-5-pro" };
    const queued = await enqueueAnalysis(userId, projectId, body);
    expect((await enqueueAnalysis(userId, projectId, body)).id).toBe(queued.id);
    await Promise.all([runAnalysisTask(queued.id), runAnalysisTask(queued.id)]);
    expect((await drain(queued.id)).state).toBe("completed");
    expect(mocks.analyze).toHaveBeenCalledTimes(1);
    expect(mocks.analyze.mock.calls[0][0]).toMatchObject({ modelId: "deepseek-v4-1-flash", forceFreeTrialKie: true, analysisApiKey: "platform-test" });
    expect(await getUserTrialUsage(userId)).toMatchObject({ used: 1 });
    await runAnalysisTask(queued.id);
    expect(mocks.analyze).toHaveBeenCalledTimes(1);
  });

  it("returns failed trials and never persists a fabricated successful prompt", async () => {
    mocks.analyze.mockRejectedValue(new Error("provider unavailable"));
    const queued = await enqueueAnalysis(userId, projectId, { mediaType: mocks.mode === "trial" ? "video" : "image", mediaUrl: "https://r2.example/a.png" });
    expect((await drain(queued.id)).state).toBe("failed");
    expect(await getUserTrialUsage(userId)).toMatchObject({ used: 0 });
    const rows = await testDb.select().from(schema.sceneVersions);
    expect(rows.find(r => r.projectId === projectId)?.generationPrompt).toBe("");
  });

  it("persists Infistar routing and counts real Infistar analysis as successful", async () => {
    mocks.mode = "byok";
    mocks.provider = "infistar";
    mocks.analyze.mockResolvedValue({ ...blueprint, metadata: { analysisProvider: "infistar" } });
    const queued = await enqueueAnalysis(userId, projectId, { mediaType: mocks.mode === "trial" ? "video" : "image", mediaUrl: "https://r2.example/a.png" });
    expect(queued.input).toMatchObject({ provider: "infistar", keySource: "user" });
    mocks.provider = "kie"; // Preference can change while the queued task is waiting.
    expect((await drain(queued.id)).state).toBe("completed");
    expect(mocks.analyze.mock.calls[0][0]).toMatchObject({ analysisProvider: "infistar", analysisApiKey: "own-test" });
    expect((await task(queued.id)).result).toMatchObject({ successful: 1, failed: 0 });
  });

  it.each([undefined, "platform"])("keeps admin platform image analysis on KIE despite a preferred Infistar key (payer=%s)", async payer => {
    mocks.mode = "admin";
    mocks.provider = "infistar";
    vi.stubEnv("COMMERCIAL_CONSUMPTION_ENABLED", "true");
    const queued = await enqueueAnalysis(userId, projectId, { mediaType: mocks.mode === "trial" ? "video" : "image", mediaUrl: "https://r2.example/a.png", payer });
    expect(queued.input).toMatchObject({ mode: "admin", provider: "kie", keySource: "platform" });
    await drain(queued.id);
    expect(mocks.analyze.mock.calls[0][0]).toMatchObject({ analysisProvider: "kie", analysisApiKey: "platform-test", forceFreeTrialKie: false });
  });

  it("honors an administrator explicitly selecting their own Infistar key for an image", async () => {
    mocks.mode = "admin";
    mocks.provider = "infistar";
    const queued = await enqueueAnalysis(userId, projectId, { mediaType: mocks.mode === "trial" ? "video" : "image", mediaUrl: "https://r2.example/a.png", payer: "byok" });
    expect(queued.input).toMatchObject({ mode: "byok", provider: "infistar", keySource: "user" });
    await drain(queued.id);
    expect(mocks.analyze.mock.calls[0][0]).toMatchObject({ analysisProvider: "infistar", analysisApiKey: "own-test" });
  });

  it("rejects unquoted platform consumption instead of falling back to a personal key", async () => {
    mocks.mode = "byok";
    mocks.provider = "infistar";
    await expect(enqueueAnalysis(userId, projectId, { mediaType: mocks.mode === "trial" ? "video" : "image", mediaUrl: "https://r2.example/a.png", payer: "platform" })).rejects.toThrow("CONFIRMED_QUOTE_REQUIRED");
    expect(mocks.analyze).not.toHaveBeenCalled();
  });

  it("never substitutes a platform key when an admin selects BYOK without a saved key", async () => {
    mocks.mode = "admin";
    mocks.ownKey = false;
    await expect(enqueueAnalysis(userId, projectId, { mediaType: mocks.mode === "trial" ? "video" : "image", mediaUrl: "https://r2.example/a.png", payer: "byok" })).rejects.toThrow("KIE_BYOK_REQUIRED");
    expect(mocks.analyze).not.toHaveBeenCalled();
  });

  it("settles only delivered scenes, including after a worker disappears", async () => {
    mocks.mode = "platform_credits";
    await testDb.insert(schema.userCredits).values({ userId, balance: 20 });
    const scenes = [0, 1].map(i => ({ sceneIndex: i + 1, startTime: i * 10, endTime: (i + 1) * 10, duration: 10, keyframeUrls: ["https://r2.example/frame.png"] }));
    mocks.probe.mockResolvedValueOnce({ durationUs: 20_000_000, bytes: 500, sourceHash: "a".repeat(64), scenes: scenes.map((_, i) => ({ id: String(i + 1), startUs: i * 10_000_000, endUs: (i + 1) * 10_000_000 })) }).mockResolvedValueOnce({ scenes, metadata: { duration: 20 } });
    const queued = await enqueueAnalysis(userId, projectId, { mediaType: "video", mediaUrl: "https://r2.example/a.mp4", mediaDuration: 20 });
    // Historical queued tasks retain their previously granted long-video access.
    await client.query("UPDATE commercial_tasks SET input = jsonb_set(input, '{longVideoAllowed}', 'true') WHERE id = $1", [queued.id]);
    for (let i = 0; i < 5; i++) await runAnalysisTask(queued.id);
    expect((await task(queued.id)).result).toMatchObject({ successful: 1, heldCredits: 5 });
    await client.query("UPDATE commercial_tasks SET state = 'running', updated_at = now() - interval '7 minutes' WHERE id = $1", [queued.id]);
    await recoverAnalysisTasks();
    expect((await task(queued.id)).state).toBe("queued");
    expect((await task(queued.id)).result).toMatchObject({ cursor: 2, successful: 1, failed: 1 });
    await runAnalysisTask(queued.id);
    expect((await task(queued.id)).result).toMatchObject({ chargedCredits: 4, partial: true });
    expect((await testDb.select().from(schema.userCredits)).find(r => r.userId === userId)?.balance).toBe(16);
    await recoverAnalysisTasks();
    await runAnalysisTask(queued.id);
    expect(mocks.analyze).toHaveBeenCalledTimes(1);
  });

  it("continues later workflow shots after an uncertain model call", async () => {
    mocks.mode = "platform_credits";
    await testDb.insert(schema.userCredits).values({ userId, balance: 30 });
    const scenes = [0, 1, 2].map(i => ({ sceneIndex: i + 1, startTime: i * 10, endTime: (i + 1) * 10, duration: 10, keyframeUrls: ["https://r2.example/frame.png"] }));
    mocks.probe.mockResolvedValueOnce({ durationUs: 30_000_000, bytes: 500, sourceHash: "a".repeat(64), scenes: scenes.map((_, i) => ({ id: String(i + 1), startUs: i * 10_000_000, endUs: (i + 1) * 10_000_000 })) }).mockResolvedValueOnce({ scenes, metadata: { duration: 30 } });
    const queued = await enqueueAnalysis(userId, projectId, { mediaType: "video", mediaUrl: "https://r2.example/a.mp4" });
    await client.query("UPDATE commercial_tasks SET input = jsonb_set(input, '{longVideoAllowed}', 'true') WHERE id = $1", [queued.id]);
    for (let i = 0; i < 5; i++) await runAnalysisTask(queued.id);
    await client.query("UPDATE commercial_tasks SET state = 'running', updated_at = now() - interval '7 minutes' WHERE id = $1", [queued.id]);
    await recoverAnalysisTasks();
    expect((await task(queued.id)).result).toMatchObject({ cursor: 2, successful: 1, failed: 1 });
    await drain(queued.id);
    expect((await task(queued.id)).result).toMatchObject({ successful: 2, failed: 1, partial: true });
    expect(mocks.analyze).toHaveBeenCalledTimes(2);
    expect((await testDb.select().from(schema.sceneVersions)).filter(row => row.projectId === projectId).map(row => (row.metadata as Record<string, unknown>).analysisProvider)).toEqual(["kie", "fallback", "kie"]);
  });

  it("rejects invalid worker intervals before calling a trial model", async () => {
    mocks.probe.mockResolvedValue({ durationUs: 30_000_000, bytes: 500, scenes: [{ id: "1" }] });
    const queued = await enqueueAnalysis(userId, projectId, { mediaType: "video", mediaDuration: 5, mediaUrl: "https://r2.example/a.mp4" });
    expect((await drain(queued.id)).state).toBe("failed");
    expect(mocks.analyze).not.toHaveBeenCalled();
    expect(await getUserTrialUsage(userId)).toMatchObject({ used: 0 });
  });

  it("preserves historical queued long-video tasks", async () => {
    mocks.mode = "platform_credits";
    await testDb.insert(schema.userCredits).values({ userId, balance: 100 });
    const scenes = Array.from({ length: 30 }, (_, i) => ({ sceneIndex: i + 1, startTime: i * 6, endTime: (i + 1) * 6, duration: 6, keyframeUrls: ["https://r2.example/frame.png"] }));
    mocks.probe.mockResolvedValueOnce({ durationUs: 180_000_000, bytes: 500, sourceHash: "a".repeat(64), scenes: scenes.map((s, i) => ({ id: String(i + 1), startUs: s.startTime * 1e6, endUs: s.endTime * 1e6 })) }).mockResolvedValueOnce({ scenes, metadata: { duration: 180 } });
    const queued = await enqueueAnalysis(userId, projectId, { mediaType: "video", mediaUrl: "https://r2.example/a.mp4", mediaDuration: 180 });
    await client.query("UPDATE commercial_tasks SET input = jsonb_set(input, '{longVideoAllowed}', 'true') WHERE id = $1", [queued.id]);
    await runAnalysisTask(queued.id);
    await runAnalysisTask(queued.id);
    expect((await task(queued.id)).result).toMatchObject({ phase: "transcription", heldCredits: 33 });
    expect((await testDb.select().from(schema.videoScenes)).filter(s => s.projectId === projectId)).toHaveLength(30);
    expect(mocks.analyze).not.toHaveBeenCalled();
  });

  it.each(["trial", "byok", "platform_credits", "admin"])("analyzes a sixty-second upload as one shot for %s", async mode => {
    mocks.mode = mode;
    if (mode === "platform_credits") await testDb.insert(schema.userCredits).values({ userId, balance: 100 });
    mocks.probe.mockResolvedValueOnce({ durationUs: 60_000_000, bytes: 500, sourceHash: "a".repeat(64), scenes: [{ id: "1", startUs: 0, endUs: 60_000_000 }] }).mockResolvedValueOnce({ scenes: [{ sceneIndex: 1, startTime: 0, endTime: 60, duration: 60, keyframeUrls: ["https://r2.example/frame.png"] }], metadata: { duration: 60 } });
    const queued = await enqueueAnalysis(userId, projectId, { mediaType: "video", mediaDuration: 5, mediaUrl: "https://r2.example/a.mp4" });
    expect((await drain(queued.id)).state).toBe("completed");
    expect(mocks.probe).toHaveBeenCalledWith("https://r2.example/a.mp4", { mode: "preview", automaticSplit: false });
    expect(mocks.analyze).toHaveBeenCalledTimes(1);
    expect(mocks.analyze.mock.calls[0][0].scene.duration).toBe(60);
  });

  it("does not allow splitting through the unbilled whole-video endpoint", async () => {
    await expect(enqueueAnalysis(userId, projectId, { mediaType: "video", mediaUrl: "https://r2.example/a.mp4", automaticSplit: true })).rejects.toThrow("CONFIRMED_QUOTE_REQUIRED");
    expect(mocks.probe).not.toHaveBeenCalled();
  });

  it("does not refund a delivered trial when the final settlement was interrupted", async () => {
    const queued = await enqueueAnalysis(userId, projectId, { mediaType: mocks.mode === "trial" ? "video" : "image", mediaUrl: "https://r2.example/a.png" });
    for (let i = 0; i < 3; i++) await runAnalysisTask(queued.id);
    expect((await task(queued.id)).result).toMatchObject({ successful: 1 });
    await client.query("UPDATE trial_analysis_reservations SET expires_at = now() - interval '1 minute' WHERE user_id = $1", [userId]);
    expect(await getUserTrialUsage(userId)).toMatchObject({ used: 1 });
    await drain(queued.id);
    expect(await getUserTrialUsage(userId)).toMatchObject({ used: 1 });
    expect(mocks.analyze).toHaveBeenCalledTimes(1);
  });

  it("expires queued analysis without calling the provider or consuming a trial", async () => {
    const queued = await enqueueAnalysis(userId, projectId, { mediaType: mocks.mode === "trial" ? "video" : "image", mediaUrl: "https://r2.example/a.png" });
    await client.query("UPDATE commercial_tasks SET expires_at = now() - interval '1 minute' WHERE id = $1", [queued.id]);
    await runAnalysisTask(queued.id);
    expect((await task(queued.id)).state).toBe("failed");
    expect(await getUserTrialUsage(userId)).toMatchObject({ used: 0 });
    expect(mocks.analyze).not.toHaveBeenCalled();
  });

  it("finalizes an interrupted failed checkpoint once without another model call", async () => {
    mocks.analyze.mockRejectedValue(new Error("provider interrupted"));
    const queued = await enqueueAnalysis(userId, projectId, { mediaType: mocks.mode === "trial" ? "video" : "image", mediaUrl: "https://r2.example/a.png" });
    for (let index = 0; index < 3; index++) await runAnalysisTask(queued.id);
    await client.query("UPDATE commercial_tasks SET state='running', updated_at=now()-interval '70 seconds' WHERE id=$1", [queued.id]);
    const stale = await task(queued.id);
    expect(await finalizeCheckpointedWorkflow(stale)).toBe(true);
    expect((await task(queued.id))).toMatchObject({ state: "failed", result: { chargedCredits: 0, failed: 1, phase: "settle" } });
    expect(await getUserTrialUsage(userId)).toMatchObject({ used: 0 });
    expect(await finalizeCheckpointedWorkflow(stale)).toBe(false);
    expect(mocks.analyze).toHaveBeenCalledTimes(1);
  });

  it("settles a delivered checkpoint after its reservation expires without losing the result", async () => {
    const queued = await enqueueAnalysis(userId, projectId, { mediaType: mocks.mode === "trial" ? "video" : "image", mediaUrl: "https://r2.example/a.png" });
    for (let index = 0; index < 3; index++) await runAnalysisTask(queued.id);
    await client.query("UPDATE trial_analysis_reservations SET expires_at=now()-interval '1 minute' WHERE user_id=$1", [userId]);
    expect(await finalizeCheckpointedWorkflow(await task(queued.id))).toBe(true);
    expect((await task(queued.id)).state).toBe("completed");
    expect(await getUserTrialUsage(userId)).toMatchObject({ used: 1 });
    expect(mocks.analyze).toHaveBeenCalledTimes(1);
  });

  it("rejects a late result after recovery has released its trial", async () => {
    const queued = await enqueueAnalysis(userId, projectId, { mediaType: mocks.mode === "trial" ? "video" : "image", mediaUrl: "https://r2.example/a.png" });
    await runAnalysisTask(queued.id);
    await runAnalysisTask(queued.id);
    let deliver!: (value: typeof blueprint) => void;
    let started!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    mocks.analyze.mockImplementationOnce(() => { started(); return new Promise(resolve => { deliver = resolve; }); });
    const running = runAnalysisTask(queued.id);
    await entered;
    expect(await finalizeCheckpointedWorkflow(await task(queued.id))).toBe(false);
    await client.query("UPDATE commercial_tasks SET updated_at = now() - interval '7 minutes' WHERE id = $1", [queued.id]);
    await recoverAnalysisTasks();
    deliver(blueprint);
    await running;
    await runAnalysisTask(queued.id);
    expect((await task(queued.id)).state).toBe("failed");
    expect((await testDb.select().from(schema.sceneVersions)).filter(row => row.projectId === projectId)).toMatchObject([{ generationPrompt: "", metadata: { failureCode: "ANALYSIS_INTERRUPTED", providerOutcome: "unknown" } }]);
    expect(await getUserTrialUsage(userId)).toMatchObject({ used: 0 });
  });

  it.each([true, false])("recovers a checkpoint without repeating inference and validates its prompt (usable=%s)", async usable => {
    const queued = await enqueueAnalysis(userId, projectId, { mediaType: mocks.mode === "trial" ? "video" : "image", mediaUrl: "https://r2.example/a.png" });
    await runAnalysisTask(queued.id); await runAnalysisTask(queued.id);
    let interrupted: { mockRestore(): void };
    mocks.analyze.mockImplementationOnce(async () => {
      interrupted = vi.spyOn(testDb, "transaction").mockResolvedValueOnce(undefined as never);
      return blueprint;
    });
    await runAnalysisTask(queued.id);
    interrupted!.mockRestore();
    expect((await task(queued.id))).toMatchObject({ state: "running", result: { cursor: 0, pendingScene: { cursor: 0, blueprint: { generationPrompt: "real prompt" } } } });
    expect(mocks.analyze).toHaveBeenCalledTimes(1);
    expect(await finalizeCheckpointedWorkflow(await task(queued.id))).toBe(false);
    if (!usable) await client.query("UPDATE commercial_tasks SET result=jsonb_set(result,'{pendingScene,blueprint,generationPrompt}','\"\"'::jsonb) WHERE id=$1", [queued.id]);
    await client.query("UPDATE commercial_tasks SET updated_at=now()-interval '25 seconds' WHERE id=$1", [queued.id]);
    mocks.ownKey = false;
    await recoverAnalysisTasks({ dispatch: false });
    expect((await task(queued.id))).toMatchObject({ state: "queued", result: { cursor: 1 } });
    await drain(queued.id);
    expect((await task(queued.id)).state).toBe(usable ? "completed" : "failed");
    expect(await getUserTrialUsage(userId)).toMatchObject({ used: usable ? 1 : 0 });
    expect(mocks.analyze).toHaveBeenCalledTimes(1);
    expect((await testDb.select().from(schema.sceneVersions)).filter(row => row.projectId === projectId)).toHaveLength(1);
  });

  it.each(["40001", "23514"])("retries only a retryable save failure (%s), never inference", async code => {
    const queued = await enqueueAnalysis(userId, projectId, { mediaType: mocks.mode === "trial" ? "video" : "image", mediaUrl: "https://r2.example/a.png" });
    await runAnalysisTask(queued.id); await runAnalysisTask(queued.id);
    let restore!: () => void;
    let count!: () => number;
    mocks.analyze.mockImplementationOnce(async () => {
      const spy = vi.spyOn(testDb, "transaction").mockRejectedValueOnce(Object.assign(new Error("save failure"), { code }));
      restore = () => spy.mockRestore(); count = () => spy.mock.calls.length;
      return blueprint;
    });
    await runAnalysisTask(queued.id);
    expect(count()).toBe(code === "40001" ? 2 : 1);
    restore();
    expect(mocks.analyze).toHaveBeenCalledTimes(1);
    if (code === "40001") {
      expect((await drain(queued.id)).state).toBe("completed");
      expect((await testDb.select().from(schema.sceneVersions)).filter(row => row.projectId === projectId)).toHaveLength(1);
    } else {
      expect((await task(queued.id))).toMatchObject({ state: "running", result: { cursor: 0, pendingScene: { blueprint: { generationPrompt: "real prompt" } } } });
    }
  });
});
