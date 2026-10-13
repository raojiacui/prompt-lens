import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";

const isolated = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", async () => ({ ...await import("@/lib/db/schema"), get db() { return isolated.db; } }));
vi.mock("undici", async importOriginal => ({ ...await importOriginal<typeof import("undici")>(), fetch: vi.fn(async () => new Response("{}")) }));
vi.mock("@/lib/workflow/scene-analysis", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/workflow/scene-analysis")>(), rewriteSceneBlueprint: vi.fn(), analyzeSceneBlueprint: vi.fn() }));
vi.mock("@/lib/billing/commercial-media", () => ({ assertOwnedUploadedVideo: vi.fn(async () => "owned-upload"), isOwnedLinkedVideo: vi.fn(async () => false), commercialMediaRequest: vi.fn() }));
vi.mock("@/lib/byok/kie", () => ({ getUserKieApiKey: vi.fn(async () => null) }));
vi.mock("@/lib/email/smtp", () => ({ sendEmail: vi.fn(async () => undefined) }));
vi.mock("@/lib/cloudflare/r2", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/cloudflare/r2")>(), copyR2Object: vi.fn(async () => "https://example.com/frozen-video.mp4") }));
vi.mock("@/lib/payments/alipay", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/payments/alipay")>(),
  queryAlipayTrade: vi.fn(),
  closeAlipayTrade: vi.fn(),
  refundAlipayTrade: vi.fn(),
  queryAlipayRefund: vi.fn(),
}));
import { rewriteSceneBlueprint, analyzeSceneBlueprint, buildFallbackSceneBlueprint } from "@/lib/workflow/scene-analysis";
import { assertOwnedUploadedVideo, isOwnedLinkedVideo, commercialMediaRequest } from "@/lib/billing/commercial-media";
import { getUserKieApiKey } from "@/lib/byok/kie";
import { sendEmail } from "@/lib/email/smtp";
import { copyR2Object } from "@/lib/cloudflare/r2";
import { prepareCommercialAnalysis, quoteCommercialAnalysis, quoteCommercialAnalysisRetry, quotedAnalysisModel, recoverCommercialAnalysisTasks } from "@/lib/billing/commercial-analysis";
import { confirmCommercialTask, confirmCommercialTaskInTransaction, runCommercialTask } from "@/lib/billing/commercial-task-runner";
import { buildCommercialGenerationPayload, quoteCommercialGeneration, reconcileCommercialGeneration } from "@/lib/billing/commercial-generation";
import { rewriteSceneVersion } from "@/lib/workflow/service";
import { grantCommercialPurchase, reserveCommercialTask, settleCommercialTask, getIncludedLinkImportUsage } from "@/lib/billing/commercial-wallet";
import { acknowledgeCommercialReview, escalateOverdueCommercialReviews, notifyDueCommercialReviews, releaseUnfulfilledCommercialAnalysis } from "@/lib/billing/commercial-review";
import { reconcileTerminalIndependentAnalysis, recoverStaleAnalysisSceneJobs, resumeIndependentAnalysis, resumeLocalIndependentAnalyses, runIndependentSceneJob } from "@/lib/billing/independent-scene-analysis";
import { generationKeyFingerprint } from "@/lib/billing/generation-key";
import { releaseAnalysisProviderSlot, reserveAnalysisProviderSlot } from "@/lib/billing/analysis-provider-limit";
import { LINK_IMPORT_PRICING_VERSION } from "@/lib/billing/link-import-pricing";
import { createAlipayCreditCheckout, settlePaidCreditOrder } from "@/lib/payments/credit-checkout";
import { PRICING_VERSION, settleAnalysis, type AnalysisPriceInput } from "@/lib/billing/pricing-v6";
import { reconcileCommercialRefund, requestCommercialRefund, updateCommercialRefundRequest, reviewCommercialRefund } from "@/lib/payments/commercial-refunds";
import { queryAlipayRefund, queryAlipayTrade, refundAlipayTrade, closeAlipayTrade } from "@/lib/payments/alipay";
import { ALIPAY_EXPIRY_VERSION } from "@/lib/payments/order-expiry";
import { eq } from "drizzle-orm";
import { reconcileAlipayOrder } from "@/lib/payments/alipay-reconciliation";

const nativeTestUrl = process.env.SCENE_SAVE_TEST_DATABASE_URL;
if (nativeTestUrl) {
  const target = new URL(nativeTestUrl);
  if (target.hostname !== "127.0.0.1" || target.port !== "55432" || target.pathname !== "/scene_save_diagnostics") throw new Error("Scene save diagnostics require the isolated local test database");
}
const nativeClient = nativeTestUrl ? postgres(nativeTestUrl, { max: 5, idle_timeout: 20, connect_timeout: 10, onnotice: () => {} }) : null;
const memoryClient = nativeClient ? null : new PGlite();
const client = nativeClient ? {
  exec: (query: string) => nativeClient.unsafe(query),
  query: (query: string, values: string[]) => nativeClient.unsafe(query, values),
  close: () => nativeClient.end(),
} : memoryClient!;
const testDb = nativeClient ? drizzlePostgres(nativeClient, { schema }) : drizzle(memoryClient!, { schema });
isolated.db = testDb;
const userId = randomUUID();

async function balance() {
  return (await testDb.select().from(schema.commercialWallets))[0];
}
async function grant(credits = 200, rewrites = 20, orderId = randomUUID()) {
  return testDb.transaction((tx) => grantCommercialPurchase(tx as unknown as Parameters<typeof grantCommercialPurchase>[0], { userId, orderId, packageId: "v6_trial_200", credits, rewrites }));
}
async function drain(taskId: string) {
  for (let i = 0; i < 30; i++) {
    await runCommercialTask(taskId);
    const task = (await testDb.select().from(schema.commercialTasks)).find((t) => t.id === taskId)!;
    if (task.state === "running" && (task.result as Record<string, unknown>).sceneJobMode === "independent_v1") {
      const jobs = await testDb.select().from(schema.analysisSceneJobs).where(eq(schema.analysisSceneJobs.taskId, taskId));
      for (const job of jobs.filter(job => job.state === "queued")) await runIndependentSceneJob(job.id);
      await recoverStaleAnalysisSceneJobs(30, taskId);
      await reconcileTerminalIndependentAnalysis(taskId);
      continue;
    }
    if (task.state !== "queued") return;
  }
  throw new Error("Task failed to reach a durable boundary");
}

