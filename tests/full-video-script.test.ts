import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";

const isolated = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", async () => ({ ...await import("@/lib/db/schema"), get db() { return isolated.db; } }));
vi.mock("@/lib/ai/provider-client", () => ({ requestProviderChat: vi.fn() }));
import { requestProviderChat } from "@/lib/ai/provider-client";
import { readFullVideoScript, saveFullVideoScript } from "@/lib/workflow/full-video-script-store";
import { proposeScriptRewrite } from "@/lib/workflow/full-video-script-rewrite";
import { exportFullVideoScript } from "@/lib/workflow/full-video-script";
import { grantCommercialPurchase, reserveCommercialTask } from "@/lib/billing/commercial-wallet";
import { recoverExpiredCommercialRewrites } from "@/lib/billing/rewrite-recovery";
import { expireProjectMedia } from "@/lib/workflow/media-retention";

const client = new PGlite();
const testDb = drizzle(client, { schema });
isolated.db = testDb;
const userId = randomUUID();
async function fixture() {
  const [project] = await testDb.insert(schema.projects).values({ userId, title: "完整故事" }).returning();
  const [version] = await testDb.insert(schema.projectVersions).values({ projectId: project.id, versionNumber: 1, label: "Original" }).returning();
  for (const [index, start, end] of [[1, 0.25, 2.75], [2, 4.12, 6.99]]) {
    const [scene] = await testDb.insert(schema.videoScenes).values({ projectId: project.id, sceneIndex: index, startTime: start, endTime: end, duration: end - start }).returning();
    await testDb.insert(schema.sceneVersions).values({ projectId: project.id, projectVersionId: version.id, originalSceneId: scene.id, sceneIndex: index,
      story: { summary: `镜头${index}的故事` }, visual: { sceneDescription: "白衣人物乘舟", characters: "白衣人物", camera: "平移" },
      generationPrompt: "人物乘舟，衣袂飘动", duration: end - start });
  }
  const document = await readFullVideoScript(userId, project.id, version.id, true);
  return { projectId: project.id, versionId: version.id, document };
}
const wallet = async () => (await testDb.select().from(schema.commercialWallets))[0];

