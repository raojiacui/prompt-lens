import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@/lib/db/schema";

const isolated = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", async () => ({ ...await import("@/lib/db/schema"), get db() { return isolated.db; } }));
vi.mock("@/lib/workflow/scene-analysis", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/workflow/scene-analysis")>(), rewriteSceneBlueprint: vi.fn(), analyzeSceneBlueprint: vi.fn() }));
vi.mock("@/lib/billing/commercial-media", () => ({ assertOwnedUploadedVideo: vi.fn(async () => "owned-upload"), isOwnedLinkedVideo: vi.fn(async () => false), commercialMediaRequest: vi.fn() }));
vi.mock("@/lib/cloudflare/r2", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/cloudflare/r2")>(), copyR2Object: vi.fn(async () => "https://example.com/frozen-video.mp4") }));
vi.mock("@/lib/payments/alipay", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/payments/alipay")>(),
  queryAlipayTrade: vi.fn(),
  closeAlipayTrade: vi.fn(),
  refundAlipayTrade: vi.fn(),
  queryAlipayRefund: vi.fn(),
}));
import { rewriteSceneBlueprint, analyzeSceneBlueprint } from "@/lib/workflow/scene-analysis";
import { assertOwnedUploadedVideo, isOwnedLinkedVideo, commercialMediaRequest } from "@/lib/billing/commercial-media";
import { copyR2Object } from "@/lib/cloudflare/r2";
import { prepareCommercialAnalysis, quoteCommercialAnalysis, quoteCommercialAnalysisRetry, quotedAnalysisModel, recoverCommercialAnalysisTasks } from "@/lib/billing/commercial-analysis";
import { confirmCommercialTask, confirmCommercialTaskInTransaction, runCommercialTask } from "@/lib/billing/commercial-task-runner";
import { buildCommercialGenerationPayload, quoteCommercialGeneration, reconcileCommercialGeneration } from "@/lib/billing/commercial-generation";
import { rewriteSceneVersion } from "@/lib/workflow/service";
import { grantCommercialPurchase, reserveCommercialTask, settleCommercialTask, getIncludedLinkImportUsage } from "@/lib/billing/commercial-wallet";
import { LINK_IMPORT_PRICING_VERSION } from "@/lib/billing/link-import-pricing";
import { createAlipayCreditCheckout, settlePaidCreditOrder } from "@/lib/payments/credit-checkout";
import { PRICING_VERSION } from "@/lib/billing/pricing-v6";
import { reconcileCommercialRefund, requestCommercialRefund, updateCommercialRefundRequest, reviewCommercialRefund } from "@/lib/payments/commercial-refunds";
import { queryAlipayRefund, queryAlipayTrade, refundAlipayTrade, closeAlipayTrade } from "@/lib/payments/alipay";
import { ALIPAY_EXPIRY_VERSION } from "@/lib/payments/order-expiry";
import { eq } from "drizzle-orm";
import { reconcileAlipayOrder } from "@/lib/payments/alipay-reconciliation";

const client = new PGlite();
const testDb = drizzle(client, { schema });
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
    if (task.state !== "queued") return;
  }
  throw new Error("Task failed to reach a durable boundary");
}