describe("Commercial wallet transactions on isolated Postgres", () => {
  beforeAll(async () => {
    // Migrations explicitly use public enums. This opt-in URL is restricted to the disposable local database above.
    if (nativeClient) await nativeClient.unsafe("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await client.exec('CREATE TABLE "user" (id uuid PRIMARY KEY);');
    await client.exec(readFileSync("drizzle/0005_v2_workflow.sql", "utf8"));
    await client.exec("CREATE TYPE log_action AS ENUM ('video.edit.start');");
    await client.exec(readFileSync("drizzle/0007_foamy_lily_hollister.sql", "utf8"));
    await client.exec(readFileSync("drizzle/0008_payment_orders.sql", "utf8"));
    await client.exec(readFileSync("drizzle/0015_alipay_official_provider.sql", "utf8"));
    await client.exec(readFileSync("drizzle/0010_commercial_wallets.sql", "utf8"));
    await client.exec(readFileSync("drizzle/0011_commercial_purchase_lots.sql", "utf8"));
    await client.exec(readFileSync("drizzle/0002_video_generation.sql", "utf8"));
    await client.exec(readFileSync("drizzle/0006_generation_workflow_links.sql", "utf8"));
    await client.exec(readFileSync("drizzle/0012_commercial_tasks.sql", "utf8"));
    await client.exec(readFileSync("drizzle/0019_media_cleanup_jobs.sql", "utf8"));
    await client.exec(readFileSync("drizzle/0023_analysis_scene_jobs.sql", "utf8"));
    await client.exec(readFileSync("drizzle/0024_analysis_provider_slots.sql", "utf8"));
    await client.query('INSERT INTO "user" (id) VALUES ($1)', [userId]);
  });
  beforeEach(async () => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.mocked(rewriteSceneBlueprint).mockReset();
    vi.mocked(analyzeSceneBlueprint).mockReset();
    vi.mocked(commercialMediaRequest).mockReset();
    vi.mocked(getUserKieApiKey).mockReset().mockResolvedValue(null);
    vi.mocked(copyR2Object).mockClear();
    vi.mocked(sendEmail).mockReset().mockResolvedValue(undefined);
    await client.exec("TRUNCATE media_cleanup_jobs");
    vi.mocked(queryAlipayTrade).mockReset();
    vi.mocked(closeAlipayTrade).mockReset();
    vi.mocked(refundAlipayTrade).mockReset();
    vi.mocked(queryAlipayRefund).mockReset();
    await client.exec("TRUNCATE projects CASCADE");
    await client.exec("TRUNCATE video_generation, commercial_tasks, commercial_refunds, commercial_allocations, commercial_lots, commercial_ledger, commercial_reservations, commercial_wallets, payment_orders, credit_ledger, user_credits CASCADE");
  });
  afterAll(async () => { await client.close(); });

  it("allows one durable execution row per selected scene", async () => {
    const [task] = await testDb.insert(schema.commercialTasks).values({ userId, kind: "analysis", input: {}, expiresAt: new Date(Date.now() + 600_000) }).returning();
    await testDb.insert(schema.analysisSceneJobs).values({ taskId: task.id, sceneId: "shot-2", sceneIndex: 2 });
    await expect(testDb.insert(schema.analysisSceneJobs).values({ taskId: task.id, sceneId: "shot-2", sceneIndex: 2 })).rejects.toThrow();
    await testDb.insert(schema.analysisSceneJobs).values({ taskId: task.id, sceneId: "shot-3", sceneIndex: 3 });
    expect(await testDb.select().from(schema.analysisSceneJobs)).toHaveLength(2);
  });
  it("shares a four-active and fifteen-per-ten-second KIE limit across transactions", async () => {
    const [task] = await testDb.insert(schema.commercialTasks).values({ userId, kind: "analysis", input: {}, expiresAt: new Date(Date.now() + 600_000) }).returning();
    const jobs = await testDb.insert(schema.analysisSceneJobs).values(Array.from({ length: 16 }, (_, index) => ({ taskId: task.id, sceneId: `shot-${index}`, sceneIndex: index + 1 }))).returning();
    const claim = (id: string) => testDb.transaction(tx => reserveAnalysisProviderSlot(tx as unknown as Parameters<typeof reserveAnalysisProviderSlot>[0], id, "same-platform-key"));
    expect(await Promise.all(jobs.slice(0, 5).map(job => claim(job.id)))).toEqual([true, true, true, true, false]);
    for (const job of jobs.slice(0, 4)) await releaseAnalysisProviderSlot(job.id);
    for (const job of jobs.slice(4, 15)) { expect(await claim(job.id)).toBe(true); await releaseAnalysisProviderSlot(job.id); }
    expect(await claim(jobs[15].id)).toBe(false);
    expect((await testDb.select().from(schema.analysisProviderSlots)).length).toBe(15);
  });

  it("grants, accumulates and bounds zero-credit link imports without changing balances", async () => {
    await grant();
    const quote = { kind: "link_import", pricingVersion: LINK_IMPORT_PRICING_VERSION, urlHash: "test" };
    for (let i = 0; i < 12; i++) {
      const input = { userId, taskKey: `link-import:${i}`, credits: 0, rewrites: 0, quote };
      expect((await reserveCommercialTask(input)).created).toBe(true);
      if (i === 0) expect((await reserveCommercialTask(input)).created).toBe(false);
      await settleCommercialTask({ ...input, linkImportDelivered: true });
      expect((await reserveCommercialTask(input)).created).toBe(false);
    }
    expect(await getIncludedLinkImportUsage(userId)).toMatchObject({ total: 12, used: 12, remaining: 0 });
    await expect(reserveCommercialTask({ userId, taskKey: "link-import:overflow", credits: 0, rewrites: 0, quote })).rejects.toThrow("LINK_IMPORT_ALLOWANCE_EXHAUSTED");
    expect(await balance()).toMatchObject({ credits: 200, rewrites: 20, heldCredits: 0 });
    await grant();
    expect(await getIncludedLinkImportUsage(userId)).toMatchObject({ total: 24, used: 12, remaining: 12 });
  });

  it("rejects imports without a qualifying purchase", async () => {
    await expect(reserveCommercialTask({ userId, taskKey: "link-import:unpaid", credits: 0, rewrites: 0, quote: { kind: "link_import", pricingVersion: LINK_IMPORT_PRICING_VERSION } })).rejects.toThrow("LINK_IMPORT_ALLOWANCE_EXHAUSTED");
  });

  it("releases the import slot on failure without spending credits or changing replay outcome", async () => {
    await grant();
    const input = { userId, taskKey: "link-import:failed", credits: 0, rewrites: 0, quote: { kind: "link_import", pricingVersion: LINK_IMPORT_PRICING_VERSION } };
    await reserveCommercialTask(input);
    expect(await getIncludedLinkImportUsage(userId)).toMatchObject({ used: 1, remaining: 11 });
    await settleCommercialTask(input);
    await settleCommercialTask(input);
    expect(await getIncludedLinkImportUsage(userId)).toMatchObject({ used: 0, remaining: 12 });
    expect((await reserveCommercialTask(input)).created).toBe(false);
    await expect(settleCommercialTask({ ...input, linkImportDelivered: true })).rejects.toThrow("Settlement replay mismatch");
    await reserveCommercialTask({ ...input, taskKey: "link-import:new" });
    expect(await balance()).toMatchObject({ credits: 200, rewrites: 20, heldCredits: 0 });
  });

  it("allocates the last parsing attempt only once across competing requests", async () => {
    await grant();
    const quote = { kind: "link_import", pricingVersion: LINK_IMPORT_PRICING_VERSION };
    for (let i = 0; i < 11; i++) await reserveCommercialTask({ userId, taskKey: `link-import:prior-${i}`, credits: 0, rewrites: 0, quote });
    const results = await Promise.allSettled(["a", "b"].map((id) => reserveCommercialTask({ userId, taskKey: `link-import:last-${id}`, credits: 0, rewrites: 0, quote })));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await getIncludedLinkImportUsage(userId)).toMatchObject({ remaining: 0, used: 12 });
  });

  it("does not invent included imports for historical grants or refunded lots", async () => {
    await grant();
    await client.exec("UPDATE commercial_ledger SET metadata = metadata - 'linkImports'");
    expect(await getIncludedLinkImportUsage(userId)).toMatchObject({ total: 0, remaining: 0 });
    await grant();
    await client.exec("UPDATE commercial_lots SET state = 'refunded'");
    expect(await getIncludedLinkImportUsage(userId)).toMatchObject({ total: 0, remaining: 0 });
  });

  it("grants a purchase exactly once, including rewrites", async () => {
    const id = randomUUID();
    expect(await grant(200, 20, id)).toBe(true);
    expect(await grant(200, 20, id)).toBe(false);
    expect(await balance()).toMatchObject({ credits: 200, rewrites: 20, heldCredits: 0 });
    await expect(grant(201, 20, id)).rejects.toThrow("replay mismatch");
  });
  it("rejects unsupported paid generation combinations without silently changing them", () => {
    const input = { userPrompt: "A cinematic cloud palace", duration: 5, quality: "720p" };
    expect(buildCommercialGenerationPayload(input)).toMatchObject({ model: "wan/2-6-text-to-video", input: { duration: "5", resolution: "720p" } });
    expect(buildCommercialGenerationPayload({ ...input, hiddenReferenceImageUrl: "https://example.com/image.jpg" })).toMatchObject({ model: "wan/2-6-image-to-video", input: { image_urls: ["https://example.com/image.jpg"] } });
    expect(buildCommercialGenerationPayload({ ...input, quality: "1080p", aspectRatio: "9:16" })).toMatchObject({ input: { resolution: "1080p", aspect_ratio: "9:16" } });
    for (const override of [{ duration: 8 }, { quality: "4k" }, { aspectRatio: "2:3" }, { model: "unverified-model" }, { referenceVideoUrl: "https://example.com/video.mp4" }, { hiddenReferenceImageUrl: "http://example.com/image.jpg" }]) expect(() => buildCommercialGenerationPayload({ ...input, ...override })).toThrow();
  });
  it("uses explicit provider fields for paid image and video paths", () => {
    const body = { userPrompt: "A cinematic cloud palace", duration: 5, quality: "720p", aspectRatio: "auto", referenceVideoUrl: "https://example.com/video.mp4", replacementAssets: [{ url: "https://example.com/image.jpg" }] };
    expect(buildCommercialGenerationPayload({ ...body, model: "seedance-2-fast" }, 5)).toMatchObject({ model: "bytedance/seedance-2-fast", input: { duration: 5, reference_video_urls: [body.referenceVideoUrl], reference_image_urls: [body.replacementAssets[0].url], generate_audio: false } });
    expect(buildCommercialGenerationPayload({ ...body, duration: 0, model: "wan-video-edit" }, 5)).toMatchObject({ input: { duration: 0, video_url: body.referenceVideoUrl, reference_image: body.replacementAssets[0].url } });
    expect(() => buildCommercialGenerationPayload({ ...body, duration: 0, model: "kling-omni-transform" }, 5)).toThrow("PAID_MODEL_NOT_VERIFIED");
    expect(() => buildCommercialGenerationPayload({ ...body, referenceVideoSeconds: 1, model: "seedance-2-fast" })).toThrow("REFERENCE_VIDEO_PROBE_REQUIRED");
  });
  it("rejects another owner's or expired quotes before reserving funds", async () => {
    await grant(); vi.stubEnv("COMMERCIAL_CONSUMPTION_ENABLED", "true"); vi.stubEnv("KIE_API_KEY", "test-key");
    const quote = await quoteCommercialGeneration(userId, { userPrompt: "A cinematic cloud palace", duration: 5 });
    await expect(confirmCommercialTask(randomUUID(), quote.id)).rejects.toThrow("TASK_NOT_FOUND");
    await client.query("UPDATE commercial_tasks SET expires_at = now() - interval '1 minute' WHERE id = $1", [quote.id]);
    await expect(confirmCommercialTask(userId, quote.id)).rejects.toThrow("QUOTE_EXPIRED");
    expect(await balance()).toMatchObject({ credits: 200, heldCredits: 0 });
  });

  it("resolves paid model-family requests to official image and video endpoints", () => {
    const base = { userPrompt: "A cinematic cloud palace", duration: 5, quality: "1080p" };
    const image = "https://example.com/image.jpg";
    const video = "https://example.com/video.mp4";
    expect(buildCommercialGenerationPayload({ ...base, model: "kling-2.6/text-to-video", replacementAssets: [{ url: image }] })).toMatchObject({
      model: "kling-2.6/image-to-video", input: { image_urls: [image], duration: "5" },
    });
    expect(buildCommercialGenerationPayload({ ...base, model: "wan/2-6-text-to-video", referenceVideoUrl: video }, 5)).toMatchObject({
      model: "wan/2-6-video-to-video", input: { video_urls: [video] },
    });
    expect(buildCommercialGenerationPayload({ ...base, model: "wan/2-7-text-to-video", replacementAssets: [{ url: image }] })).toMatchObject({
      model: "wan/2-7-image-to-video", input: { first_frame_url: image },
    });
    expect(buildCommercialGenerationPayload({ ...base, model: "wan/2-7-text-to-video", referenceVideoUrl: video, replacementAssets: [{ url: image }] }, 5)).toMatchObject({
      model: "wan/2-7-r2v", input: { reference_video: [video], reference_image: [image] },
    });
  });
  it.each(["success", "fail"] as const)("submits paid Veo to its verified endpoint and settles %s once", async (state) => {
    await grant();
    vi.stubEnv("COMMERCIAL_CONSUMPTION_ENABLED", "true");
    vi.stubEnv("KIE_API_KEY", "test-key");
    const quote = await quoteCommercialGeneration(userId, { model: "veo-lite", userPrompt: "A cinematic cloud palace", duration: 8, quality: "1080p", aspectRatio: "9:16" });
    expect(quote).toMatchObject({ credits: 15, model: "veo3_lite", duration: 8, resolution: "1080p" });
    await expect(confirmCommercialTask(randomUUID(), quote.id)).rejects.toThrow("TASK_NOT_FOUND");
    await confirmCommercialTask(userId, quote.id);
    await confirmCommercialTask(userId, quote.id);
    expect(await balance()).toMatchObject({ credits: 185, heldCredits: 15 });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 200, data: { taskId: "veo-paid-task" } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 200, data: { taskId: "veo-paid-task", successFlag: state === "success" ? 1 : 2, response: { resultUrls: ["https://example.com/veo.mp4"] } } })));
    vi.stubGlobal("fetch", fetchMock);
    await runCommercialTask(quote.id);
    await runCommercialTask(quote.id);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.kie.ai/api/v1/veo/generate");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ model: "veo3_lite", duration: 8, resolution: "1080p", aspectRatio: "9:16", generationType: "TEXT_2_VIDEO", enableFallback: false });
    await reconcileCommercialGeneration(quote.id);
    await reconcileCommercialGeneration(quote.id);
    expect(String(fetchMock.mock.calls[1][0])).toContain("/api/v1/veo/record-info");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await balance()).toMatchObject({ credits: state === "success" ? 185 : 200, heldCredits: 0 });
  });
  it("rejects unsupported paid Veo settings before quoting", async () => {
    vi.stubEnv("KIE_API_KEY", "test-key");
    for (const override of [{ duration: 5 }, { quality: "480p" }, { model: "veo-quality", quality: "4k" }, { referenceVideoUrl: "https://example.com/video.mp4" }]) {
      expect(() => buildCommercialGenerationPayload({ model: "veo-fast", userPrompt: "A cinematic cloud palace", duration: 8, quality: "720p", ...override }, 5)).toThrow();
    }
  });
  it.each(["success", "fail"] as const)("quotes reference duration on the server and settles %s once", async (state) => {
    await grant(650, 60);
    vi.stubEnv("COMMERCIAL_CONSUMPTION_ENABLED", "true"); vi.stubEnv("KIE_API_KEY", "test-key");
    vi.mocked(commercialMediaRequest).mockResolvedValue({ durationUs: 5_000_000 });
    const quote = await quoteCommercialGeneration(userId, { model: "seedance-2-fast", userPrompt: "Follow the reference motion in a new city", referenceVideoUrl: "https://example.com/video.mp4", referenceVideoSeconds: 1, duration: 10, quality: "720p" });
    expect(quote).toMatchObject({ credits: 87, referenceVideoSeconds: 5, duration: 10 });
    expect(assertOwnedUploadedVideo).toHaveBeenCalledWith(userId, "https://example.com/video.mp4");
    expect(copyR2Object).toHaveBeenCalledWith("owned-upload", expect.stringContaining(`generation-input/${userId}/`));
    expect(commercialMediaRequest).toHaveBeenCalledWith("https://example.com/frozen-video.mp4", { mode: "preview", automaticSplit: false });
    expect(await testDb.select().from(schema.mediaCleanupJobs)).toHaveLength(1);
    await confirmCommercialTask(userId, quote.id);
    await confirmCommercialTask(userId, quote.id);
    expect(await balance()).toMatchObject({ credits: 563, heldCredits: 87 });
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ code: 200, data: { taskId: "reference-task" } }))).mockResolvedValueOnce(new Response(JSON.stringify({ code: 200, data: { taskId: "reference-task", state, resultJson: JSON.stringify({ resultUrls: ["https://example.com/output.mp4"] }) } })));
    vi.stubGlobal("fetch", fetchMock);
    await runCommercialTask(quote.id);
    await runCommercialTask(quote.id);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ model: "bytedance/seedance-2-fast", input: { duration: 10, reference_video_urls: ["https://example.com/frozen-video.mp4"] } });
    await reconcileCommercialGeneration(quote.id);
    await reconcileCommercialGeneration(quote.id);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await balance()).toMatchObject({ credits: state === "success" ? 563 : 650, heldCredits: 0 });
  });
  it("does not probe another user's video or an unfunded wallet", async () => {
    vi.stubEnv("KIE_API_KEY", "test-key");
    const input = { model: "seedance-2-fast", userPrompt: "Follow the video", referenceVideoUrl: "https://example.com/video.mp4", duration: 5 };
    vi.mocked(assertOwnedUploadedVideo).mockRejectedValueOnce(new Error("UPLOAD_NOT_OWNED"));
    await expect(quoteCommercialGeneration(userId, input)).rejects.toThrow("UPLOAD_NOT_OWNED");
    await expect(quoteCommercialGeneration(userId, input)).rejects.toThrow("INSUFFICIENT_COMMERCIAL_BALANCE");
    expect(commercialMediaRequest).not.toHaveBeenCalled();
    expect(copyR2Object).not.toHaveBeenCalled();
  });

  it.each([
    ["kling-2.6/text-to-video", "image", "kling-2.6/image-to-video", "1080p", 23],
    ["wan/2-6-text-to-video", "video", "wan/2-6-video-to-video", "720p", 29],
    ["wan/2-7-text-to-video", "text", "wan/2-7-text-to-video", "720p", 32],
    ["wan/2-7-text-to-video", "image", "wan/2-7-image-to-video", "720p", 32],
    ["wan/2-7-text-to-video", "video", "wan/2-7-r2v", "1080p", 47],
    ["wan/2-7-videoedit", "video", "wan/2-7-videoedit", "720p", 32],
  ] as const)("%s %s reserves its quote and releases failed output charges", async (model, materials, providerModel, quality, credits) => {
    await grant();
    vi.stubEnv("COMMERCIAL_CONSUMPTION_ENABLED", "true"); vi.stubEnv("KIE_API_KEY", "test-key");
    vi.mocked(commercialMediaRequest).mockResolvedValue({ durationUs: 5_000_000 });
    const quote = await quoteCommercialGeneration(userId, {
      model, quality, duration: model === "wan/2-7-videoedit" ? 0 : 5, userPrompt: "A cinematic cloud palace",
      ...(materials === "image" ? { replacementAssets: [{ url: "https://example.com/image.jpg" }] } : {}),
      ...(materials === "video" ? { referenceVideoUrl: "https://example.com/video.mp4" } : {}),
    });
    expect(quote).toMatchObject({ credits, model: providerModel });
    expect(await balance()).toMatchObject({ credits: 200, heldCredits: 0 });
    await confirmCommercialTask(userId, quote.id);
    await confirmCommercialTask(userId, quote.id);
    expect(await balance()).toMatchObject({ credits: 200 - credits, heldCredits: credits });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 200, data: { taskId: "material-task" } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 200, data: { taskId: "material-task", state: "fail" } })));
    vi.stubGlobal("fetch", fetchMock);
    await runCommercialTask(quote.id);
    await runCommercialTask(quote.id);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.kie.ai/api/v1/jobs/createTask");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe(providerModel);
    await reconcileCommercialGeneration(quote.id);
    await reconcileCommercialGeneration(quote.id);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await balance()).toMatchObject({ credits: 200, heldCredits: 0 });
  });
  it("does not create a billable quote when the reference snapshot fails", async () => {
    await grant(); vi.stubEnv("KIE_API_KEY", "test-key");
    vi.mocked(copyR2Object).mockRejectedValueOnce(new Error("Storage unavailable"));
    await expect(quoteCommercialGeneration(userId, { model: "seedance-2-fast", userPrompt: "Follow the video", referenceVideoUrl: "https://example.com/video.mp4", duration: 5 })).rejects.toThrow("Storage unavailable");
    expect(commercialMediaRequest).not.toHaveBeenCalled();
    expect(await testDb.select().from(schema.commercialTasks)).toMatchObject([{ kind: "analysis_preview", state: "failed" }]);
    expect(await testDb.select().from(schema.mediaCleanupJobs)).toHaveLength(1);
    expect(await balance()).toMatchObject({ credits: 200, heldCredits: 0 });
  });
  it("reserves once, releases the unused amount and rejects late re-debits", async () => {
    await grant();
    const task = { userId, taskKey: "analysis:1", credits: 54, rewrites: 0, quote: { model: "flash", version: "v6" } };
    expect((await reserveCommercialTask(task)).created).toBe(true);
    expect((await reserveCommercialTask({ ...task, quote: { version: "v6", model: "flash" } })).created).toBe(false);
    expect(await balance()).toMatchObject({ credits: 146, heldCredits: 54 });
    expect((await settleCommercialTask({ ...task, credits: 32 })).settled).toBe(true);
    expect((await settleCommercialTask({ ...task, credits: 32 })).settled).toBe(false);
    expect(await balance()).toMatchObject({ credits: 168, heldCredits: 0 });
    await expect(settleCommercialTask({ ...task, credits: 54 })).rejects.toThrow("replay mismatch");
    expect(await balance()).toMatchObject({ credits: 168 });
  });
  it("does not spend credits for included rewrites and refunds failed rewrites", async () => {
    await grant();
    const task = { userId, taskKey: "rewrite:1", credits: 0, rewrites: 1, quote: { scene: "one" } };
    await reserveCommercialTask(task);
    expect(await balance()).toMatchObject({ credits: 200, rewrites: 19, heldRewrites: 1 });
    await settleCommercialTask({ ...task, rewrites: 0 });
    expect(await balance()).toMatchObject({ credits: 200, rewrites: 20, heldRewrites: 0 });
  });
  it("rolls back overcharges and rejects altered quotes", async () => {
    await grant();
    const task = { userId, taskKey: "generation:1", credits: 40, rewrites: 0, quote: { duration: 6 } };
    await reserveCommercialTask(task);
    await expect(reserveCommercialTask({ ...task, quote: { duration: 10 } })).rejects.toThrow("replay mismatch");
    await expect(settleCommercialTask({ ...task, credits: 41 })).rejects.toThrow("exceeds confirmed quote");
    expect(await balance()).toMatchObject({ credits: 160, heldCredits: 40 });
    await settleCommercialTask({ ...task, credits: 0 });
    expect(await balance()).toMatchObject({ credits: 200, heldCredits: 0 });
  });
  it("cannot over-reserve available funds across competing tasks", async () => {
    await grant();
    const results = await Promise.allSettled(["a", "b"].map((taskKey) => reserveCommercialTask({ userId, taskKey, credits: 150, rewrites: 0, quote: {} })));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await balance()).toMatchObject({ credits: 50, heldCredits: 150 });
    expect(await testDb.select().from(schema.commercialReservations)).toHaveLength(1);
  });
  it("keeps a grant and its enclosing payment transaction atomic", async () => {
    await expect(testDb.transaction(async (tx) => {
      await grantCommercialPurchase(tx as unknown as Parameters<typeof grantCommercialPurchase>[0], { userId, orderId: randomUUID(), packageId: "v6_trial_200", credits: 200, rewrites: 20 });
      throw new Error("Payment transaction failed");
    })).rejects.toThrow("Payment transaction failed");
    expect(await testDb.select().from(schema.commercialWallets)).toHaveLength(0);
    expect(await testDb.select().from(schema.commercialLedger)).toHaveLength(0);
  });

  async function order(commercial = true) {
    const [row] = await testDb.insert(schema.paymentOrders).values({ userId, provider: "alipay", providerOrderId: randomUUID(), packageId: commercial ? "v6_trial_200" : "starter_10", packageName: "Test", credits: commercial ? 200 : 10, amountCents: 1990, currency: "cny", metadata: { appId: "ali", method: "alipay", pricingVersion: PRICING_VERSION, rewrites: 20 } }).returning();
    return row;
  }
  it("atomically marks the new order paid and grants both benefits once", async () => {
    const row = await order();
    const input = { provider: "alipay" as const, lookupOrderId: row.providerOrderId, rawPayload: { out_trade_no: row.providerOrderId, total_amount: "19.90", trade_status: "TRADE_SUCCESS" }, verifiedAlipayQuery: true };
    const results = await Promise.all([settlePaidCreditOrder(input), settlePaidCreditOrder(input)]);
    expect(results.filter((result) => result.granted)).toHaveLength(1);
    expect(await balance()).toMatchObject({ credits: 200, rewrites: 20 });
    expect(await testDb.select().from(schema.userCredits)).toHaveLength(0);
    expect((await testDb.select().from(schema.paymentOrders))[0].status).toBe("paid");
  });
  it("retains legacy grants in the legacy wallet and prevents duplicate credits", async () => {
    const row = await order(false);
    const input = { provider: "alipay" as const, lookupOrderId: row.providerOrderId, rawPayload: { out_trade_no: row.providerOrderId, total_amount: "19.90", trade_status: "TRADE_SUCCESS" }, verifiedAlipayQuery: true };
    await settlePaidCreditOrder(input);
    expect((await settlePaidCreditOrder(input)).granted).toBe(false);
    expect((await testDb.select().from(schema.userCredits))[0].balance).toBe(10);
    expect(await testDb.select().from(schema.commercialWallets)).toHaveLength(0);
  });
  it("never grants for an underpayment", async () => {
    const row = await order();
    await expect(settlePaidCreditOrder({ provider: "alipay", lookupOrderId: row.providerOrderId, rawPayload: { out_trade_no: row.providerOrderId, total_amount: "1.00", trade_status: "TRADE_SUCCESS" }, verifiedAlipayQuery: true })).rejects.toThrow("amount mismatch");
    expect((await testDb.select().from(schema.paymentOrders))[0].status).toBe("pending");
    expect(await testDb.select().from(schema.commercialWallets)).toHaveLength(0);
  });

  async function rewriteInput() {
    const [project] = await testDb.insert(schema.projects).values({ userId, title: "Test" }).returning();
    const [version] = await testDb.insert(schema.projectVersions).values({ projectId: project.id, versionNumber: 1, label: "Original" }).returning();
    const [scene] = await testDb.insert(schema.videoScenes).values({ projectId: project.id, sceneIndex: 1, startTime: 0, endTime: 2, duration: 2 }).returning();
    const [original] = await testDb.insert(schema.sceneVersions).values({ projectId: project.id, projectVersionId: version.id, originalSceneId: scene.id, sceneIndex: 1, generationPrompt: "Original", duration: 2 }).returning();
    vi.mocked(rewriteSceneBlueprint).mockResolvedValue({ story: {}, visual: {}, dialogue: [], narration: [], subtitle: [], audio: {}, transition: {}, generationPrompt: "Rewritten" });
    return { userId, projectId: project.id, sceneVersionId: original.id, instruction: "Change the main character", modelId: "analysis-gemini-3-8-flash", modelMode: "manual" as const, rewriteKeySource: "platform" as const, allowPlatformKeyForRewrite: true, commercialTaskKey: "rewrite:test" };
  }
  async function paidOrder() {
    const row = await order();
    await settlePaidCreditOrder({ provider: "alipay", lookupOrderId: row.providerOrderId, rawPayload: { out_trade_no: row.providerOrderId, total_amount: "19.90", trade_status: "TRADE_SUCCESS" }, verifiedAlipayQuery: true });
    return row;
  }
  it("runs paid analysis from server probe through partial settlement with no duplicate inference", async () => {
    await grant();
    vi.stubEnv("COMMERCIAL_CONSUMPTION_ENABLED", "true");
    vi.stubEnv("KIE_AI_API_KEY", "platform-test-key");
    const [project] = await testDb.insert(schema.projects).values({ userId, title: "Commercial analysis" }).returning();
    const intervals = [{ id: "1", startUs: 0, endUs: 2000000 }, { id: "2", startUs: 2000000, endUs: 10000000 }];
    vi.mocked(isOwnedLinkedVideo).mockResolvedValueOnce(true);
    vi.mocked(commercialMediaRequest).mockResolvedValueOnce({ sourceHash: "a".repeat(64), durationUs: 10000000, bytes: 500, metadata: { duration: 10 }, scenes: intervals });
    const preview = await prepareCommercialAnalysis(userId, { projectId: project.id, mediaUrl: "https://example.com/source.mp4", mediaName: "source.mp4", automaticSplit: true });
    const quote = await quoteCommercialAnalysis(userId, { preparationId: preview.id, sceneIds: ["1", "2"], payer: "platform", model: "flash", outputLanguage: "zh" });
    expect(quote.credits).toBe(8);
    expect(analyzeSceneBlueprint).not.toHaveBeenCalled();
    await confirmCommercialTask(userId, quote.id);
    await confirmCommercialTask(userId, quote.id);
    expect(await balance()).toMatchObject({ credits: 192, heldCredits: 8 });
    vi.mocked(commercialMediaRequest).mockResolvedValueOnce({ metadata: { duration: 10 }, scenes: intervals.map((s, index) => ({ sceneIndex: index + 1, startTime: s.startUs / 1000000, endTime: s.endUs / 1000000, duration: (s.endUs - s.startUs) / 1000000, keyframeUrls: ["https://example.com/frame.jpg"], clipUrl: "https://example.com/clip.mp4" })) });
    vi.mocked(analyzeSceneBlueprint).mockResolvedValueOnce({ story: {}, visual: {}, dialogue: [], narration: [], subtitle: [], audio: {}, transition: {}, generationPrompt: "Successful prompt", metadata: { analysisProvider: "kie" } }).mockRejectedValueOnce(new Error("Model failed"));
    await drain(quote.id);
    await runCommercialTask(quote.id);
    expect(analyzeSceneBlueprint).toHaveBeenCalledTimes(2);
    expect(vi.mocked(analyzeSceneBlueprint).mock.calls[0][0]).toMatchObject({ analysisKeySource: "platform", forceFreeTrialKie: false, modelId: "gemini-3-8-flash-openai" });
    expect(await balance()).toMatchObject({ credits: 196, heldCredits: 0 });
    const task = (await testDb.select().from(schema.commercialTasks)).find((t) => t.id === quote.id)!;
    expect(task.state).toBe("completed");
    expect(task.result).toMatchObject({ chargedCredits: 4, successfulSceneIds: ["1"] });
    const retry = await quoteCommercialAnalysisRetry(userId, quote.id);
    expect(retry.credits).toBe(4);
    await confirmCommercialTask(userId, retry.id);
    vi.mocked(analyzeSceneBlueprint).mockResolvedValueOnce({ story: {}, visual: {}, dialogue: [], narration: [], subtitle: [], audio: {}, transition: {}, generationPrompt: "Retried prompt", metadata: { analysisProvider: "kie" } });
    await drain(retry.id);
    expect(await balance()).toMatchObject({ credits: 192, heldCredits: 0 });
    expect(commercialMediaRequest).toHaveBeenCalledTimes(2);
    await expect(quoteCommercialAnalysisRetry(userId, quote.id)).rejects.toThrow("USE_LATEST_RETRY_TASK");
  });
  it("runs later shots as independent durable jobs and settles the parent once", async () => {
    await grant();
    vi.stubEnv("COMMERCIAL_CONSUMPTION_ENABLED", "true");
    vi.stubEnv("LOCAL_ANALYSIS_USER_IDS", userId);
    vi.stubEnv("KIE_AI_API_KEY", "platform-test-key");
    vi.stubEnv("CRON_SECRET", "test-secret");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    const [project] = await testDb.insert(schema.projects).values({ userId, title: "Independent scenes" }).returning();
    const intervals = [1, 2, 3].map(index => ({ id: String(index), startUs: (index - 1) * 2_000_000, endUs: index * 2_000_000 }));
    vi.mocked(isOwnedLinkedVideo).mockResolvedValueOnce(true);
    vi.mocked(commercialMediaRequest).mockResolvedValueOnce({ sourceHash: "a".repeat(64), durationUs: 6_000_000, bytes: 500, metadata: { duration: 6 }, scenes: intervals });
    const preview = await prepareCommercialAnalysis(userId, { projectId: project.id, mediaUrl: "https://example.com/source.mp4", mediaName: "source.mp4", automaticSplit: true });
    const quote = await quoteCommercialAnalysis(userId, { preparationId: preview.id, sceneIds: ["1", "2", "3"], payer: "platform", model: "flash", outputLanguage: "zh" });
    await confirmCommercialTask(userId, quote.id);
    await testDb.update(schema.commercialTasks).set({ state: "running", result: { executionId: randomUUID(), executionPhase: "extracting_assets" }, updatedAt: new Date(Date.now() - 7 * 60_000) }).where(eq(schema.commercialTasks.id, quote.id));
    await recoverCommercialAnalysisTasks(quote.id, { dispatch: false });
    expect((await testDb.select().from(schema.commercialTasks).where(eq(schema.commercialTasks.id, quote.id)))[0].state).toBe("queued");
    vi.mocked(commercialMediaRequest).mockResolvedValueOnce({ metadata: { duration: 6 }, scenes: intervals.map((scene, index) => ({ sceneIndex: index + 1, startTime: scene.startUs / 1e6, endTime: scene.endUs / 1e6, duration: 2, clipUrl: `https://example.com/${index + 1}.mp4`, keyframeUrls: [] })) });
    await runCommercialTask(quote.id);
    const jobs = await testDb.select().from(schema.analysisSceneJobs).orderBy(schema.analysisSceneJobs.sceneIndex);
    expect(jobs.map(job => job.sceneId)).toEqual(["1", "2", "3"]);
    expect((await testDb.select().from(schema.commercialTasks).where(eq(schema.commercialTasks.id, quote.id)))[0].state).toBe("running");
    vi.mocked(analyzeSceneBlueprint).mockResolvedValueOnce({ story: {}, visual: {}, dialogue: [], narration: [], subtitle: [], audio: {}, transition: {}, generationPrompt: "Shot one", metadata: { analysisProvider: "kie" } })
      .mockRejectedValueOnce(new Error("KIE 524"))
      .mockResolvedValueOnce({ story: {}, visual: {}, dialogue: [], narration: [], subtitle: [], audio: {}, transition: {}, generationPrompt: "Shot three", metadata: { analysisProvider: "kie" } });
    for (const job of jobs) await runIndependentSceneJob(job.id);
    expect(analyzeSceneBlueprint).toHaveBeenCalledTimes(3);
    expect(vi.mocked(analyzeSceneBlueprint).mock.calls.map(call => call[0].scene.sceneIndex)).toEqual([1, 2, 3]);
    expect((await testDb.select().from(schema.analysisSceneJobs).orderBy(schema.analysisSceneJobs.sceneIndex)).map(job => job.state)).toEqual(["completed", "failed", "completed"]);
    const unknownSlot = (await testDb.select().from(schema.analysisProviderSlots).where(eq(schema.analysisProviderSlots.sceneJobId, jobs[1].id)))[0];
    expect(unknownSlot.releasedAt).toBeNull();
    expect(unknownSlot.leaseUntil.getTime()).toBeGreaterThan(Date.now());
    const [task] = await testDb.select().from(schema.commercialTasks).where(eq(schema.commercialTasks.id, quote.id));
    expect(task).toMatchObject({ state: "completed", result: { finishedSceneIds: ["1", "2", "3"], successfulSceneIds: ["1", "3"] } });
    expect((await testDb.select().from(schema.sceneVersions)).map(version => version.sceneIndex).sort()).toEqual([1, 2, 3]);
    expect((await balance()).heldCredits).toBe(0);
    expect(await runIndependentSceneJob(jobs[1].id)).toBe(false);
    expect(analyzeSceneBlueprint).toHaveBeenCalledTimes(3);
  });
  it.each(["40001", "23514"])("preserves the model answer across save error %s without repeating inference", async (code) => {
    await grant();
    vi.stubEnv("KIE_AI_API_KEY", "platform-test-key");
    const [project] = await testDb.insert(schema.projects).values({ userId, title: "Save fault injection" }).returning();
    const [version] = await testDb.insert(schema.projectVersions).values({ projectId: project.id, versionNumber: 0, label: "Original" }).returning();
    const [scene] = await testDb.insert(schema.videoScenes).values({ projectId: project.id, sceneIndex: 1, startTime: 0, endTime: 5, duration: 5 }).returning();
    const [task] = await testDb.insert(schema.commercialTasks).values({ userId, kind: "analysis", state: "running", credits: 5, expiresAt: new Date(Date.now() + 600_000),
      input: { projectId: project.id, pricing: { payer: "platform", model: "flash", sourceDurationUs: 5_000_000, automaticSplit: false, paidSplitReusable: false, scenes: [{ id: "one", startUs: 0, endUs: 5_000_000 }] }, modelId: "gemini-3-8-flash-openai", outputLanguage: "zh", keyFingerprint: generationKeyFingerprint("platform-test-key") },
      result: { executionId: randomUUID(), sceneJobMode: "independent_v1", versionId: version.id, sceneRecords: { one: scene.id }, assets: { scenes: [{ sceneIndex: 1, startTime: 0, endTime: 5, duration: 5, keyframeUrls: [] }] } },
    }).returning();
    await reserveCommercialTask({ userId, taskKey: `commercial:${task.id}`, credits: 5, rewrites: 0, quote: { kind: "analysis" } });
    const [job] = await testDb.insert(schema.analysisSceneJobs).values({ taskId: task.id, sceneId: "one", sceneIndex: 1 }).returning();
    vi.mocked(analyzeSceneBlueprint).mockResolvedValue({ story: {}, visual: {}, dialogue: [], narration: [], subtitle: [], audio: {}, transition: {}, generationPrompt: "Keep this model answer", metadata: { analysisProvider: "kie" } });
    await client.exec(`CREATE SEQUENCE save_fault_attempt; CREATE FUNCTION inject_scene_save_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF nextval('save_fault_attempt') = 1 THEN RAISE EXCEPTION 'simulated save fault' USING ERRCODE = '${code}'; END IF; RETURN NEW; END $$; CREATE TRIGGER inject_scene_save_fault BEFORE INSERT ON scene_versions FOR EACH ROW EXECUTE FUNCTION inject_scene_save_fault();`);
    try {
      if (code === "40001") {
        expect(await runIndependentSceneJob(job.id)).toBe(true);
        expect((await testDb.select().from(schema.analysisSceneJobs))[0]).toMatchObject({ state: "completed", result: { timings: { saveAttempt: 2, recovered: false, modelMs: expect.any(Number) } } });
      } else {
        await expect(runIndependentSceneJob(job.id)).rejects.toThrow();
        expect(await testDb.select().from(schema.sceneVersions)).toHaveLength(0);
        expect((await testDb.select().from(schema.analysisSceneJobs))[0]).toMatchObject({ state: "running", result: { pendingBlueprint: { generationPrompt: "Keep this model answer" } } });
        await testDb.update(schema.analysisSceneJobs).set({ updatedAt: new Date(Date.now() - 25_000) }).where(eq(schema.analysisSceneJobs.id, job.id));
        await recoverStaleAnalysisSceneJobs(5, task.id);
      }
      await recoverStaleAnalysisSceneJobs(5, task.id);
      expect(await runIndependentSceneJob(job.id)).toBe(false);
      expect(analyzeSceneBlueprint).toHaveBeenCalledTimes(1);
      expect(await testDb.select().from(schema.sceneVersions)).toMatchObject([{ originalSceneId: scene.id, generationPrompt: "Keep this model answer" }]);
      expect(await testDb.select().from(schema.sceneVersions)).toHaveLength(1);
      expect((await testDb.select().from(schema.commercialTasks).where(eq(schema.commercialTasks.id, task.id)))[0].state).toBe("completed");
      const [reservation] = await testDb.select().from(schema.commercialReservations);
      expect((await testDb.select().from(schema.commercialLedger).where(eq(schema.commercialLedger.eventKey, `settle:${reservation.id}`)))).toHaveLength(1);
    } finally {
      await client.exec("DROP TRIGGER inject_scene_save_fault ON scene_versions; DROP FUNCTION inject_scene_save_fault(); DROP SEQUENCE save_fault_attempt;");
    }
  });
  it.skipIf(!nativeClient)("identifies a blocked parent lock and recovers its saved answer with the real driver", async () => {
    await grant();
    vi.stubEnv("COMMERCIAL_CONSUMPTION_ENABLED", "true");
    vi.stubEnv("LOCAL_ANALYSIS_USER_IDS", userId);
    vi.stubEnv("KIE_AI_API_KEY", "platform-test-key");
    const errors = vi.spyOn(console, "error");
    const [project] = await testDb.insert(schema.projects).values({ userId, title: "Blocked parent reproduction" }).returning();
    const interval = { id: "one", startUs: 0, endUs: 5_000_000 };
    vi.mocked(isOwnedLinkedVideo).mockResolvedValueOnce(true);
    vi.mocked(commercialMediaRequest).mockResolvedValueOnce({ sourceHash: "b".repeat(64), durationUs: 5_000_000, bytes: 500, metadata: { duration: 5 }, scenes: [interval] });
    const preview = await prepareCommercialAnalysis(userId, { projectId: project.id, mediaUrl: "https://example.com/source.mp4", mediaName: "source.mp4", automaticSplit: true });
    const quote = await quoteCommercialAnalysis(userId, { preparationId: preview.id, sceneIds: [interval.id], payer: "platform", model: "flash", outputLanguage: "zh" });
    await confirmCommercialTask(userId, quote.id);
    vi.mocked(commercialMediaRequest).mockResolvedValueOnce({ metadata: { duration: 5 }, scenes: [{ sceneIndex: 1, startTime: 0, endTime: 5, duration: 5, keyframeUrls: [] }] });
    await runCommercialTask(quote.id);
    const [job] = await testDb.select().from(schema.analysisSceneJobs);
    let finishModel!: (value: Awaited<ReturnType<typeof analyzeSceneBlueprint>>) => void;
    vi.mocked(analyzeSceneBlueprint).mockImplementationOnce(() => new Promise(resolve => { finishModel = resolve; }));
    const running = runIndependentSceneJob(job.id);
    const failedSave = expect(running).rejects.toThrow();
    await vi.waitFor(() => expect(analyzeSceneBlueprint).toHaveBeenCalledTimes(1));
    let unlock!: () => void;
    let locked!: () => void;
    const lockAcquired = new Promise<void>(resolve => { locked = resolve; });
    const releaseLock = new Promise<void>(resolve => { unlock = resolve; });
    const blocker = nativeClient!.begin(async tx => {
      await tx.unsafe("SELECT id FROM commercial_tasks WHERE id = $1 FOR UPDATE", [quote.id]);
      locked();
      await releaseLock;
    });
    try {
      await lockAcquired;
      finishModel({ story: {}, visual: {}, dialogue: [], narration: [], subtitle: [], audio: {}, transition: {}, generationPrompt: "Answer survives lock timeout", metadata: { analysisProvider: "kie" } });
      await failedSave;
      expect(errors).toHaveBeenCalledWith("commercial.scene.save_failed", expect.objectContaining({ stage: "lock_parent_task", attempt: 2 }));
      expect(await testDb.select().from(schema.sceneVersions)).toHaveLength(0);
      expect((await testDb.select().from(schema.analysisSceneJobs))[0]).toMatchObject({ result: { pendingBlueprint: { generationPrompt: "Answer survives lock timeout" } } });
    } finally {
      unlock();
      await blocker;
      errors.mockRestore();
    }
    await testDb.update(schema.analysisSceneJobs).set({ updatedAt: new Date(Date.now() - 25_000) }).where(eq(schema.analysisSceneJobs.id, job.id));
    await recoverStaleAnalysisSceneJobs(5, quote.id);
    expect(analyzeSceneBlueprint).toHaveBeenCalledTimes(1);
    expect((await testDb.select().from(schema.sceneVersions))[0].generationPrompt).toBe("Answer survives lock timeout");
    expect((await testDb.select().from(schema.commercialTasks).where(eq(schema.commercialTasks.id, quote.id)))[0].state).toBe("completed");
  });
  it("saves a checkpointed scene after worker interruption without another KIE request", async () => {
    await grant();
    vi.stubEnv("COMMERCIAL_CONSUMPTION_ENABLED", "true");
    vi.stubEnv("LOCAL_ANALYSIS_USER_IDS", userId);
    vi.stubEnv("KIE_AI_API_KEY", "platform-test-key");
    const [project] = await testDb.insert(schema.projects).values({ userId, title: "Recovered scene" }).returning();
    const interval = { id: "shot-1", startUs: 0, endUs: 5_000_000 };
    vi.mocked(isOwnedLinkedVideo).mockResolvedValueOnce(true);
    vi.mocked(commercialMediaRequest).mockResolvedValueOnce({ sourceHash: "b".repeat(64), durationUs: 5_000_000, bytes: 500, metadata: { duration: 5 }, scenes: [interval] });
    const preview = await prepareCommercialAnalysis(userId, { projectId: project.id, mediaUrl: "https://example.com/source.mp4", mediaName: "source.mp4", automaticSplit: true });
    const quote = await quoteCommercialAnalysis(userId, { preparationId: preview.id, sceneIds: [interval.id], payer: "platform", model: "flash", outputLanguage: "zh" });
    await confirmCommercialTask(userId, quote.id);
    vi.mocked(commercialMediaRequest).mockResolvedValueOnce({ metadata: { duration: 5 }, scenes: [{ sceneIndex: 1, startTime: 0, endTime: 5, duration: 5, clipUrl: "https://example.com/clip.mp4", keyframeUrls: [] }] });
    await runCommercialTask(quote.id);
    const [job] = await testDb.select().from(schema.analysisSceneJobs);
    await testDb.update(schema.analysisSceneJobs).set({ state: "running", executionId: randomUUID(), result: {}, updatedAt: new Date(Date.now() - 25_000) }).where(eq(schema.analysisSceneJobs.id, job.id));
    expect(await recoverStaleAnalysisSceneJobs(5, quote.id)).toBe(0);
    await testDb.update(schema.analysisSceneJobs).set({ state: "running", executionId: randomUUID(), result: { pendingBlueprint: { story: {}, visual: {}, dialogue: [], narration: [], subtitle: [], audio: {}, transition: {}, generationPrompt: "Saved model answer", metadata: { analysisProvider: "kie" } } }, updatedAt: new Date(Date.now() - 5_000) }).where(eq(schema.analysisSceneJobs.id, job.id));
    expect(await recoverStaleAnalysisSceneJobs(5, quote.id)).toBe(0);
    await testDb.update(schema.analysisSceneJobs).set({ updatedAt: new Date(Date.now() - 25_000) }).where(eq(schema.analysisSceneJobs.id, job.id));
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("LOCAL_ANALYSIS_USER_IDS", randomUUID());
    await resumeLocalIndependentAnalyses();
    expect((await testDb.select().from(schema.analysisSceneJobs))[0].state).toBe("running");
    vi.stubEnv("LOCAL_ANALYSIS_USER_IDS", userId);
    await resumeLocalIndependentAnalyses();
    expect(await resumeIndependentAnalysis(quote.id)).toBe(false);
    expect(analyzeSceneBlueprint).not.toHaveBeenCalled();
    expect((await testDb.select().from(schema.sceneVersions))[0].generationPrompt).toBe("Saved model answer");
    expect((await testDb.select().from(schema.commercialTasks).where(eq(schema.commercialTasks.id, quote.id)))[0].state).toBe("completed");
    expect((await balance()).heldCredits).toBe(0);
  });
  it("claims at most two scenes per video while another inference is running", async () => {
    vi.stubEnv("KIE_AI_API_KEY", "platform-test-key");
    const [project] = await testDb.insert(schema.projects).values({ userId, title: "One child at a time" }).returning();
    const [version] = await testDb.insert(schema.projectVersions).values({ projectId: project.id, versionNumber: 0, label: "Original" }).returning();
    const [firstScene] = await testDb.insert(schema.videoScenes).values({ projectId: project.id, sceneIndex: 1, startTime: 0, endTime: 5, duration: 5 }).returning();
    const [secondScene] = await testDb.insert(schema.videoScenes).values({ projectId: project.id, sceneIndex: 2, startTime: 5, endTime: 10, duration: 5 }).returning();
    const [thirdScene] = await testDb.insert(schema.videoScenes).values({ projectId: project.id, sceneIndex: 3, startTime: 10, endTime: 15, duration: 5 }).returning();
    const intervals = [{ id: "one", startUs: 0, endUs: 5_000_000 }, { id: "two", startUs: 5_000_000, endUs: 10_000_000 }, { id: "three", startUs: 10_000_000, endUs: 15_000_000 }];
    const [task] = await testDb.insert(schema.commercialTasks).values({ userId, kind: "analysis", state: "running", credits: 12, input: { projectId: project.id, pricing: { payer: "platform", model: "flash", sourceDurationUs: 15_000_000, automaticSplit: false, paidSplitReusable: false, scenes: intervals }, modelId: "gemini-3-8-flash-openai", outputLanguage: "zh", keyFingerprint: generationKeyFingerprint("platform-test-key"), executionMode: "scene_jobs_v1" }, result: { executionId: randomUUID(), sceneJobMode: "independent_v1", versionId: version.id, sceneRecords: { one: firstScene.id, two: secondScene.id, three: thirdScene.id }, assets: { scenes: intervals.map((interval, index) => ({ sceneIndex: index + 1, startTime: interval.startUs / 1e6, endTime: interval.endUs / 1e6, duration: 5, clipUrl: `https://example.com/${index}.mp4`, keyframeUrls: [] })) } }, expiresAt: new Date(Date.now() + 600_000) }).returning();
    const jobs = await testDb.insert(schema.analysisSceneJobs).values([{ taskId: task.id, sceneId: "one", sceneIndex: 1 }, { taskId: task.id, sceneId: "two", sceneIndex: 2 }, { taskId: task.id, sceneId: "three", sceneIndex: 3 }]).returning();
    let finishFirst!: (blueprint: Awaited<ReturnType<typeof analyzeSceneBlueprint>>) => void;
    let finishSecond!: (blueprint: Awaited<ReturnType<typeof analyzeSceneBlueprint>>) => void;
    vi.mocked(analyzeSceneBlueprint).mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve; })).mockImplementationOnce(() => new Promise(resolve => { finishSecond = resolve; }));
    const first = runIndependentSceneJob(jobs[0].id);
    const second = runIndependentSceneJob(jobs[1].id);
    await vi.waitFor(() => expect(analyzeSceneBlueprint).toHaveBeenCalledTimes(2));
    expect(await runIndependentSceneJob(jobs[2].id)).toBe(false);
    await testDb.update(schema.analysisSceneJobs).set({ updatedAt: new Date(Date.now() - 7 * 60_000) }).where(eq(schema.analysisSceneJobs.id, jobs[0].id));
    expect(await recoverStaleAnalysisSceneJobs()).toBe(1);
    finishFirst({ story: {}, visual: {}, dialogue: [], narration: [], subtitle: [], audio: {}, transition: {}, generationPrompt: "First result", metadata: { analysisProvider: "kie" } });
    finishSecond({ story: {}, visual: {}, dialogue: [], narration: [], subtitle: [], audio: {}, transition: {}, generationPrompt: "Second result", metadata: { analysisProvider: "kie" } });
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect((await testDb.select().from(schema.analysisSceneJobs).orderBy(schema.analysisSceneJobs.sceneIndex)).map(job => job.state)).toEqual(["failed", "completed", "queued"]);
    expect((await testDb.select().from(schema.sceneVersions).where(eq(schema.sceneVersions.originalSceneId, firstScene.id)))).toHaveLength(1);
    expect((await testDb.select().from(schema.sceneVersions).where(eq(schema.sceneVersions.originalSceneId, firstScene.id)))[0].generationPrompt).not.toBe("First result");
  });
  it("settles one parent reservation when two scene workers finish together", async () => {
    await grant();
    vi.stubEnv("COMMERCIAL_CONSUMPTION_ENABLED", "true");
    vi.stubEnv("LOCAL_ANALYSIS_USER_IDS", userId);
    vi.stubEnv("KIE_AI_API_KEY", "platform-test-key");
    const [project] = await testDb.insert(schema.projects).values({ userId, title: "Two finishes" }).returning();
    const intervals = [{ id: "1", startUs: 0, endUs: 5_000_000 }, { id: "2", startUs: 5_000_000, endUs: 10_000_000 }];
    vi.mocked(isOwnedLinkedVideo).mockResolvedValueOnce(true);
    vi.mocked(commercialMediaRequest).mockResolvedValueOnce({ sourceHash: "c".repeat(64), durationUs: 10_000_000, bytes: 500, metadata: { duration: 10 }, scenes: intervals });
    const preview = await prepareCommercialAnalysis(userId, { projectId: project.id, mediaUrl: "https://example.com/source.mp4", mediaName: "source.mp4", automaticSplit: true });
    const quote = await quoteCommercialAnalysis(userId, { preparationId: preview.id, sceneIds: ["1", "2"], payer: "platform", model: "flash", outputLanguage: "zh" });
    await confirmCommercialTask(userId, quote.id);
    vi.mocked(commercialMediaRequest).mockResolvedValueOnce({ metadata: { duration: 10 }, scenes: intervals.map((interval, index) => ({ sceneIndex: index + 1, startTime: interval.startUs / 1e6, endTime: interval.endUs / 1e6, duration: 5, clipUrl: `https://example.com/${index}.mp4`, keyframeUrls: [] })) });
    await runCommercialTask(quote.id);
    const jobs = await testDb.select().from(schema.analysisSceneJobs).orderBy(schema.analysisSceneJobs.sceneIndex);
    vi.mocked(analyzeSceneBlueprint).mockResolvedValue({ story: {}, visual: {}, dialogue: [], narration: [], subtitle: [], audio: {}, transition: {}, generationPrompt: "Concurrent result", metadata: { analysisProvider: "kie" } });
    expect(await Promise.all(jobs.map(job => runIndependentSceneJob(job.id)))).toEqual([true, true]);
    const [reservation] = await testDb.select().from(schema.commercialReservations);
    expect(reservation).toMatchObject({ state: "settled", settledCredits: quote.credits });
    const settlements = await testDb.select().from(schema.commercialLedger).where(eq(schema.commercialLedger.eventKey, `settle:${reservation.id}`));
    expect(settlements).toHaveLength(1);
    expect((await testDb.select().from(schema.commercialTasks).where(eq(schema.commercialTasks.id, quote.id)))[0].state).toBe("completed");
    expect((await balance()).heldCredits).toBe(0);
  });
  it("reconciles a terminal scene parent after its final worker exits before settlement", async () => {
    await grant();
    const [project] = await testDb.insert(schema.projects).values({ userId, title: "Terminal scene recovery" }).returning();
    const [task] = await testDb.insert(schema.commercialTasks).values({
      userId, kind: "analysis", state: "running", credits: 5, expiresAt: new Date(Date.now() + 600_000),
      input: { projectId: project.id, pricing: { payer: "platform", model: "flash", sourceDurationUs: 5_000_000, automaticSplit: false, paidSplitReusable: false, scenes: [{ id: "1", startUs: 0, endUs: 5_000_000 }] } },
      result: { sceneJobMode: "independent_v1", executionId: randomUUID() },
    }).returning();
    await reserveCommercialTask({ userId, taskKey: `commercial:${task.id}`, credits: 5, rewrites: 0, quote: { kind: "analysis" } });
    await testDb.insert(schema.analysisSceneJobs).values({ taskId: task.id, sceneId: "1", sceneIndex: 1, state: "failed" });
    expect(await reconcileTerminalIndependentAnalysis(task.id)).toBe(1);
    expect(await reconcileTerminalIndependentAnalysis(task.id)).toBe(0);
    const [reservation] = await testDb.select().from(schema.commercialReservations);
    expect(reservation).toMatchObject({ state: "settled", settledCredits: 0 });
    expect((await testDb.select().from(schema.commercialLedger).where(eq(schema.commercialLedger.eventKey, `settle:${reservation.id}`)))).toHaveLength(1);
    expect((await testDb.select().from(schema.commercialTasks).where(eq(schema.commercialTasks.id, task.id)))[0].state).toBe("failed");
    expect((await balance()).heldCredits).toBe(0);
  });
  it("enables independent jobs for every account without experiment flags", async () => {
    await grant();
    vi.stubEnv("COMMERCIAL_CONSUMPTION_ENABLED", "true");
    vi.stubEnv("KIE_AI_API_KEY", "platform-test-key");
    vi.stubEnv("COMMERCIAL_SCENE_JOB_EXPERIMENT", "false");
    const [project] = await testDb.insert(schema.projects).values({ userId, title: "Default flow" }).returning();
    vi.mocked(commercialMediaRequest).mockResolvedValueOnce({ sourceHash: "a".repeat(64), durationUs: 5_000_000, bytes: 500, metadata: {}, scenes: [{ id: "1", startUs: 0, endUs: 5_000_000 }] });
    const preview = await prepareCommercialAnalysis(userId, { projectId: project.id, mediaUrl: "https://example.com/source.mp4", mediaName: "source.mp4", automaticSplit: false });
    const quote = await quoteCommercialAnalysis(userId, { preparationId: preview.id, sceneIds: ["1"], payer: "platform", model: "flash", outputLanguage: "zh" });
    const [quoted] = await testDb.select().from(schema.commercialTasks).where(eq(schema.commercialTasks.id, quote.id));
    expect(quoted.input).toMatchObject({ executionMode: "scene_jobs_v1" });
    await confirmCommercialTask(userId, quote.id);
    vi.mocked(commercialMediaRequest).mockResolvedValueOnce({ metadata: {}, scenes: [{ sceneIndex: 1, startTime: 0, endTime: 5, duration: 5, keyframeUrls: [] }] });
    await runCommercialTask(quote.id);
    expect(analyzeSceneBlueprint).not.toHaveBeenCalled();
    expect(await testDb.select().from(schema.analysisSceneJobs)).toMatchObject([{ state: "queued", sceneId: "1" }]);
  });
  it("adopts a historical saved answer into scene jobs without another model request", async () => {
    await grant();
    vi.stubEnv("COMMERCIAL_CONSUMPTION_ENABLED", "true");
    vi.stubEnv("KIE_AI_API_KEY", "platform-test-key");
    const [project] = await testDb.insert(schema.projects).values({ userId, title: "Historical saved answer" }).returning();
    vi.mocked(commercialMediaRequest).mockResolvedValueOnce({ sourceHash: "a".repeat(64), durationUs: 5_000_000, bytes: 500, metadata: {}, scenes: [{ id: "1", startUs: 0, endUs: 5_000_000 }] });
    const preview = await prepareCommercialAnalysis(userId, { projectId: project.id, mediaUrl: "https://example.com/source.mp4", mediaName: "source.mp4", automaticSplit: false });
    const quote = await quoteCommercialAnalysis(userId, { preparationId: preview.id, sceneIds: ["1"], payer: "platform", model: "flash", outputLanguage: "zh" });
    await confirmCommercialTask(userId, quote.id);
    vi.mocked(commercialMediaRequest).mockResolvedValueOnce({ metadata: {}, scenes: [{ sceneIndex: 1, startTime: 0, endTime: 5, duration: 5, keyframeUrls: [] }] });
    await runCommercialTask(quote.id);
    await client.query("DELETE FROM analysis_scene_jobs WHERE task_id = $1", [quote.id]);
    const pendingResult = { sceneId: "1", blueprint: { story: {}, visual: {}, dialogue: [], narration: [], subtitle: [], audio: {}, transition: {}, generationPrompt: "Historical answer", metadata: { analysisProvider: "kie" } } };
    await client.query("UPDATE commercial_tasks SET state = 'review', input = input - 'executionMode', result = (result - 'sceneJobMode') || $2::jsonb, updated_at = now() - interval '61 seconds' WHERE id = $1", [quote.id, JSON.stringify({ pendingResult })]);
    await recoverCommercialAnalysisTasks(quote.id);
    await drain(quote.id);
    await drain(quote.id);
    expect(analyzeSceneBlueprint).not.toHaveBeenCalled();
    expect(await testDb.select().from(schema.sceneVersions)).toMatchObject([{ generationPrompt: "Historical answer" }]);
    expect(await testDb.select().from(schema.sceneVersions)).toHaveLength(1);
    expect(await balance()).toMatchObject({ heldCredits: 0 });
  });
  it("retries only the selected failed shot and leaves other failures for a later retry", async () => {
    await grant();
    vi.stubEnv("COMMERCIAL_CONSUMPTION_ENABLED", "true");
    vi.stubEnv("KIE_AI_API_KEY", "platform-test-key");
    const [project] = await testDb.insert(schema.projects).values({ userId, title: "Failed shots" }).returning();
    const intervals = [{ id: "1", startUs: 0, endUs: 5000000 }, { id: "2", startUs: 5000000, endUs: 10000000 }];
    vi.mocked(commercialMediaRequest).mockResolvedValueOnce({ sourceHash: "a".repeat(64), durationUs: 10000000, bytes: 500, metadata: { duration: 10 }, scenes: intervals });
    const preview = await prepareCommercialAnalysis(userId, { projectId: project.id, mediaUrl: "https://example.com/source.mp4", mediaName: "source.mp4", automaticSplit: true });
    const quote = await quoteCommercialAnalysis(userId, { preparationId: preview.id, sceneIds: ["1", "2"], payer: "platform", model: "flash", outputLanguage: "zh" });
    await confirmCommercialTask(userId, quote.id);
    vi.mocked(commercialMediaRequest).mockResolvedValueOnce({ metadata: { duration: 10 }, scenes: intervals.map((s, index) => ({ sceneIndex: index + 1, startTime: s.startUs / 1000000, endTime: s.endUs / 1000000, duration: 5, keyframeUrls: ["https://example.com/frame.jpg"], clipUrl: "https://example.com/clip.mp4" })) });
    vi.mocked(analyzeSceneBlueprint).mockRejectedValue(new Error("Failed"));
    await drain(quote.id);
    const versions = await testDb.query.sceneVersions.findMany({ orderBy: [schema.sceneVersions.sceneIndex] });
    await expect(quoteCommercialAnalysisRetry(randomUUID(), quote.id, versions[0].id)).rejects.toThrow("ANALYSIS_NOT_SETTLED");
    await expect(quoteCommercialAnalysisRetry(userId, quote.id, randomUUID())).rejects.toThrow("SCENE_ALREADY_CHANGED");
    const retry = await quoteCommercialAnalysisRetry(userId, quote.id, versions[0].id);
    expect(retry).toMatchObject({ sceneCount: 1, credits: 5 });
    const competing = await quoteCommercialAnalysisRetry(userId, quote.id, versions[1].id);
    await confirmCommercialTask(userId, retry.id);
    await expect(confirmCommercialTask(userId, competing.id)).rejects.toThrow("USE_LATEST_RETRY_TASK");
    vi.mocked(analyzeSceneBlueprint).mockResolvedValue({ story: {}, visual: {}, dialogue: [], narration: [], subtitle: [], audio: {}, transition: {}, generationPrompt: "Retried", metadata: { analysisProvider: "kie" } });
    await drain(retry.id);
    expect(analyzeSceneBlueprint).toHaveBeenCalledTimes(3);
    const saved = await testDb.query.videoScenes.findMany({ orderBy: [schema.videoScenes.sceneIndex] });
    expect(saved.map(scene => scene.status)).toEqual(["completed", "failed"]);
    await expect(quoteCommercialAnalysisRetry(userId, retry.id, versions[0].id)).rejects.toThrow("SCENE_ALREADY_CHANGED");
    const second = await quoteCommercialAnalysisRetry(userId, retry.id, versions[1].id);
    expect(second).toMatchObject({ sceneCount: 1, credits: 3 });
    await confirmCommercialTask(userId, second.id);
    await drain(second.id);
    expect(analyzeSceneBlueprint).toHaveBeenCalledTimes(4);
    expect(commercialMediaRequest).toHaveBeenCalledTimes(2);
    expect(await balance()).toMatchObject({ credits: 192, heldCredits: 0 });
  });
  it("runs generation quote, durable submission, and settlement without re-debiting callbacks", async () => {
    await grant();
    vi.stubEnv("COMMERCIAL_CONSUMPTION_ENABLED", "true");
    vi.stubEnv("KIE_AI_API_KEY", "platform-test-key");
    const quote = await quoteCommercialGeneration(userId, { userPrompt: "A new cinematic scene", model: "wan/2-6-text-to-video", duration: 5, quality: "720p" });
    expect(quote.credits).toBe(29);
    await confirmCommercialTask(userId, quote.id);
    const fetchMock = vi.fn(async (_url: unknown, options?: RequestInit) => options?.method === "POST"
      ? Response.json({ code: 200, data: { taskId: "provider-task-1" } })
      : Response.json({ code: 200, data: { taskId: "provider-task-1", state: "success", resultJson: JSON.stringify({ resultUrls: ["https://example.com/result.mp4"] }) } }));
    vi.stubGlobal("fetch", fetchMock);
    await runCommercialTask(quote.id);
    await runCommercialTask(quote.id);
    expect(await balance()).toMatchObject({ credits: 171, heldCredits: 29 });
    await reconcileCommercialGeneration(quote.id);
    await reconcileCommercialGeneration(quote.id);
    expect(await balance()).toMatchObject({ credits: 171, heldCredits: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((await testDb.select().from(schema.videoGeneration))[0]).toMatchObject({ status: "completed", videoUrl: "https://example.com/result.mp4" });
  });

  it("snapshots the real analysis model without accepting a platform tier override", () => {
    expect(quotedAnalysisModel({ payer: "platform", model: "flash", modelId: "analysis-gemini-2-5-pro" })).toBe("gemini-3-8-flash-openai");
    expect(quotedAnalysisModel({ payer: "byok", model: "flash", modelId: "analysis-gemini-3-5-flash" })).toBe("gemini-3-5-flash-openai");
    expect(() => quotedAnalysisModel({ payer: "byok", model: "flash", modelId: "nonexistent" })).toThrow();
    expect(() => quotedAnalysisModel({ payer: "platform", model: "pro" })).toThrow();
    expect(() => quotedAnalysisModel({ payer: "byok", model: "flash", modelId: "analysis-gemini-2-5-pro" })).toThrow();
  });

  it("recovers a stopped paid analysis without repeating inference or retaining its charge", async () => {
    await grant();
    vi.stubEnv("COMMERCIAL_CONSUMPTION_ENABLED", "true");
    vi.stubEnv("KIE_AI_API_KEY", "platform-test-key");
    const [project] = await testDb.insert(schema.projects).values({ userId, title: "Interrupted" }).returning();
    const intervals = [{ id: "1", startUs: 0, endUs: 5000000 }];
    vi.mocked(commercialMediaRequest).mockResolvedValueOnce({ sourceHash: "a".repeat(64), durationUs: 5000000, bytes: 500, metadata: {}, scenes: intervals });
    const preparation = await prepareCommercialAnalysis(userId, { projectId: project.id, mediaUrl: "https://example.com/a.mp4", mediaName: "a", automaticSplit: false });
    const quote = await quoteCommercialAnalysis(userId, { preparationId: preparation.id, sceneIds: ["1"], payer: "platform", model: "flash", outputLanguage: "zh" });
    await confirmCommercialTask(userId, quote.id);
    vi.mocked(commercialMediaRequest).mockResolvedValueOnce({ metadata: {}, scenes: [{ sceneIndex: 1, startTime: 0, endTime: 5, duration: 5, keyframeUrls: [] }] });
    await runCommercialTask(quote.id);
    await client.query("DELETE FROM analysis_scene_jobs WHERE task_id = $1", [quote.id]);
    await client.query("UPDATE commercial_tasks SET state = 'running', result = result - 'sceneJobMode', updated_at = now() - interval '31 minutes' WHERE id = $1", [quote.id]);
    await recoverCommercialAnalysisTasks();
    await recoverCommercialAnalysisTasks();
    await drain(quote.id);
    expect(analyzeSceneBlueprint).not.toHaveBeenCalled();
    expect(await balance()).toMatchObject({ credits: 200, heldCredits: 0 });
    expect((await testDb.select().from(schema.sceneVersions))[0].generationPrompt).toBe("");
    expect((await testDb.select().from(schema.sceneVersions))[0].metadata).toMatchObject({ failureCode: "ANALYSIS_INTERRUPTED", providerOutcome: "unknown" });
    expect((await testDb.select().from(schema.projects))[0].status).toBe("failed");
    expect((await quoteCommercialAnalysisRetry(userId, quote.id)).credits).toBe(quote.credits);
  });
  it("continues later shots after one model request is interrupted", async () => {
    await grant();
    vi.stubEnv("COMMERCIAL_CONSUMPTION_ENABLED", "true");
    vi.stubEnv("KIE_AI_API_KEY", "platform-test-key");
    const [project] = await testDb.insert(schema.projects).values({ userId, title: "Continue after interruption" }).returning();
    const intervals = [1, 2, 3].map(index => ({ id: String(index), startUs: (index - 1) * 5_000_000, endUs: index * 5_000_000 }));
    vi.mocked(commercialMediaRequest).mockResolvedValueOnce({ sourceHash: "a".repeat(64), durationUs: 15_000_000, bytes: 500, metadata: {}, scenes: intervals });
    const preview = await prepareCommercialAnalysis(userId, { projectId: project.id, mediaUrl: "https://example.com/a.mp4", mediaName: "a", automaticSplit: true });
    const quote = await quoteCommercialAnalysis(userId, { preparationId: preview.id, sceneIds: intervals.map(scene => scene.id), payer: "platform", model: "flash", outputLanguage: "zh" });
    await confirmCommercialTask(userId, quote.id);
    vi.mocked(commercialMediaRequest).mockResolvedValueOnce({ metadata: {}, scenes: intervals.map((scene, index) => ({ sceneIndex: index + 1, startTime: scene.startUs / 1_000_000, endTime: scene.endUs / 1_000_000, duration: 5, keyframeUrls: [] })) });
    await runCommercialTask(quote.id);
    vi.mocked(analyzeSceneBlueprint).mockResolvedValue({ story: {}, visual: {}, dialogue: [], narration: [], subtitle: [], audio: {}, transition: {}, generationPrompt: "Analyzed", metadata: { analysisProvider: "kie" } });
    const firstJob = (await testDb.select().from(schema.analysisSceneJobs).where(eq(schema.analysisSceneJobs.taskId, quote.id)))[0];
    await runIndependentSceneJob(firstJob.id);
    await client.query("DELETE FROM analysis_scene_jobs WHERE task_id = $1", [quote.id]);
    await client.query("UPDATE commercial_tasks SET state='running', result=(result - 'sceneJobMode') || '{\"executionPhase\":\"model_request\",\"activeSceneId\":\"2\"}'::jsonb, updated_at=now()-interval '7 minutes' WHERE id=$1", [quote.id]);
    await recoverCommercialAnalysisTasks();
    const [resumed] = await testDb.select().from(schema.commercialTasks).where(eq(schema.commercialTasks.id, quote.id));
    expect(resumed).toMatchObject({ state: "queued", result: { pendingResult: { sceneId: "2", blueprint: { metadata: { providerOutcome: "unknown" } } }, finishedSceneIds: ["1"], successfulSceneIds: ["1"] } });
    await drain(quote.id);
    expect(analyzeSceneBlueprint).toHaveBeenCalledTimes(2);
    const versions = await testDb.query.sceneVersions.findMany({ orderBy: [schema.sceneVersions.sceneIndex] });
    expect(versions.map(version => (version.metadata as Record<string, unknown>).analysisProvider)).toEqual(["kie", "fallback", "kie"]);
    expect(versions[1].metadata).toMatchObject({ failureCode: "ANALYSIS_INTERRUPTED", providerOutcome: "unknown" });
    const [completed] = await testDb.select().from(schema.commercialTasks).where(eq(schema.commercialTasks.id, quote.id));
    const charged = settleAnalysis((completed.input as { pricing: AnalysisPriceInput }).pricing, ["1", "3"], true);
    expect(completed).toMatchObject({ state: "completed", result: { successfulSceneIds: ["1", "3"], finishedSceneIds: ["1", "2", "3"], chargedCredits: charged, totalChargedCredits: charged } });
    expect(await balance()).toMatchObject({ credits: 200 - charged, heldCredits: 0 });
    const [reservation] = await testDb.select().from(schema.commercialReservations).where(eq(schema.commercialReservations.taskKey, `commercial:${quote.id}`));
    expect(reservation).toMatchObject({ state: "settled", settledCredits: charged });
    const settlement = await testDb.select().from(schema.commercialLedger).where(eq(schema.commercialLedger.eventKey, `settle:${reservation.id}`));
    expect(settlement).toMatchObject([{ credits: -charged }]);
    await recoverCommercialAnalysisTasks();
    await runCommercialTask(quote.id);
    expect(await balance()).toMatchObject({ credits: 200 - charged, heldCredits: 0 });
    expect(await testDb.select().from(schema.commercialLedger).where(eq(schema.commercialLedger.eventKey, `settle:${reservation.id}`))).toHaveLength(1);
  });
  it("does not charge or repeat a KIE unknown fallback saved by the normal analysis path", async () => {
    await grant();
    vi.stubEnv("COMMERCIAL_CONSUMPTION_ENABLED", "true");
    vi.stubEnv("KIE_AI_API_KEY", "platform-test-key");
    const [project] = await testDb.insert(schema.projects).values({ userId, title: "Unknown provider result" }).returning();
    const interval = { id: "1", startUs: 0, endUs: 5_000_000 };
    vi.mocked(commercialMediaRequest).mockResolvedValueOnce({ sourceHash: "a".repeat(64), durationUs: 5_000_000, bytes: 500, metadata: {}, scenes: [interval] });
    const preview = await prepareCommercialAnalysis(userId, { projectId: project.id, mediaUrl: "https://example.com/a.mp4", mediaName: "a", automaticSplit: false });
    const quote = await quoteCommercialAnalysis(userId, { preparationId: preview.id, sceneIds: ["1"], payer: "platform", model: "flash", outputLanguage: "zh" });
    await confirmCommercialTask(userId, quote.id);
    const scene = { sceneIndex: 1, startTime: 0, endTime: 5, duration: 5, keyframeUrls: [] };
    vi.mocked(commercialMediaRequest).mockResolvedValueOnce({ metadata: {}, scenes: [scene] });
    vi.mocked(analyzeSceneBlueprint).mockResolvedValueOnce({ ...buildFallbackSceneBlueprint(scene, "KIE response interrupted"), metadata: { analysisProvider: "fallback", providerOutcome: "unknown", failureCode: "KIE_OUTCOME_UNKNOWN" } });
    await drain(quote.id);
    await runCommercialTask(quote.id);
    expect(analyzeSceneBlueprint).toHaveBeenCalledTimes(1);
    const [version] = await testDb.select().from(schema.sceneVersions);
    expect(version.metadata).toMatchObject({ analysisProvider: "fallback", providerOutcome: "unknown", failureCode: "KIE_OUTCOME_UNKNOWN" });
    const [task] = await testDb.select().from(schema.commercialTasks).where(eq(schema.commercialTasks.id, quote.id));
    expect(task).toMatchObject({ state: "failed", result: { successfulSceneIds: [], chargedCredits: 0 } });
    expect(await balance()).toMatchObject({ credits: 200, heldCredits: 0 });
    const [reservation] = await testDb.select().from(schema.commercialReservations).where(eq(schema.commercialReservations.taskKey, `commercial:${quote.id}`));
    expect(reservation).toMatchObject({ state: "settled", settledCredits: 0 });
    expect(await testDb.select().from(schema.commercialLedger).where(eq(schema.commercialLedger.eventKey, `settle:${reservation.id}`))).toMatchObject([{ credits: 0 }]);
  });
  it.each([false, true])("discards late paid analysis results after settlement (retry=%s)", async (retry) => {
    await grant();
    vi.stubEnv("COMMERCIAL_CONSUMPTION_ENABLED", "true");
    vi.stubEnv("KIE_AI_API_KEY", "platform-test-key");
    const [project] = await testDb.insert(schema.projects).values({ userId, title: "Late response" }).returning();
    vi.mocked(commercialMediaRequest).mockResolvedValueOnce({ sourceHash: "a".repeat(64), durationUs: 5000000, bytes: 500, metadata: {}, scenes: [{ id: "1", startUs: 0, endUs: 5000000 }] });
    const preparation = await prepareCommercialAnalysis(userId, { projectId: project.id, mediaUrl: "https://example.com/a.mp4", mediaName: "a", automaticSplit: false });
    const quote = await quoteCommercialAnalysis(userId, { preparationId: preparation.id, sceneIds: ["1"], payer: "platform", model: "flash", outputLanguage: "zh" });
    await confirmCommercialTask(userId, quote.id);
    expect((await testDb.select().from(schema.projects))[0].metadata).toMatchObject({ analysisTaskId: quote.id });
    vi.mocked(commercialMediaRequest).mockResolvedValueOnce({ metadata: {}, scenes: [{ sceneIndex: 1, startTime: 0, endTime: 5, duration: 5, keyframeUrls: [] }] });
    await runCommercialTask(quote.id);
    let taskId = quote.id;
    if (retry) {
      vi.mocked(analyzeSceneBlueprint).mockRejectedValueOnce(new Error("provider failed"));
      await drain(taskId);
      taskId = (await quoteCommercialAnalysisRetry(userId, taskId)).id;
      await confirmCommercialTask(userId, taskId);
    }
    let deliver!: (value: Awaited<ReturnType<typeof analyzeSceneBlueprint>>) => void;
    let started!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    vi.mocked(analyzeSceneBlueprint).mockImplementationOnce(() => { started(); return new Promise(resolve => { deliver = resolve; }); });
    await runCommercialTask(taskId);
    const [job] = await testDb.select().from(schema.analysisSceneJobs).where(eq(schema.analysisSceneJobs.taskId, taskId));
    const running = runIndependentSceneJob(job.id);
    await entered;
    await client.query("UPDATE analysis_scene_jobs SET updated_at = now() - interval '5 minutes' WHERE id = $1", [job.id]);
    await recoverStaleAnalysisSceneJobs(5, taskId);
    expect((await testDb.select().from(schema.commercialTasks)).find(t => t.id === taskId)?.state).toBe("running");
    await client.query("UPDATE analysis_scene_jobs SET updated_at = now() - interval '7 minutes' WHERE id = $1", [job.id]);
    await recoverStaleAnalysisSceneJobs(5, taskId);
    deliver({ story: {}, visual: {}, dialogue: [], narration: [], subtitle: [], audio: {}, transition: {}, generationPrompt: "Late result", metadata: { analysisProvider: "kie" } });
    await running;
    expect((await testDb.select().from(schema.sceneVersions))[0].generationPrompt).toBe("");
    expect((await testDb.select().from(schema.commercialTasks)).find(t => t.id === taskId)?.state).toBe("failed");
    expect(await balance()).toMatchObject({ credits: 200, heldCredits: 0 });
  });
  it("finishes failed and abandoned media preparations", async () => {
    vi.stubEnv("COMMERCIAL_CONSUMPTION_ENABLED", "true");
    const [project] = await testDb.insert(schema.projects).values({ userId, title: "Preview failure" }).returning();
    vi.mocked(commercialMediaRequest).mockRejectedValueOnce(new Error("worker unavailable"));
    await expect(prepareCommercialAnalysis(userId, { projectId: project.id, mediaUrl: "https://example.com/a.mp4", mediaName: "a", automaticSplit: false })).rejects.toThrow("worker unavailable");
    expect((await testDb.select().from(schema.commercialTasks))[0].state).toBe("failed");
    await testDb.insert(schema.commercialTasks).values({ userId, kind: "analysis_preview", state: "running", input: {}, expiresAt: new Date(Date.now() - 1000) });
    await recoverCommercialAnalysisTasks();
    expect((await testDb.select().from(schema.commercialTasks)).every(t => t.state === "failed")).toBe(true);
  });
  it("reserves a multi-output batch atomically or starts none", async () => {
    await grant(57, 20);
    vi.stubEnv("COMMERCIAL_CONSUMPTION_ENABLED", "true");
    vi.stubEnv("KIE_AI_API_KEY", "platform-test-key");
    const a = await quoteCommercialGeneration(userId, { userPrompt: "A cinematic scene", duration: 5, quality: "720p" });
    const b = await quoteCommercialGeneration(userId, { userPrompt: "Another scene", duration: 5, quality: "720p" });
    await expect(testDb.transaction(async (tx) => {
      await confirmCommercialTaskInTransaction(tx as unknown as Parameters<typeof confirmCommercialTaskInTransaction>[0], userId, a.id);
      await confirmCommercialTaskInTransaction(tx as unknown as Parameters<typeof confirmCommercialTaskInTransaction>[0], userId, b.id);
    })).rejects.toThrow("INSUFFICIENT_COMMERCIAL_BALANCE");
    expect(await balance()).toMatchObject({ credits: 57, heldCredits: 0 });
    expect((await testDb.select().from(schema.commercialTasks)).every((t) => t.state === "quoted")).toBe(true);
  });
  it("releases a rejected generation but retains an unknown submission without retrying it", async () => {
    await grant(200, 20);
    vi.stubEnv("COMMERCIAL_CONSUMPTION_ENABLED", "true");
    vi.stubEnv("KIE_AI_API_KEY", "platform-test-key");
    const quote = await quoteCommercialGeneration(userId, { userPrompt: "A cinematic scene", duration: 5 });
    await confirmCommercialTask(userId, quote.id);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ code: 433 })));
    await runCommercialTask(quote.id);
    expect(await balance()).toMatchObject({ credits: 200, heldCredits: 0 });
    const uncertain = await quoteCommercialGeneration(userId, { userPrompt: "Another scene", duration: 5 });
    await confirmCommercialTask(userId, uncertain.id);
    const fetchMock = vi.fn().mockRejectedValue(new Error("timeout"));
    vi.stubGlobal("fetch", fetchMock);
    await runCommercialTask(uncertain.id);
    await runCommercialTask(uncertain.id);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [reviewTask] = await testDb.select().from(schema.commercialTasks).where(eq(schema.commercialTasks.id, uncertain.id));
    expect(reviewTask).toMatchObject({ state: "review", result: { review: { reason: "provider_unknown", action: "manual_reconciliation", reservedCredits: 29 }, reviewHistory: [{ action: "entered_review", reason: "provider_unknown" }] } });
    expect(await balance()).toMatchObject({ credits: 171, heldCredits: 29 });
  });
  it("escalates overdue reviews once without changing task or wallet settlement", async () => {
    await grant();
    const [overdue] = await testDb.insert(schema.commercialTasks).values({ userId, kind: "generation", state: "review", input: {}, credits: 29, result: { review: { reason: "provider_unknown", deadlineAt: new Date(Date.now() - 60_000).toISOString() } }, expiresAt: new Date(Date.now() + 600_000) }).returning();
    const [fresh] = await testDb.insert(schema.commercialTasks).values({ userId, kind: "analysis", state: "review", input: {}, credits: 3, result: { review: { reason: "save_failed", deadlineAt: new Date(Date.now() + 60_000).toISOString() } }, expiresAt: new Date(Date.now() + 600_000) }).returning();
    expect(await escalateOverdueCommercialReviews()).toBe(1);
    expect(await escalateOverdueCommercialReviews()).toBe(0);
    const [current] = await testDb.select().from(schema.commercialTasks).where(eq(schema.commercialTasks.id, overdue.id));
    expect(current).toMatchObject({ state: "review", result: { review: { reason: "provider_unknown", action: "manual_reconciliation", reservedCredits: 29 }, reviewHistory: [{ action: "escalated_for_manual_reconciliation" }] } });
    expect((current.result as { reviewHistory: unknown[] }).reviewHistory).toHaveLength(1);
    expect((await testDb.select().from(schema.commercialTasks).where(eq(schema.commercialTasks.id, fresh.id)))[0].result).not.toHaveProperty("reviewHistory");
    expect(await balance()).toMatchObject({ credits: 200, heldCredits: 0 });
  });
  it("notifies overdue reviews and keeps reminding an assigned owner", async () => {
    vi.stubEnv("COMMERCIAL_REVIEW_ALERT_EMAIL", "ops@example.com");
    const [task] = await testDb.insert(schema.commercialTasks).values({ userId, kind: "generation", state: "review", input: {}, credits: 29, result: { review: { reason: "provider_unknown", deadlineAt: new Date(Date.now() - 60_000).toISOString() } }, expiresAt: new Date(Date.now() + 600_000) }).returning();
    await escalateOverdueCommercialReviews();
    expect(await notifyDueCommercialReviews()).toBe(1);
    expect(await notifyDueCommercialReviews()).toBe(0);
    expect(vi.mocked(sendEmail)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendEmail).mock.calls[0][0].to).toBe("ops@example.com");
    await acknowledgeCommercialReview(task.id, "admin-test");
    await expect(acknowledgeCommercialReview(task.id, "second-admin")).rejects.toThrow("REVIEW_NOT_AVAILABLE");
    await client.query("UPDATE commercial_tasks SET result = jsonb_set(result, '{review,nextFollowUpAt}', to_jsonb((now() - interval '1 minute')::text)) WHERE id = $1", [task.id]);
    expect(await notifyDueCommercialReviews()).toBe(1);
    const [current] = await testDb.select().from(schema.commercialTasks).where(eq(schema.commercialTasks.id, task.id));
    expect(current.result).toMatchObject({ review: { assignedTo: "admin-test", lastNotifiedAt: expect.any(String) }, reviewHistory: [{ action: "escalated_for_manual_reconciliation" }, { action: "review_alert_accepted_by_smtp" }, { action: "review_acknowledged", actorId: "admin-test" }, { action: "review_alert_accepted_by_smtp" }] });
    expect(vi.mocked(sendEmail)).toHaveBeenCalledTimes(2);
  });
  it("retries failed review alerts without claiming successful delivery", async () => {
    vi.stubEnv("COMMERCIAL_REVIEW_ALERT_EMAIL", "ops@example.com");
    const [task] = await testDb.insert(schema.commercialTasks).values({ userId, kind: "analysis", state: "review", input: {}, credits: 4, result: { review: { reason: "save_failed", deadlineAt: new Date(Date.now() - 60_000).toISOString() } }, expiresAt: new Date(Date.now() + 600_000) }).returning();
    await escalateOverdueCommercialReviews();
    vi.mocked(sendEmail).mockRejectedValueOnce(new Error("SMTP unavailable"));
    expect(await notifyDueCommercialReviews()).toBe(0);
    let [current] = await testDb.select().from(schema.commercialTasks).where(eq(schema.commercialTasks.id, task.id));
    expect(current.result).toMatchObject({ review: { lastNotificationError: "SMTP unavailable" } });
    expect((current.result as { review: { lastNotifiedAt?: string } }).review.lastNotifiedAt).toBeUndefined();
    await client.query("UPDATE commercial_tasks SET result = jsonb_set(result, '{review,nextFollowUpAt}', to_jsonb((now() - interval '1 minute')::text)) WHERE id = $1", [task.id]);
    expect(await notifyDueCommercialReviews()).toBe(1);
    [current] = await testDb.select().from(schema.commercialTasks).where(eq(schema.commercialTasks.id, task.id));
    expect(current.result).toMatchObject({ review: { lastNotificationError: null, lastNotifiedAt: expect.any(String) } });
  });
  it("releases only an undelivered analysis with audit and project closure", async () => {
    await grant();
    const [project] = await testDb.insert(schema.projects).values({ userId, title: "Undelivered", status: "analyzing" }).returning();
    const [task] = await testDb.insert(schema.commercialTasks).values({ userId, kind: "analysis", state: "review", input: { projectId: project.id, pricing: { automaticSplit: false } }, credits: 4, result: { review: { reason: "save_failed" }, successfulSceneIds: [] }, expiresAt: new Date(Date.now() + 600_000) }).returning();
    const key = `commercial:${task.id}`;
    const { reservation } = await reserveCommercialTask({ userId, taskKey: key, credits: 4, rewrites: 0, quote: { projectId: project.id } });
    await client.query("UPDATE commercial_reservations SET created_at = now() - interval '25 hours' WHERE id = $1", [reservation.id]);
    const competing = await Promise.allSettled(["admin-test", "second-admin"].map(actorId => releaseUnfulfilledCommercialAnalysis({ reservationId: reservation.id, actorId, evidence: "Confirmed no result was delivered" })));
    expect(competing.map(result => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    await expect(releaseUnfulfilledCommercialAnalysis({ reservationId: reservation.id, actorId: "admin-test", evidence: "Confirmed no result was delivered" })).rejects.toThrow("RESERVATION_NOT_ELIGIBLE");
    expect(await balance()).toMatchObject({ credits: 200, heldCredits: 0 });
    expect((await testDb.select().from(schema.projects).where(eq(schema.projects.id, project.id)))[0].status).toBe("failed");
    expect((await testDb.select().from(schema.commercialTasks).where(eq(schema.commercialTasks.id, task.id)))[0]).toMatchObject({ state: "failed", result: { reviewResolution: { action: "manual_full_release" }, reviewHistory: [{ action: "manual_full_release" }] } });
    expect((await testDb.select().from(schema.commercialReservations).where(eq(schema.commercialReservations.id, reservation.id)))[0]).toMatchObject({ state: "settled", settledCredits: 0 });
    expect((await testDb.select().from(schema.commercialLedger).where(eq(schema.commercialLedger.eventKey, `review-release:${reservation.id}`))).length).toBe(1);
  });
  it("keeps delivered analysis and unknown generation under review", async () => {
    await grant();
    for (const [kind, result] of [["analysis", { review: {}, splitDelivered: true }], ["generation", { review: { reason: "provider_unknown" } }]] as const) {
      const [task] = await testDb.insert(schema.commercialTasks).values({ userId, kind, state: "review", input: {}, credits: 4, result, expiresAt: new Date(Date.now() + 600_000) }).returning();
      const { reservation } = await reserveCommercialTask({ userId, taskKey: `commercial:${task.id}`, credits: 4, rewrites: 0, quote: {} });
      await client.query("UPDATE commercial_reservations SET created_at = now() - interval '25 hours' WHERE id = $1", [reservation.id]);
      await expect(releaseUnfulfilledCommercialAnalysis({ reservationId: reservation.id, actorId: "admin-test", evidence: "Reviewed the provider records" })).rejects.toThrow("TASK_NOT_ELIGIBLE_FOR_FULL_RELEASE");
      expect((await testDb.select().from(schema.commercialReservations).where(eq(schema.commercialReservations.id, reservation.id)))[0].state).toBe("held");
    }
    expect(await balance()).toMatchObject({ credits: 192, heldCredits: 8 });
  });
  it("checks durable scene delivery before releasing an inconsistent review", async () => {
    await grant();
    const [project] = await testDb.insert(schema.projects).values({ userId, title: "Saved scene", status: "analyzing" }).returning();
    const [task] = await testDb.insert(schema.commercialTasks).values({ userId, kind: "analysis", state: "review", input: { projectId: project.id, pricing: { automaticSplit: false } }, credits: 4, result: { review: {}, successfulSceneIds: [] }, expiresAt: new Date(Date.now() + 600_000) }).returning();
    const { reservation } = await reserveCommercialTask({ userId, taskKey: `commercial:${task.id}`, credits: 4, rewrites: 0, quote: {} });
    await client.query("UPDATE commercial_reservations SET created_at = now() - interval '25 hours' WHERE id = $1", [reservation.id]);
    const [version] = await testDb.insert(schema.projectVersions).values({ projectId: project.id, versionNumber: 0, label: "Original" }).returning();
    const [scene] = await testDb.insert(schema.videoScenes).values({ projectId: project.id, sceneIndex: 1, startTime: 0, endTime: 5, duration: 5 }).returning();
    await testDb.insert(schema.sceneVersions).values({ projectId: project.id, projectVersionId: version.id, originalSceneId: scene.id, sceneIndex: 1, duration: 5, generationPrompt: "Delivered result", metadata: { analysisProvider: "kie" } });
    await expect(releaseUnfulfilledCommercialAnalysis({ reservationId: reservation.id, actorId: "admin-test", evidence: "Checked the complete delivery record" })).rejects.toThrow("DELIVERED_SCENE_EXISTS");
    expect((await testDb.select().from(schema.commercialReservations).where(eq(schema.commercialReservations.id, reservation.id)))[0].state).toBe("held");
    expect(await balance()).toMatchObject({ credits: 196, heldCredits: 4 });
  });
  it("keeps a saved automatic split held when the checkpoint omits delivery", async () => {
    await grant();
    const [project] = await testDb.insert(schema.projects).values({ userId, title: "Saved split", status: "analyzing" }).returning();
    const [task] = await testDb.insert(schema.commercialTasks).values({ userId, kind: "analysis", state: "review", input: { projectId: project.id, pricing: { automaticSplit: true } }, credits: 4, result: { review: {}, successfulSceneIds: [] }, expiresAt: new Date(Date.now() + 600_000) }).returning();
    const { reservation } = await reserveCommercialTask({ userId, taskKey: `commercial:${task.id}`, credits: 4, rewrites: 0, quote: {} });
    await client.query("UPDATE commercial_reservations SET created_at = now() - interval '25 hours' WHERE id = $1", [reservation.id]);
    await testDb.insert(schema.projectVersions).values({ projectId: project.id, versionNumber: 0, label: "Original" });
    await expect(releaseUnfulfilledCommercialAnalysis({ reservationId: reservation.id, actorId: "admin-test", evidence: "Checked the complete delivery record" })).rejects.toThrow("DELIVERED_SPLIT_EXISTS");
    expect((await testDb.select().from(schema.commercialReservations).where(eq(schema.commercialReservations.id, reservation.id)))[0].state).toBe("held");
  });
  it("edits a pending ticket without another wallet hold and rejects edits by other users or after review", async () => {
    const row = await paidOrder();
    const request = await requestCommercialRefund(userId, row.id, "Unused", "old-contact");
    const before = await balance();
    const updated = await updateCommercialRefundRequest(userId, row.id, " Changed reason ", " new-contact ");
    expect(updated).toMatchObject({ id: request.id, state: "requested", reason: "Changed reason", evidence: { contact: "new-contact" } });
    expect(await balance()).toEqual(before);
    expect(await testDb.select().from(schema.commercialRefunds)).toHaveLength(1);
    await expect(updateCommercialRefundRequest("00000000-0000-4000-8000-000000000000", row.id, "Other user", "contact")).rejects.toThrow("ORDER_NOT_FOUND");
    await reviewCommercialRefund(userId, request.id, "reject", "Customer contacted and reviewed");
    await expect(updateCommercialRefundRequest(userId, row.id, "New reason", "contact")).rejects.toThrow("REFUND_ALREADY_REVIEWED");
    expect(refundAlipayTrade).not.toHaveBeenCalled();
  });

  it("requires purchased available credits before splitting local uploads", async () => {
    vi.stubEnv("COMMERCIAL_CONSUMPTION_ENABLED", "true");
    const [project] = await testDb.insert(schema.projects).values({ userId, title: "Upload boundary" }).returning();
    const input = { projectId: project.id, mediaUrl: "https://example.com/local.mp4", mediaName: "local", automaticSplit: false };
    await expect(prepareCommercialAnalysis(userId, { ...input, automaticSplit: true })).rejects.toThrow("SPLIT_PAYMENT_REQUIRED");
    expect(commercialMediaRequest).not.toHaveBeenCalled();
    vi.mocked(isOwnedLinkedVideo).mockResolvedValueOnce(true);
    await expect(prepareCommercialAnalysis(userId, input)).rejects.toThrow("INVALID_ANALYSIS_SOURCE_MODE");
    expect(analyzeSceneBlueprint).not.toHaveBeenCalled();
  });

  it("allows long local uploads without splitting or purchased credits", async () => {
    vi.stubEnv("COMMERCIAL_CONSUMPTION_ENABLED", "true");
    const [project] = await testDb.insert(schema.projects).values({ userId, title: "Whole upload" }).returning();
    vi.mocked(commercialMediaRequest).mockResolvedValueOnce({ sourceHash: "a".repeat(64), durationUs: 60_000_000, bytes: 500, scenes: [{ id: "1", startUs: 0, endUs: 60_000_000 }] });
    const preparation = await prepareCommercialAnalysis(userId, { projectId: project.id, mediaUrl: "https://example.com/local.mp4", mediaName: "local", automaticSplit: false });
    expect(preparation.durationUs).toBe(60_000_000);
    expect(preparation.scenes).toHaveLength(1);
    vi.mocked(getUserKieApiKey).mockResolvedValue("own-test-key");
    const quote = await quoteCommercialAnalysis(userId, { preparationId: preparation.id, sceneIds: ["1"], payer: "byok", model: "flash", outputLanguage: "zh" });
    expect(quote).toMatchObject({ splitCredits: 0, analysisCredits: 0, credits: 0 });
    await confirmCommercialTask(userId, quote.id);
    expect(await balance()).toMatchObject({ credits: 0, heldCredits: 0 });
    expect(analyzeSceneBlueprint).not.toHaveBeenCalled();
  });

  it("splits paid local uploads and quotes only the selected shots", async () => {
    await grant();
    vi.stubEnv("COMMERCIAL_CONSUMPTION_ENABLED", "true");
    vi.stubEnv("KIE_AI_API_KEY", "platform-test-key");
    const [project] = await testDb.insert(schema.projects).values({ userId, title: "Split upload" }).returning();
    const scenes = Array.from({ length: 6 }, (_, i) => ({ id: String(i + 1), startUs: i * 10_000_000, endUs: (i + 1) * 10_000_000 }));
    vi.mocked(commercialMediaRequest).mockResolvedValueOnce({ sourceHash: "a".repeat(64), durationUs: 60_000_000, bytes: 500, scenes });
    const preparation = await prepareCommercialAnalysis(userId, { projectId: project.id, mediaUrl: "https://example.com/local.mp4", mediaName: "local", automaticSplit: true });
    expect(preparation.scenes).toHaveLength(6);
    expect(commercialMediaRequest).toHaveBeenCalledWith("https://example.com/local.mp4", { mode: "preview", automaticSplit: true });
    const quote = await quoteCommercialAnalysis(userId, { preparationId: preparation.id, sceneIds: ["2"], payer: "platform", model: "flash", outputLanguage: "zh" });
    expect(quote).toMatchObject({ splitCredits: 10, analysisCredits: 5, credits: 15, sceneCount: 1 });
    expect(analyzeSceneBlueprint).not.toHaveBeenCalled();
  });

  it("allows long linked video splitting without the local upload duration limit", async () => {
    await grant();
    vi.stubEnv("COMMERCIAL_CONSUMPTION_ENABLED", "true");
    const [project] = await testDb.insert(schema.projects).values({ userId, title: "Long link" }).returning();
    vi.mocked(isOwnedLinkedVideo).mockResolvedValueOnce(true);
    const scenes = Array.from({ length: 30 }, (_, i) => ({ id: String(i + 1), startUs: i * 6_000_000, endUs: (i + 1) * 6_000_000 }));
    vi.mocked(commercialMediaRequest).mockResolvedValueOnce({ sourceHash: "a".repeat(64), durationUs: 180_000_000, bytes: 500, metadata: {}, scenes });
    const preparation = await prepareCommercialAnalysis(userId, { projectId: project.id, mediaUrl: "https://example.com/linked.mp4", mediaName: "linked", automaticSplit: true });
    expect(preparation.scenes).toHaveLength(30);
    expect(preparation.durationUs).toBe(180_000_000);
  });
  it("refunds an untouched purchase once and never re-submits the gateway request", async () => {
    const row = await paidOrder();
    vi.mocked(refundAlipayTrade).mockImplementationOnce(async () => {
      expect(await balance()).toMatchObject({ credits: 0, rewrites: 0 });
      return { code: "10000", outTradeNo: row.providerOrderId, refundFee: "19.90", fundChange: "Y" } as never;
    });
    const request = await requestCommercialRefund(userId, row.id, "Unused", "customer-wechat");
    expect(request.state).toBe("requested");
    expect(refundAlipayTrade).not.toHaveBeenCalled();
    expect((await requestCommercialRefund(userId, row.id, "Unused")).id).toBe(request.id);
    const approved = await reviewCommercialRefund(userId, request.id, "approve", "Contacted customer and verified untouched package");
    expect(approved.state).toBe("succeeded");
    expect(approved.evidence).toMatchObject({ contact: "customer-wechat", actorId: userId, decision: "approve" });
    await expect(reviewCommercialRefund(userId, request.id, "approve", "Contacted customer and verified untouched package")).rejects.toThrow("REFUND_ALREADY_REVIEWED");
    expect((await requestCommercialRefund(userId, row.id, "Unused")).state).toBe("succeeded");
    expect(refundAlipayTrade).toHaveBeenCalledTimes(1);
    expect(await balance()).toMatchObject({ credits: 0, rewrites: 0 });
  });
  it.each([
    { outTradeNo: "another-order" }, { outRequestNo: "another-refund" },
    { refundAmount: "0.01" }, { refundAmount: undefined }, { outRequestNo: undefined },
  ])("rejects a successful refund query with mismatched identity or amount: %j", async (override) => {
    const row = await paidOrder();
    const request = await requestCommercialRefund(userId, row.id, "Unused");
    vi.mocked(refundAlipayTrade).mockResolvedValue({ code: "10000", outTradeNo: row.providerOrderId, refundFee: "19.90", fundChange: "N" } as never);
    vi.mocked(queryAlipayRefund).mockResolvedValue({ code: "10000", outTradeNo: row.providerOrderId, outRequestNo: request.id, refundAmount: "19.90", refundStatus: "REFUND_SUCCESS", ...override } as never);
    expect((await reviewCommercialRefund(userId, request.id, "approve", "Contacted customer and approved full refund")).state).toBe("review");
    expect((await reconcileCommercialRefund(userId, request.id)).state).toBe("review");
    expect((await testDb.select().from(schema.paymentOrders))[0].status).toBe("paid");
    expect((await testDb.select().from(schema.commercialLots))[0].state).toBe("refunding");
    expect(await balance()).toMatchObject({ credits: 0, rewrites: 0 });
    expect(refundAlipayTrade).toHaveBeenCalledTimes(1);
  });
  it("recovers a timed-out refund by query only, preserving approval evidence and idempotency", async () => {
    const row = await paidOrder();
    const request = await requestCommercialRefund(userId, row.id, "Unused", "customer-wechat");
    vi.mocked(refundAlipayTrade).mockRejectedValue(new Error("timeout"));
    await reviewCommercialRefund(userId, request.id, "approve", "Contacted customer and approved full refund");
    vi.mocked(queryAlipayRefund).mockResolvedValue({ code: "10000", out_trade_no: row.providerOrderId, out_request_no: request.id, refund_amount: "19.90", refund_status: "REFUND_SUCCESS" } as never);
    const result = await reconcileCommercialRefund("admin-recovery", request.id);
    expect(result.state).toBe("succeeded");
    expect(result.evidence).toMatchObject({ contact: "customer-wechat", actorId: userId, decision: "approve", lastReconciliation: { actorId: "admin-recovery" } });
    expect((await reconcileCommercialRefund("admin-recovery", request.id)).state).toBe("succeeded");
    expect(queryAlipayRefund).toHaveBeenCalledTimes(1);
    expect(queryAlipayRefund).toHaveBeenCalledWith(row.providerOrderId, request.id);
    expect(refundAlipayTrade).toHaveBeenCalledTimes(1);
    expect((await testDb.select().from(schema.paymentOrders))[0].status).toBe("refunded");
    expect((await testDb.select().from(schema.commercialLots))[0].state).toBe("refunded");
    expect(await balance()).toMatchObject({ credits: 0, rewrites: 0 });
  });
  it.each(["pending", "missing", "invalid-signature"])("retains paused benefits for an unconfirmed refund query: %s", async (outcome) => {
    const row = await paidOrder();
    const request = await requestCommercialRefund(userId, row.id, "Unused");
    vi.mocked(refundAlipayTrade).mockRejectedValue(new Error("timeout"));
    await reviewCommercialRefund(userId, request.id, "approve", "Contacted customer and approved full refund");
    if (outcome === "invalid-signature") vi.mocked(queryAlipayRefund).mockRejectedValue(new Error("invalid response signature"));
    else vi.mocked(queryAlipayRefund).mockResolvedValue(outcome === "missing" ? { code: "40004" } as never : { code: "10000", outTradeNo: row.providerOrderId, outRequestNo: request.id, refundAmount: "19.90" } as never);
    expect((await reconcileCommercialRefund(userId, request.id)).state).toBe("review");
    expect((await testDb.select().from(schema.paymentOrders))[0].status).toBe("paid");
    expect(await balance()).toMatchObject({ credits: 0, rewrites: 0 });
    expect(refundAlipayTrade).toHaveBeenCalledTimes(1);
  });
  it("does not query unapproved or declined requests", async () => {
    const row = await paidOrder();
    const request = await requestCommercialRefund(userId, row.id, "Unused");
    await expect(reconcileCommercialRefund(userId, request.id)).rejects.toThrow("REFUND_NOT_APPROVED");
    await reviewCommercialRefund(userId, request.id, "reject", "Customer contacted; declined with explanation");
    await expect(reconcileCommercialRefund(userId, request.id)).rejects.toThrow("REFUND_NOT_APPROVED");
    expect(queryAlipayRefund).not.toHaveBeenCalled();
    expect(refundAlipayTrade).not.toHaveBeenCalled();
    expect(await balance()).toMatchObject({ credits: 200, rewrites: 20 });
  });
  it("recovers processing after a crash and never regresses success under competing queries", async () => {
    const row = await paidOrder();
    const request = await requestCommercialRefund(userId, row.id, "Unused");
    await testDb.update(schema.commercialRefunds).set({ state: "processing", evidence: { decision: "approve", actorId: userId } }).where(eq(schema.commercialRefunds.id, request.id));
    vi.mocked(queryAlipayRefund).mockResolvedValueOnce({ code: "10000", outTradeNo: row.providerOrderId, outRequestNo: request.id, refundAmount: "19.90", refundStatus: "REFUND_SUCCESS" } as never).mockRejectedValueOnce(new Error("timeout"));
    const results = await Promise.all([1, 2].map(() => reconcileCommercialRefund(userId, request.id)));
    expect(results.every((r) => r.state === "succeeded")).toBe(true);
    expect(refundAlipayTrade).not.toHaveBeenCalled();
    expect((await testDb.select().from(schema.paymentOrders))[0].status).toBe("refunded");
    expect(await balance()).toMatchObject({ credits: 0, rewrites: 0 });
  });
  it.each(["v6_creator_650", "v6_volume_1500"])("rejects direct checkout for unopened package %s before inserting an order", async (packageId) => {
    await expect(createAlipayCreditCheckout(userId, packageId, randomUUID())).rejects.toThrow("PACKAGE_NOT_OPEN");
    expect(await testDb.select().from(schema.paymentOrders)).toHaveLength(0);
  });
  it("uses saved checkout price and benefits when replaying an old purchase request", async () => {
    vi.stubEnv("ALIPAY_APP_ID", "test-app");
    vi.stubEnv("ALIPAY_PRIVATE_KEY", "mock-private-key");
    vi.stubEnv("ALIPAY_PUBLIC_KEY", "mock-public-key");
    const requestId = randomUUID();
    const first = await createAlipayCreditCheckout(userId, "v6_trial_200", requestId);
    await testDb.update(schema.paymentOrders).set({ amountCents: 1990, credits: 180, metadata: { rewrites: 12 } }).where(eq(schema.paymentOrders.id, first.orderId));
    expect(await createAlipayCreditCheckout(userId, "v6_trial_200", requestId)).toMatchObject({ orderId: first.orderId, amountCents: 1990, credits: 180, rewrites: 12 });
  });
  it("counts an included rewrite as package usage for cash refunds", async () => {
    const row = await paidOrder();
    await reserveCommercialTask({ userId, taskKey: "rewrite:refund-test", credits: 0, rewrites: 1, quote: {} });
    await expect(requestCommercialRefund(userId, row.id, "Unused")).rejects.toThrow("PACKAGE_USED_OR_RESERVED");
    await settleCommercialTask({ userId, taskKey: "rewrite:refund-test", credits: 0, rewrites: 1 });
    await expect(requestCommercialRefund(userId, row.id, "Unused")).rejects.toThrow("PACKAGE_USED_OR_RESERVED");
  });
  it("counts a zero-credit import attempt as usage for that purchase's refund", async () => {
    const row = await paidOrder();
    const input = { userId, taskKey: "link-import:refund", credits: 0, rewrites: 0, quote: { kind: "link_import", pricingVersion: LINK_IMPORT_PRICING_VERSION } };
    await reserveCommercialTask(input);
    await settleCommercialTask({ ...input, linkImportDelivered: true });
    await expect(requestCommercialRefund(userId, row.id, "Unused")).rejects.toThrow("PACKAGE_USED_OR_RESERVED");
    expect(refundAlipayTrade).not.toHaveBeenCalled();
    expect(await balance()).toMatchObject({ credits: 200, rewrites: 20 });
  });
  it("allows an otherwise unused package refund after a failed import", async () => {
    const row = await paidOrder();
    const input = { userId, taskKey: "link-import:refund-failure", credits: 0, rewrites: 0, quote: { kind: "link_import", pricingVersion: LINK_IMPORT_PRICING_VERSION } };
    await reserveCommercialTask(input);
    await settleCommercialTask(input);
    vi.mocked(refundAlipayTrade).mockResolvedValue({ code: "10000", outTradeNo: row.providerOrderId, refundFee: "19.90", fundChange: "Y" } as never);
    const request = await requestCommercialRefund(userId, row.id, "Unused");
    expect(refundAlipayTrade).not.toHaveBeenCalled();
    expect((await reviewCommercialRefund(userId, request.id, "approve", "Contacted customer and verified failed import")).state).toBe("succeeded");
  });
  it("keeps an uncertain refund frozen for manual review", async () => {
    const row = await paidOrder();
    vi.mocked(refundAlipayTrade).mockRejectedValueOnce(new Error("timeout"));
    const request = await requestCommercialRefund(userId, row.id, "Unused");
    expect((await reviewCommercialRefund(userId, request.id, "approve", "Contacted customer and approved full refund")).state).toBe("review");
    await expect(reviewCommercialRefund(userId, request.id, "approve", "Contacted customer and approved full refund")).rejects.toThrow("REFUND_ALREADY_REVIEWED");
    expect(refundAlipayTrade).toHaveBeenCalledTimes(1);
    expect(await balance()).toMatchObject({ credits: 0, rewrites: 0 });
  });
  it("restores package benefits once when support declines, without calling Alipay", async () => {
    const row = await paidOrder();
    const request = await requestCommercialRefund(userId, row.id, "Unused");
    expect(await balance()).toMatchObject({ credits: 0, rewrites: 0 });
    expect((await reviewCommercialRefund(userId, request.id, "reject", "Customer contacted; declined with explanation")).state).toBe("failed");
    expect(await balance()).toMatchObject({ credits: 200, rewrites: 20 });
    expect((await getIncludedLinkImportUsage(userId)).remaining).toBe(12);
    await expect(reviewCommercialRefund(userId, request.id, "reject", "Customer contacted; declined with explanation")).rejects.toThrow("REFUND_ALREADY_REVIEWED");
    expect(await balance()).toMatchObject({ credits: 200, rewrites: 20 });
    expect(refundAlipayTrade).not.toHaveBeenCalled();
  });
  it("sends one gateway refund for concurrent admin approvals", async () => {
    const row = await paidOrder();
    const request = await requestCommercialRefund(userId, row.id, "Unused");
    vi.mocked(refundAlipayTrade).mockResolvedValue({ code: "10000", outTradeNo: row.providerOrderId, refundFee: "19.90", fundChange: "Y" } as never);
    const results = await Promise.allSettled([1, 2].map(() => reviewCommercialRefund(userId, request.id, "approve", "Customer contacted and full refund approved")));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(refundAlipayTrade).toHaveBeenCalledTimes(1);
  });
  it("settles only authenticated, amount-matched query responses and throttles duplicate polls", async () => {
    const row = await order();
    vi.mocked(queryAlipayTrade).mockResolvedValue({ code: "10000", outTradeNo: row.providerOrderId, tradeNo: "provider-trade", tradeStatus: "TRADE_SUCCESS", totalAmount: "19.90" } as never);
    await reconcileAlipayOrder(row.id, randomUUID());
    expect(queryAlipayTrade).not.toHaveBeenCalled();
    await reconcileAlipayOrder(row.id, userId);
    await reconcileAlipayOrder(row.id, userId);
    expect(queryAlipayTrade).toHaveBeenCalledTimes(1);
    expect(await balance()).toMatchObject({ credits: 200, rewrites: 20 });
  });
  it("recovers from failed verification and grants the paid order exactly once", async () => {
    const row = await order();
    vi.mocked(queryAlipayTrade).mockRejectedValueOnce(new Error("验签失败，sign: private"));
    await reconcileAlipayOrder(row.id, userId);
    let current = (await testDb.select().from(schema.paymentOrders))[0];
    expect(current.status).toBe("pending");
    expect(current.metadata).toMatchObject({ queryError: "ALIPAY_SIGNATURE_INVALID" });
    expect(await testDb.select().from(schema.commercialWallets)).toHaveLength(0);
    await testDb.update(schema.paymentOrders).set({ metadata: { ...(current.metadata as object), queryAfter: 0 } }).where(eq(schema.paymentOrders.id, row.id));
    vi.mocked(queryAlipayTrade).mockResolvedValue({ code: "10000", outTradeNo: row.providerOrderId, tradeNo: "verified-trade", tradeStatus: "TRADE_SUCCESS", totalAmount: "19.90" } as never);
    await reconcileAlipayOrder(row.id, userId);
    await reconcileAlipayOrder(row.id, userId);
    current = (await testDb.select().from(schema.paymentOrders))[0];
    expect(current.status).toBe("paid");
    expect(current.metadata).toMatchObject({ queryError: null, reconciliation: "confirmed" });
    expect(await balance()).toMatchObject({ credits: 200, rewrites: 20 });
    expect(closeAlipayTrade).not.toHaveBeenCalled();
  });
  it("cancels an unpaid order only after Alipay confirms closure", async () => {
    const row = await order();
    vi.mocked(queryAlipayTrade).mockResolvedValue({ code: "10000", outTradeNo: row.providerOrderId, tradeStatus: "WAIT_BUYER_PAY", totalAmount: "19.90" } as never);
    vi.mocked(closeAlipayTrade).mockResolvedValue({ code: "10000" } as never);
    await reconcileAlipayOrder(row.id, userId, true);
    expect(closeAlipayTrade).toHaveBeenCalledWith(row.providerOrderId);
    expect((await testDb.select().from(schema.paymentOrders))[0].status).toBe("cancelled");
    expect(await testDb.select().from(schema.commercialWallets)).toHaveLength(0);
    await reconcileAlipayOrder(row.id, userId, true);
    expect(closeAlipayTrade).toHaveBeenCalledTimes(1);
  });
  it("expires at 15 minutes without closing younger unpaid orders", async () => {
    const row = await order();
    const now = Date.now();
    await testDb.update(schema.paymentOrders).set({ createdAt: new Date(now - 14 * 60000) }).where(eq(schema.paymentOrders.id, row.id));
    vi.mocked(queryAlipayTrade).mockResolvedValue({ code: "10000", outTradeNo: row.providerOrderId, tradeStatus: "WAIT_BUYER_PAY", totalAmount: "19.90" } as never);
    vi.mocked(closeAlipayTrade).mockResolvedValue({ code: "10000" } as never);
    await reconcileAlipayOrder(row.id, userId);
    expect(closeAlipayTrade).not.toHaveBeenCalled();
    await testDb.update(schema.paymentOrders).set({ createdAt: new Date(now - 15 * 60000), metadata: { ...(row.metadata as object), queryAfter: 0 } }).where(eq(schema.paymentOrders.id, row.id));
    await reconcileAlipayOrder(row.id, userId);
    expect((await testDb.select().from(schema.paymentOrders))[0].status).toBe("cancelled");
  });
  it("reconciles a paid order instead of cancelling at its deadline", async () => {
    const row = await order();
    await testDb.update(schema.paymentOrders).set({ createdAt: new Date(Date.now() - 16 * 60000) }).where(eq(schema.paymentOrders.id, row.id));
    vi.mocked(queryAlipayTrade).mockResolvedValue({ code: "10000", outTradeNo: row.providerOrderId, tradeNo: "provider-trade", tradeStatus: "TRADE_SUCCESS", totalAmount: "19.90" } as never);
    await reconcileAlipayOrder(row.id, userId, true);
    expect((await testDb.select().from(schema.paymentOrders))[0].status).toBe("paid");
    expect(await balance()).toMatchObject({ credits: 200, rewrites: 20 });
    expect(closeAlipayTrade).not.toHaveBeenCalled();
  });
  it("keeps a cancellation pending when the close result is unknown", async () => {
    const row = await order();
    vi.mocked(queryAlipayTrade).mockResolvedValue({ code: "10000", outTradeNo: row.providerOrderId, tradeStatus: "WAIT_BUYER_PAY", totalAmount: "19.90" } as never);
    vi.mocked(closeAlipayTrade).mockRejectedValue(new Error("timeout"));
    await reconcileAlipayOrder(row.id, userId, true);
    const current = (await testDb.select().from(schema.paymentOrders))[0];
    expect(current.status).toBe("pending");
    expect(current.metadata).toMatchObject({ cancellationRequested: true, reconciliation: "query_unconfirmed" });
    expect(await testDb.select().from(schema.commercialWallets)).toHaveLength(0);
  });
  it("does not cancel a missing trade while an issued form is still payable", async () => {
    const row = await order();
    await testDb.update(schema.paymentOrders).set({ metadata: { ...(row.metadata as object), expiryVersion: ALIPAY_EXPIRY_VERSION, paymentFormIssuedAt: new Date().toISOString() } }).where(eq(schema.paymentOrders.id, row.id));
    vi.mocked(queryAlipayTrade).mockResolvedValue({ code: "40004", subCode: "ACQ.TRADE_NOT_EXIST" } as never);
    await reconcileAlipayOrder(row.id, userId, true);
    expect((await testDb.select().from(schema.paymentOrders))[0].status).toBe("pending");
    await testDb.update(schema.paymentOrders).set({ createdAt: new Date(Date.now() - 16 * 60000), metadata: { ...(row.metadata as object), expiryVersion: ALIPAY_EXPIRY_VERSION, paymentFormIssuedAt: new Date().toISOString(), queryAfter: 0 } }).where(eq(schema.paymentOrders.id, row.id));
    await reconcileAlipayOrder(row.id, userId);
    expect((await testDb.select().from(schema.paymentOrders))[0].status).toBe("cancelled");
  });
  it("does not close someone else's order or an unverified trade", async () => {
    const row = await order();
    await reconcileAlipayOrder(row.id, randomUUID(), true);
    expect(queryAlipayTrade).not.toHaveBeenCalled();
    vi.mocked(queryAlipayTrade).mockResolvedValue({ code: "10000", outTradeNo: "wrong-order", tradeStatus: "WAIT_BUYER_PAY", totalAmount: "19.90" } as never);
    await reconcileAlipayOrder(row.id, userId, true);
    expect(closeAlipayTrade).not.toHaveBeenCalled();
    expect((await testDb.select().from(schema.paymentOrders))[0].status).toBe("pending");
  });
  it("does not settle a mismatched Alipay query result", async () => {
    const row = await order();
    vi.mocked(queryAlipayTrade).mockResolvedValue({ code: "10000", outTradeNo: row.providerOrderId, tradeNo: "provider-trade", tradeStatus: "TRADE_SUCCESS", totalAmount: "1.00" } as never);
    await reconcileAlipayOrder(row.id, userId);
    expect((await testDb.select().from(schema.paymentOrders))[0].status).toBe("pending");
    expect(await testDb.select().from(schema.commercialWallets)).toHaveLength(0);
  });
  it("saves exactly one rewritten version and consumes one allowance on replay", async () => {
    await grant();
    const input = await rewriteInput();
    const first = await rewriteSceneVersion(input);
    const replay = await rewriteSceneVersion(input);
    expect(first.id).toBe(replay.id);
    expect(rewriteSceneBlueprint).toHaveBeenCalledTimes(1);
    expect(await balance()).toMatchObject({ credits: 200, rewrites: 19, heldRewrites: 0 });
    expect(await testDb.select().from(schema.sceneVersions)).toHaveLength(2);
  });
  it("releases the allowance on model failure without saving a version", async () => {
    await grant();
    const input = await rewriteInput();
    vi.mocked(rewriteSceneBlueprint).mockRejectedValue(new Error("Model failure"));
    await expect(rewriteSceneVersion(input)).rejects.toThrow("REWRITE_PROVIDER_FAILED");
    expect(await balance()).toMatchObject({ rewrites: 20, heldRewrites: 0 });
    expect(await testDb.select().from(schema.sceneVersions)).toHaveLength(1);
    await expect(rewriteSceneVersion(input)).rejects.toThrow("REWRITE_PREVIOUSLY_FAILED");
    expect(rewriteSceneBlueprint).toHaveBeenCalledTimes(1);
  });
  it("never invokes a model when the user lacks allowance or project ownership", async () => {
    const input = await rewriteInput();
    await expect(rewriteSceneVersion(input)).rejects.toThrow("INSUFFICIENT_COMMERCIAL_BALANCE");
    await expect(rewriteSceneVersion({ ...input, userId: randomUUID() })).rejects.toThrow("Project not found");
    expect(rewriteSceneBlueprint).not.toHaveBeenCalled();
  });
  it("rolls back the new version if billing settlement cannot commit", async () => {
    await grant();
    const input = await rewriteInput();
    await client.exec("CREATE FUNCTION reject_settlement() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_key LIKE 'settle:%' THEN RAISE EXCEPTION 'simulated billing failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_settlement BEFORE INSERT ON commercial_ledger FOR EACH ROW EXECUTE FUNCTION reject_settlement();");
    try {
      await expect(rewriteSceneVersion(input)).rejects.toMatchObject({ cause: expect.objectContaining({ message: "simulated billing failure" }) });
      expect(await testDb.select().from(schema.sceneVersions)).toHaveLength(1);
      expect(await balance()).toMatchObject({ rewrites: 19, heldRewrites: 1 });
    } finally {
      await client.exec("DROP TRIGGER reject_settlement ON commercial_ledger; DROP FUNCTION reject_settlement();");
    }
  });
});