describe("Independent full video script with real isolated transactions", () => {
  beforeAll(async () => {
    await client.exec('CREATE TABLE "user" (id uuid PRIMARY KEY, email text, banned boolean, is_anonymous boolean default false);');
    for (const migration of ["0005_v2_workflow", "0008_payment_orders", "0010_commercial_wallets", "0011_commercial_purchase_lots", "0028_expiring_admin_entitlements", "0002_video_generation", "0006_generation_workflow_links", "0012_commercial_tasks", "0019_media_cleanup_jobs"]) {
      await client.exec(readFileSync(`drizzle/${migration}.sql`, "utf8"));
    }
    await client.query('INSERT INTO "user" (id,email) VALUES ($1, $2)', [userId, "script@example.com"]);
  });
  beforeEach(async () => {
    vi.mocked(requestProviderChat).mockReset();
    await client.exec("TRUNCATE projects, commercial_wallets, commercial_reservations, commercial_lots, commercial_allocations, commercial_ledger CASCADE");
  });
  afterAll(async () => { await client.close(); });

  it("builds once using actual noncontiguous boundaries and never calls AI on expand", async () => {
    const f = await fixture();
    expect(f.document.content.scenes.map(s => [s.startMs, s.endMs])).toEqual([[250, 2750], [4120, 6990]]);
    expect((await readFullVideoScript(userId, f.projectId, f.versionId, false)).content).toEqual(f.document.content);
    expect(requestProviderChat).not.toHaveBeenCalled();
    const exported = exportFullVideoScript(f.document.content, "md", f.projectId, f.versionId, 1, true);
    expect(exported).toContain("00:04.120–00:06.990");
    expect(JSON.parse(exportFullVideoScript(f.document.content, "json", f.projectId, f.versionId, 1, true)).scenes).toHaveLength(2);
  });
  it("isolates ownership, keeps source analysis unchanged and rejects stale writes and altered timing", async () => {
    const f = await fixture();
    await expect(readFullVideoScript(randomUUID(), f.projectId, f.versionId, true)).rejects.toThrow("SCRIPT_NOT_FOUND");
    const content = { ...f.document.content, title: "本地编辑" };
    const saved = await saveFullVideoScript({ userId, ...f, revision: 1, content });
    expect(saved.revision).toBe(2);
    await expect(saveFullVideoScript({ userId, ...f, revision: 1, content })).rejects.toThrow("SCRIPT_CONFLICT");
    await expect(saveFullVideoScript({ userId: randomUUID(), ...f, revision: 2, content })).rejects.toThrow("SCRIPT_NOT_FOUND");
    const altered = { ...content, scenes: content.scenes.map(s => ({ ...s, startMs: 0 })) };
    await expect(saveFullVideoScript({ userId, ...f, revision: 2, content: altered })).rejects.toThrow("SCRIPT_BOUNDARY_MISMATCH");
    expect((await testDb.select().from(schema.sceneVersions))[0].generationPrompt).toBe("人物乘舟，衣袂飘动");
    expect((await saveFullVideoScript({ userId, ...f, revision: 2, undo: true })).content.title).toBe("完整故事");
  });
  it("charges a reviewed candidate exactly once, enforces scene scope and applies only on confirmation", async () => {
    const f = await fixture();
    await testDb.transaction(tx => grantCommercialPurchase(tx as unknown as Parameters<typeof grantCommercialPurchase>[0], { userId, orderId: randomUUID(), packageId: "v6_trial_200", credits: 200, rewrites: 20 }));
    const modified = { ...f.document.content, title: "模型越界修改", scenes: f.document.content.scenes.map(s => ({ ...s, text: "雪原中的白衣人物" })) };
    vi.mocked(requestProviderChat).mockResolvedValueOnce(JSON.stringify(modified)).mockResolvedValueOnce('{"accepted":true,"issues":[]}');
    const input = { userId, ...f, revision: 1, requestId: randomUUID(), instruction: "只改第二镜头为雪原", sceneIds: [f.document.content.scenes[1].id], language: "zh" as const, payer: "included" as const, provider: "kie" as const, apiKey: "test" };
    const candidate = await proposeScriptRewrite(input);
    expect(candidate.content.title).toBe("完整故事");
    expect(candidate.content.scenes[0]).toEqual(f.document.content.scenes[0]);
    expect((await readFullVideoScript(userId, f.projectId, f.versionId, true)).content).toEqual(f.document.content);
    expect(await wallet()).toMatchObject({ rewrites: 19, heldRewrites: 0, credits: 200 });
    expect(await proposeScriptRewrite(input)).toEqual(candidate);
    expect(requestProviderChat).toHaveBeenCalledTimes(2);
    await expect(proposeScriptRewrite({ ...input, instruction: "tampered" })).rejects.toThrow("SCRIPT_REPLAY_MISMATCH");
    expect((await saveFullVideoScript({ userId, ...f, revision: 1, candidateId: candidate.requestId })).content.scenes[1].text).toContain("雪原");
  });
  it("releases failed rewrites, blocks inference without balance and recovers interrupted script reservations", async () => {
    const f = await fixture();
    const input = { userId, ...f, revision: 1, requestId: randomUUID(), instruction: "改为雪原", sceneIds: [], language: "zh" as const, payer: "included" as const, provider: "kie" as const, apiKey: "test" };
    await expect(proposeScriptRewrite(input)).rejects.toThrow("INSUFFICIENT_COMMERCIAL_BALANCE");
    expect(requestProviderChat).not.toHaveBeenCalled();
    await testDb.transaction(tx => grantCommercialPurchase(tx as unknown as Parameters<typeof grantCommercialPurchase>[0], { userId, orderId: randomUUID(), packageId: "v6_trial_200", credits: 200, rewrites: 20 }));
    vi.mocked(requestProviderChat).mockRejectedValue(new Error("private provider error"));
    await expect(proposeScriptRewrite({ ...input, requestId: randomUUID() })).rejects.toThrow("SCRIPT_REWRITE_FAILED");
    expect(await wallet()).toMatchObject({ rewrites: 20, heldRewrites: 0 });
    const taskKey = `rewrite:script:${randomUUID()}`;
    await reserveCommercialTask({ userId, taskKey, credits: 0, rewrites: 1, quote: { projectId: f.projectId } });
    await testDb.update(schema.commercialReservations).set({ createdAt: new Date(Date.now() - 400000) }).where(eq(schema.commercialReservations.taskKey, taskKey));
    expect(await recoverExpiredCommercialRewrites({ userId, taskKey })).toBe(1);
    expect(await wallet()).toMatchObject({ rewrites: 20, heldRewrites: 0 });
  });
  it("rejects stale candidate application and BYOK keeps platform allowance unchanged", async () => {
    const f = await fixture();
    const modified = { ...f.document.content, summary: "新故事" };
    vi.mocked(requestProviderChat).mockResolvedValueOnce(JSON.stringify(modified)).mockResolvedValueOnce('{"accepted":true,"issues":[]}');
    const candidate = await proposeScriptRewrite({ userId, ...f, revision: 1, requestId: randomUUID(), instruction: "修改故事", sceneIds: [], language: "zh", payer: "byok", provider: "kie", apiKey: "user-key" });
    expect(await wallet()).toMatchObject({ rewrites: 0, credits: 0, heldRewrites: 0 });
    await saveFullVideoScript({ userId, ...f, revision: 1, content: { ...f.document.content, title: "人工新修订" } });
    await expect(saveFullVideoScript({ userId, ...f, revision: 2, candidateId: candidate.requestId })).rejects.toThrow("SCRIPT_CONFLICT");
  });
  it("deletes independent script revisions through the existing seven-day cleanup", async () => {
    await fixture();
    await client.exec("UPDATE projects SET created_at = now() - interval '8 days'; UPDATE project_versions SET created_at = now() - interval '8 days'; UPDATE scene_versions SET created_at = now() - interval '8 days';");
    expect((await expireProjectMedia()).expired).toBe(1);
    expect(await testDb.select().from(schema.projectVersions)).toHaveLength(0);
  });
});
