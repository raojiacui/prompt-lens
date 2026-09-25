import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@/lib/db/schema";

const isolated = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", async () => ({ ...await import("@/lib/db/schema"), get db() { return isolated.db; } }));
vi.mock("@/lib/workflow/scene-analysis", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/workflow/scene-analysis")>(), rewriteSceneBlueprint: vi.fn(), analyzeSceneBlueprint: vi.fn() }));
vi.mock("@/lib/billing/commercial-media", () => ({ assertOwnedUploadedVideo: vi.fn(async () => "owned-upload"), commercialMediaRequest: vi.fn() }));
import { rewriteSceneBlueprint, analyzeSceneBlueprint } from "@/lib/workflow/scene-analysis";
import { commercialMediaRequest } from "@/lib/billing/commercial-media";
import { prepareCommercialAnalysis, quoteCommercialAnalysis, quoteCommercialAnalysisRetry } from "@/lib/billing/commercial-analysis";
import { confirmCommercialTask, confirmCommercialTaskInTransaction, runCommercialTask } from "@/lib/billing/commercial-task-runner";
import { buildCommercialGenerationPayload, quoteCommercialGeneration, reconcileCommercialGeneration } from "@/lib/billing/commercial-generation";
import { rewriteSceneVersion } from "@/lib/workflow/service";
import { grantCommercialPurchase, reserveCommercialTask, settleCommercialTask } from "@/lib/billing/commercial-wallet";
import { settlePaidCreditOrder, createXunhuPayCreditCheckout, getXunhuPaySecretForApp } from "@/lib/payments/credit-checkout";
import { createXunhuPayHash } from "@/lib/payments/xunhupay-signature";
import { PRICING_VERSION } from "@/lib/billing/pricing-v6";
import { requestCommercialRefund, applyCommercialRefundNotification } from "@/lib/payments/commercial-refunds";
import { reconcilePaymentOrder } from "@/lib/payments/xunhupay-reconciliation";

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
    await client.exec(readFileSync("drizzle/0010_commercial_wallets.sql", "utf8"));
    await client.exec(readFileSync("drizzle/0011_commercial_purchase_lots.sql", "utf8"));
    await client.exec(readFileSync("drizzle/0002_video_generation.sql", "utf8"));
    await client.exec(readFileSync("drizzle/0006_generation_workflow_links.sql", "utf8"));
    await client.exec(readFileSync("drizzle/0012_commercial_tasks.sql", "utf8"));
    await client.query('INSERT INTO "user" (id) VALUES ($1)', [userId]);
  });
  beforeEach(async () => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.mocked(rewriteSceneBlueprint).mockReset();
    vi.mocked(analyzeSceneBlueprint).mockReset();
    vi.mocked(commercialMediaRequest).mockReset();
    await client.exec("TRUNCATE projects CASCADE");
    await client.exec("TRUNCATE video_generation, commercial_tasks, commercial_refunds, commercial_allocations, commercial_lots, commercial_ledger, commercial_reservations, commercial_wallets, payment_orders, credit_ledger, user_credits CASCADE");
  });
  afterAll(async () => { await client.close(); });

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
    for (const override of [{ duration: 8 }, { quality: "1080p" }, { aspectRatio: "9:16" }, { model: "unverified-model" }, { referenceVideoUrl: "https://example.com/video.mp4" }, { hiddenReferenceImageUrl: "http://example.com/image.jpg" }]) expect(() => buildCommercialGenerationPayload({ ...input, ...override })).toThrow();
  });
  it("rejects another owner's or expired quotes before reserving funds", async () => {
    await grant(); vi.stubEnv("COMMERCIAL_CONSUMPTION_ENABLED", "true"); vi.stubEnv("KIE_API_KEY", "test-key");
    const quote = await quoteCommercialGeneration(userId, { userPrompt: "A cinematic cloud palace", duration: 5 });
    await expect(confirmCommercialTask(randomUUID(), quote.id)).rejects.toThrow("TASK_NOT_FOUND");
    await client.query("UPDATE commercial_tasks SET expires_at = now() - interval '1 minute' WHERE id = $1", [quote.id]);
    await expect(confirmCommercialTask(userId, quote.id)).rejects.toThrow("QUOTE_EXPIRED");
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
    const [row] = await testDb.insert(schema.paymentOrders).values({ userId, provider: "xunhupay", providerOrderId: randomUUID(), packageId: commercial ? "v6_trial_200" : "starter_10", packageName: "Test", credits: commercial ? 200 : 10, amountCents: 1990, currency: "cny", metadata: { appId: "ali", method: "alipay", pricingVersion: PRICING_VERSION, rewrites: 20 } }).returning();
    return row;
  }
  it("atomically marks the new order paid and grants both benefits once", async () => {
    const row = await order();
    const input = { provider: "xunhupay" as const, lookupOrderId: row.providerOrderId, rawPayload: { appid: "ali", total_fee: "19.90", status: "OD" } };
    const results = await Promise.all([settlePaidCreditOrder(input), settlePaidCreditOrder(input)]);
    expect(results.filter((result) => result.granted)).toHaveLength(1);
    expect(await balance()).toMatchObject({ credits: 200, rewrites: 20 });
    expect(await testDb.select().from(schema.userCredits)).toHaveLength(0);
    expect((await testDb.select().from(schema.paymentOrders))[0].status).toBe("paid");
  });
  it("retains legacy grants in the legacy wallet and prevents duplicate credits", async () => {
    const row = await order(false);
    const input = { provider: "xunhupay" as const, lookupOrderId: row.providerOrderId, rawPayload: { appid: "ali", total_fee: "19.90", status: "OD" } };
    await settlePaidCreditOrder(input);
    expect((await settlePaidCreditOrder(input)).granted).toBe(false);
    expect((await testDb.select().from(schema.userCredits))[0].balance).toBe(10);
    expect(await testDb.select().from(schema.commercialWallets)).toHaveLength(0);
  });
  it("never grants for an underpayment", async () => {
    const row = await order();
    await expect(settlePaidCreditOrder({ provider: "xunhupay", lookupOrderId: row.providerOrderId, rawPayload: { appid: "ali", total_fee: "1.00", status: "OD" } })).rejects.toThrow("amount mismatch");
    expect((await testDb.select().from(schema.paymentOrders))[0].status).toBe("pending");
    expect(await testDb.select().from(schema.commercialWallets)).toHaveLength(0);
  });
  it("persists an order before requesting a signed QR and separates QR from mobile link", async () => {
    vi.stubEnv("XUNHUPAY_ALIPAY_APP_ID", "ali");
    vi.stubEnv("XUNHUPAY_ALIPAY_APP_SECRET", "test-secret");
    vi.stubGlobal("fetch", vi.fn(async () => {
      expect(await testDb.select().from(schema.paymentOrders)).toHaveLength(1);
      const data = { errcode: 0, url_qrcode: "https://example.com/qr.png", url: "https://example.com/pay" };
      return Response.json({ ...data, hash: createXunhuPayHash(data, "test-secret") });
    }));
    const checkout = await createXunhuPayCreditCheckout(userId, "starter_10", "alipay");
    expect(checkout).toMatchObject({ qrImageUrl: "https://example.com/qr.png", mobilePaymentUrl: "https://example.com/pay" });
    expect(getXunhuPaySecretForApp("unknown")).toBe("");
  });

  it("snapshots the commercial package and reuses one checkout on duplicate submissions", async () => {
    vi.stubEnv("XUNHUPAY_ALIPAY_APP_ID", "ali");
    vi.stubEnv("XUNHUPAY_ALIPAY_APP_SECRET", "test-secret");
    const fetchMock = vi.fn(async () => {
      const data = { errcode: 0, url_qrcode: "https://example.com/qr.png", url: "https://example.com/pay" };
      return Response.json({ ...data, hash: createXunhuPayHash(data, "test-secret") });
    });
    vi.stubGlobal("fetch", fetchMock);
    const id = randomUUID();
    const first = await createXunhuPayCreditCheckout(userId, "v6_trial_200", "alipay", id);
    const second = await createXunhuPayCreditCheckout(userId, "v6_trial_200", "alipay", id);
    expect(first.orderId).toBe(second.orderId);
    expect(second.qrImageUrl).toBe("https://example.com/qr.png");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [saved] = await testDb.select().from(schema.paymentOrders);
    expect(saved).toMatchObject({ credits: 200, amountCents: 1990, metadata: { rewrites: 20, pricingVersion: PRICING_VERSION } });
    await expect(createXunhuPayCreditCheckout(userId, "v6_creator_650", "alipay", id)).rejects.toThrow("replay mismatch");
    await settlePaidCreditOrder({ provider: "xunhupay", lookupOrderId: saved.providerOrderId, rawPayload: { appid: "ali", total_fee: "19.90", status: "OD" } });
    expect(await balance()).toMatchObject({ credits: 200, rewrites: 20 });
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
    await settlePaidCreditOrder({ provider: "xunhupay", lookupOrderId: row.providerOrderId, rawPayload: { appid: "ali", total_fee: "19.90", status: "OD" } });
    vi.stubEnv("XUNHUPAY_ALIPAY_APP_ID", "ali");
    vi.stubEnv("XUNHUPAY_ALIPAY_APP_SECRET", "test-secret");
    return row;
  }
  it("runs paid analysis from server probe through partial settlement with no duplicate inference", async () => {
    await grant();
    vi.stubEnv("COMMERCIAL_CONSUMPTION_ENABLED", "true");
    vi.stubEnv("KIE_AI_API_KEY", "platform-test-key");
    const [project] = await testDb.insert(schema.projects).values({ userId, title: "Commercial analysis" }).returning();
    const intervals = [{ id: "1", startUs: 0, endUs: 2000000 }, { id: "2", startUs: 2000000, endUs: 10000000 }];
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
    expect(vi.mocked(analyzeSceneBlueprint).mock.calls[0][0]).toMatchObject({ analysisKeySource: "platform", forceFreeTrialKie: false });
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
    expect(quote.credits).toBe(95);
    await confirmCommercialTask(userId, quote.id);
    const fetchMock = vi.fn(async (_url: unknown, options?: RequestInit) => options?.method === "POST"
      ? Response.json({ code: 200, data: { taskId: "provider-task-1" } })
      : Response.json({ code: 200, data: { taskId: "provider-task-1", state: "success", resultJson: JSON.stringify({ resultUrls: ["https://example.com/result.mp4"] }) } }));
    vi.stubGlobal("fetch", fetchMock);
    await runCommercialTask(quote.id);
    await runCommercialTask(quote.id);
    expect(await balance()).toMatchObject({ credits: 105, heldCredits: 95 });
    await reconcileCommercialGeneration(quote.id);
    await reconcileCommercialGeneration(quote.id);
    expect(await balance()).toMatchObject({ credits: 105, heldCredits: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((await testDb.select().from(schema.videoGeneration))[0]).toMatchObject({ status: "completed", videoUrl: "https://example.com/result.mp4" });
  });
  it("reserves a multi-output batch atomically or starts none", async () => {
    await grant(100, 20);
    vi.stubEnv("COMMERCIAL_CONSUMPTION_ENABLED", "true");
    vi.stubEnv("KIE_AI_API_KEY", "platform-test-key");
    const a = await quoteCommercialGeneration(userId, { userPrompt: "A cinematic scene", duration: 5, quality: "720p" });
    const b = await quoteCommercialGeneration(userId, { userPrompt: "Another scene", duration: 5, quality: "720p" });
    await expect(testDb.transaction(async (tx) => {
      await confirmCommercialTaskInTransaction(tx as unknown as Parameters<typeof confirmCommercialTaskInTransaction>[0], userId, a.id);
      await confirmCommercialTaskInTransaction(tx as unknown as Parameters<typeof confirmCommercialTaskInTransaction>[0], userId, b.id);
    })).rejects.toThrow("INSUFFICIENT_COMMERCIAL_BALANCE");
    expect(await balance()).toMatchObject({ credits: 100, heldCredits: 0 });
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
    expect(await balance()).toMatchObject({ credits: 105, heldCredits: 95 });
  });
  it("refunds an untouched purchase once and never re-submits the gateway request", async () => {
    const row = await paidOrder();
    const fetchMock = vi.fn(async () => {
      expect(await balance()).toMatchObject({ credits: 0, rewrites: 0 });
      const data = { errcode: 0, trade_order_id: row.providerOrderId, refund_fee: "19.90", refund_status: "CD" };
      return Response.json({ ...data, hash: createXunhuPayHash(data, "test-secret") });
    });
    vi.stubGlobal("fetch", fetchMock);
    expect((await requestCommercialRefund(userId, row.id, "Unused")).state).toBe("succeeded");
    expect((await requestCommercialRefund(userId, row.id, "Unused")).state).toBe("succeeded");
    await applyCommercialRefundNotification({ appid: "ali", trade_order_id: row.providerOrderId, total_fee: "19.90", status: "CD" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await balance()).toMatchObject({ credits: 0, rewrites: 0 });
  });
  it("counts an included rewrite as package usage for cash refunds", async () => {
    const row = await paidOrder();
    await reserveCommercialTask({ userId, taskKey: "rewrite:refund-test", credits: 0, rewrites: 1, quote: {} });
    await expect(requestCommercialRefund(userId, row.id, "Unused")).rejects.toThrow("PACKAGE_USED_OR_RESERVED");
    await settleCommercialTask({ userId, taskKey: "rewrite:refund-test", credits: 0, rewrites: 1 });
    await expect(requestCommercialRefund(userId, row.id, "Unused")).rejects.toThrow("PACKAGE_USED_OR_RESERVED");
  });
  it("keeps an uncertain refund frozen, then restores benefits once on signed failure", async () => {
    const row = await paidOrder();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));
    expect((await requestCommercialRefund(userId, row.id, "Unused")).state).toBe("review");
    expect(await balance()).toMatchObject({ credits: 0, rewrites: 0 });
    const data = { appid: "ali", trade_order_id: row.providerOrderId, total_fee: "19.90", status: "UD" };
    await applyCommercialRefundNotification(data);
    await applyCommercialRefundNotification(data);
    expect(await balance()).toMatchObject({ credits: 200, rewrites: 20, frozen: false });
  });
  it("freezes externally refunded spent packages instead of creating negative balances", async () => {
    const row = await paidOrder();
    await reserveCommercialTask({ userId, taskKey: "spent", credits: 150, rewrites: 0, quote: {} });
    await settleCommercialTask({ userId, taskKey: "spent", credits: 150, rewrites: 0 });
    await applyCommercialRefundNotification({ appid: "ali", trade_order_id: row.providerOrderId, total_fee: "19.90", status: "CD" });
    expect(await balance()).toMatchObject({ credits: 50, frozen: true });
    await expect(reserveCommercialTask({ userId, taskKey: "blocked", credits: 1, rewrites: 0, quote: {} })).rejects.toThrow("COMMERCIAL_WALLET_UNDER_REVIEW");
  });
  it("settles only authenticated, amount-matched query responses and throttles duplicate polls", async () => {
    const row = await order();
    vi.stubEnv("XUNHUPAY_ALIPAY_APP_ID", "ali");
    vi.stubEnv("XUNHUPAY_ALIPAY_APP_SECRET", "test-secret");
    const data = { appid: "ali", trade_order_id: row.providerOrderId, total_fee: "19.90", status: "OD", errcode: 0 };
    const fetchMock = vi.fn(async () => Response.json({ ...data, hash: createXunhuPayHash(data, "test-secret") }));
    vi.stubGlobal("fetch", fetchMock);
    await reconcilePaymentOrder(row.id, randomUUID());
    expect(fetchMock).not.toHaveBeenCalled();
    await reconcilePaymentOrder(row.id, userId);
    await reconcilePaymentOrder(row.id, userId);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await balance()).toMatchObject({ credits: 200, rewrites: 20 });
  });
  it("does not interpret query CD as a refund or settle unsigned nested results", async () => {
    const row = await order();
    vi.stubEnv("XUNHUPAY_ALIPAY_APP_ID", "ali");
    vi.stubEnv("XUNHUPAY_ALIPAY_APP_SECRET", "test-secret");
    const data = { errcode: 0, data: { status: "OD", trade_order_id: row.providerOrderId } };
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ...data, hash: createXunhuPayHash(data, "test-secret") })));
    await reconcilePaymentOrder(row.id, userId);
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
      await expect(rewriteSceneVersion(input)).rejects.toThrow("simulated billing failure");
      expect(await testDb.select().from(schema.sceneVersions)).toHaveLength(1);
      expect(await balance()).toMatchObject({ rewrites: 19, heldRewrites: 1 });
    } finally {
      await client.exec("DROP TRIGGER reject_settlement ON commercial_ledger; DROP FUNCTION reject_settlement();");
    }
  });
});