describe("Commercial wallet transactions on isolated Postgres", () => {
  beforeAll(async () => {
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
    await client.query('INSERT INTO "user" (id) VALUES ($1)', [userId]);
  });
  beforeEach(async () => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.mocked(rewriteSceneBlueprint).mockReset();
    vi.mocked(analyzeSceneBlueprint).mockReset();
    vi.mocked(commercialMediaRequest).mockReset();
    vi.mocked(copyR2Object).mockClear();
    await client.exec("TRUNCATE media_cleanup_jobs");
    vi.mocked(queryAlipayTrade).mockReset();
    vi.mocked(closeAlipayTrade).mockReset();
    vi.mocked(refundAlipayTrade).mockReset();
    vi.mocked(queryAlipayRefund).mockReset();
    await client.exec("TRUNCATE projects CASCADE");
    await client.exec("TRUNCATE video_generation, commercial_tasks, commercial_refunds, commercial_allocations, commercial_lots, commercial_ledger, commercial_reservations, commercial_wallets, payment_orders, credit_ledger, user_credits CASCADE");
  });
  afterAll(async () => { await client.close(); });

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
    expect(buildCommercialGenerationPayload({ ...body, duration: 0, model: "kling-omni-transform" }, 5)).toMatchObject({ model: "kling-3.0-omni/transformation", input: { video_urls: [body.referenceVideoUrl], duration: "5" } });
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
  it.each(["success", "fail"] as const)("submits paid Veo to its verified endpoint and settles %s once", async (state) => {
    await grant();
    vi.stubEnv("COMMERCIAL_CONSUMPTION_ENABLED", "true");
    vi.stubEnv("KIE_API_KEY", "test-key");
    const quote = await quoteCommercialGeneration(userId, { model: "veo-lite", userPrompt: "A cinematic cloud palace", duration: 8, quality: "1080p", aspectRatio: "9:16" });
    expect(quote).toMatchObject({ credits: 20, model: "veo3_lite", duration: 8, resolution: "1080p" });
    await expect(confirmCommercialTask(randomUUID(), quote.id)).rejects.toThrow("TASK_NOT_FOUND");
    await confirmCommercialTask(userId, quote.id);
    await confirmCommercialTask(userId, quote.id);
    expect(await balance()).toMatchObject({ credits: 180, heldCredits: 20 });
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
    expect(await balance()).toMatchObject({ credits: state === "success" ? 180 : 200, heldCredits: 0 });
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
    expect(quote).toMatchObject({ credits: 115, referenceVideoSeconds: 5, duration: 10 });
    expect(assertOwnedUploadedVideo).toHaveBeenCalledWith(userId, "https://example.com/video.mp4");
    expect(copyR2Object).toHaveBeenCalledWith("owned-upload", expect.stringContaining(`generation-input/${userId}/`));
    expect(commercialMediaRequest).toHaveBeenCalledWith("https://example.com/frozen-video.mp4", { mode: "preview", automaticSplit: false });
    expect(await testDb.select().from(schema.mediaCleanupJobs)).toHaveLength(1);
    await confirmCommercialTask(userId, quote.id);
    await confirmCommercialTask(userId, quote.id);
    expect(await balance()).toMatchObject({ credits: 535, heldCredits: 115 });
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ code: 200, data: { taskId: "reference-task" } }))).mockResolvedValueOnce(new Response(JSON.stringify({ code: 200, data: { taskId: "reference-task", state, resultJson: JSON.stringify({ resultUrls: ["https://example.com/output.mp4"] }) } })));
    vi.stubGlobal("fetch", fetchMock);
    await runCommercialTask(quote.id);
    await runCommercialTask(quote.id);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ model: "bytedance/seedance-2-fast", input: { duration: 10, reference_video_urls: ["https://example.com/frozen-video.mp4"] } });
    await reconcileCommercialGeneration(quote.id);
    await reconcileCommercialGeneration(quote.id);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await balance()).toMatchObject({ credits: state === "success" ? 535 : 650, heldCredits: 0 });
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
    return { userId, projectId: project.id, sceneVersionId: original.id, instruction: "Change the main character", modelId: "analysis-gemini-2-5-pro", modelMode: "manual" as const, rewriteKeySource: "platform" as const, allowPlatformKeyForRewrite: true, commercialTaskKey: "rewrite:test" };
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
  it("runs generation quote, durable submission, and settlement without re-debiting callbacks", async () => {
    await grant();
    vi.stubEnv("COMMERCIAL_CONSUMPTION_ENABLED", "true");
    vi.stubEnv("KIE_AI_API_KEY", "platform-test-key");
    const quote = await quoteCommercialGeneration(userId, { userPrompt: "A new cinematic scene", model: "wan/2-6-text-to-video", duration: 5, quality: "720p" });
    expect(quote.credits).toBe(40);
    await confirmCommercialTask(userId, quote.id);
    const fetchMock = vi.fn(async (_url: unknown, options?: RequestInit) => options?.method === "POST"
      ? Response.json({ code: 200, data: { taskId: "provider-task-1" } })
      : Response.json({ code: 200, data: { taskId: "provider-task-1", state: "success", resultJson: JSON.stringify({ resultUrls: ["https://example.com/result.mp4"] }) } }));
    vi.stubGlobal("fetch", fetchMock);
    await runCommercialTask(quote.id);
    await runCommercialTask(quote.id);
    expect(await balance()).toMatchObject({ credits: 160, heldCredits: 40 });
    await reconcileCommercialGeneration(quote.id);
    await reconcileCommercialGeneration(quote.id);
    expect(await balance()).toMatchObject({ credits: 160, heldCredits: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((await testDb.select().from(schema.videoGeneration))[0]).toMatchObject({ status: "completed", videoUrl: "https://example.com/result.mp4" });
  });

  it("snapshots the real analysis model without accepting a platform tier override", () => {
    expect(quotedAnalysisModel({ payer: "platform", model: "flash", modelId: "analysis-gemini-2-5-pro" })).toBe("gemini-3-8-flash-openai");
    expect(quotedAnalysisModel({ payer: "byok", model: "flash", modelId: "analysis-gemini-3-5-flash" })).toBe("gemini-3-5-flash-openai");
    expect(() => quotedAnalysisModel({ payer: "byok", model: "flash", modelId: "nonexistent" })).toThrow();
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
    await client.query("UPDATE commercial_tasks SET state = 'running', updated_at = now() - interval '7 minutes' WHERE id = $1", [quote.id]);
    await recoverCommercialAnalysisTasks();
    await recoverCommercialAnalysisTasks();
    expect(analyzeSceneBlueprint).not.toHaveBeenCalled();
    expect(await balance()).toMatchObject({ credits: 200, heldCredits: 0 });
    expect((await testDb.select().from(schema.sceneVersions))[0].generationPrompt).toBe("");
    expect((await testDb.select().from(schema.projects))[0].status).toBe("failed");
    expect((await quoteCommercialAnalysisRetry(userId, quote.id)).credits).toBe(quote.credits);
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
    const running = runCommercialTask(taskId);
    await entered;
    await client.query("UPDATE commercial_tasks SET updated_at = now() - interval '7 minutes' WHERE id = $1", [taskId]);
    await recoverCommercialAnalysisTasks();
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
    await grant(60, 20);
    vi.stubEnv("COMMERCIAL_CONSUMPTION_ENABLED", "true");
    vi.stubEnv("KIE_AI_API_KEY", "platform-test-key");
    const a = await quoteCommercialGeneration(userId, { userPrompt: "A cinematic scene", duration: 5, quality: "720p" });
    const b = await quoteCommercialGeneration(userId, { userPrompt: "Another scene", duration: 5, quality: "720p" });
    await expect(testDb.transaction(async (tx) => {
      await confirmCommercialTaskInTransaction(tx as unknown as Parameters<typeof confirmCommercialTaskInTransaction>[0], userId, a.id);
      await confirmCommercialTaskInTransaction(tx as unknown as Parameters<typeof confirmCommercialTaskInTransaction>[0], userId, b.id);
    })).rejects.toThrow("INSUFFICIENT_COMMERCIAL_BALANCE");
    expect(await balance()).toMatchObject({ credits: 60, heldCredits: 0 });
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
    expect(await balance()).toMatchObject({ credits: 160, heldCredits: 40 });
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

  it("rejects long local uploads and prevents switching the trusted source mode", async () => {
    vi.stubEnv("COMMERCIAL_CONSUMPTION_ENABLED", "true");
    const [project] = await testDb.insert(schema.projects).values({ userId, title: "Upload boundary" }).returning();
    const input = { projectId: project.id, mediaUrl: "https://example.com/local.mp4", mediaName: "local", automaticSplit: false };
    await expect(prepareCommercialAnalysis(userId, { ...input, automaticSplit: true })).rejects.toThrow("INVALID_ANALYSIS_SOURCE_MODE");
    vi.mocked(isOwnedLinkedVideo).mockResolvedValueOnce(true);
    await expect(prepareCommercialAnalysis(userId, input)).rejects.toThrow("INVALID_ANALYSIS_SOURCE_MODE");
    vi.mocked(commercialMediaRequest).mockResolvedValueOnce({ durationUs: 10_000_001 });
    await expect(prepareCommercialAnalysis(userId, input)).rejects.toThrow("UPLOAD_VIDEO_TOO_LONG");
    expect(analyzeSceneBlueprint).not.toHaveBeenCalled();
  });

  it("allows long linked video splitting without the local upload duration limit", async () => {
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
