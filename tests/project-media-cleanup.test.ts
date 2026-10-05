import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";

const mocks = vi.hoisted(() => ({ db: null as unknown, remove: vi.fn() }));
vi.mock("@/lib/db", async () => ({ ...await import("@/lib/db/schema"), get db() { return mocks.db; } }));
vi.mock("@/lib/cloudflare/r2", () => ({
  extractR2Key: (url: string) => url.startsWith("https://media.example/") ? url.slice("https://media.example/".length) : null,
  getR2PublicUrl: (key: string) => `https://media.example/${key}`,
  deleteFromR2: mocks.remove,
}));
import { deleteProjectForUser } from "@/lib/workflow/service";
import { processMediaCleanupJobs } from "@/lib/workflow/media-cleanup";
import { expireProjectMedia } from "@/lib/workflow/media-retention";

const client = new PGlite();
const testDb = drizzle(client, { schema });
mocks.db = testDb;
let userId: string;
async function projectWithSource(key: string) {
  const [project] = await testDb.insert(schema.projects).values({ userId, title: "Project" }).returning();
  await testDb.insert(schema.referenceVideos).values({ projectId: project.id, sourceUrl: `https://media.example/${key}`, storageKey: key });
  return project.id;
}

async function oldProject(days = 8) {
  const createdAt = new Date(Date.now() - days * 86400000);
  const key = `uploads/${userId}/${randomUUID()}.mp4`;
  const [project] = await testDb.insert(schema.projects).values({ userId, title: "Old project", status: "ready", createdAt }).returning();
  await testDb.insert(schema.referenceVideos).values({ projectId: project.id, sourceUrl: `https://media.example/${key}`, storageKey: key, createdAt });
  const [version] = await testDb.insert(schema.projectVersions).values({ projectId: project.id, versionNumber: 0, label: "Original", overview: { narrative: "analysis text" }, createdAt }).returning();
  const [scene] = await testDb.insert(schema.videoScenes).values({ projectId: project.id, sceneIndex: 1, startTime: 0, endTime: 1, duration: 1, clipUrl: `https://media.example/clips/${project.id}.mp4`, keyframeUrls: [`https://media.example/frames/${project.id}.png`], createdAt }).returning();
  await testDb.insert(schema.sceneVersions).values({ projectId: project.id, projectVersionId: version.id, originalSceneId: scene.id, sceneIndex: 1, duration: 1, generationPrompt: "private analysis prompt", createdAt }).returning();
  return { project, version, scene, key, createdAt };
}

describe("project R2 media cleanup", () => {
  beforeAll(async () => {
    for (const migration of ["0000_dear_prism", "0003_blushing_thor", "0005_v2_workflow", "0006_generation_workflow_links", "0007_foamy_lily_hollister", "0008_payment_orders", "0010_commercial_wallets", "0011_commercial_purchase_lots", "0012_commercial_tasks", "0017_request_reservations", "0018_workflow_analysis_tasks", "0019_media_cleanup_jobs"]) {
      await client.exec(readFileSync(`drizzle/${migration}.sql`, "utf8"));
    }
  });
  beforeEach(async () => {
    userId = randomUUID();
    await testDb.insert(schema.user).values({ id: userId, email: `${userId}@example.com` });
    mocks.remove.mockReset().mockResolvedValue(undefined);
  });
  afterAll(async () => { await client.close(); });

  it("keeps shared source until its final project is deleted", async () => {
    const key = `uploads/${userId}/video/shared.mp4`;
    const first = await projectWithSource(key);
    const second = await projectWithSource(key);
    expect((await deleteProjectForUser(first, userId)).deletedR2Objects).toBe(0);
    expect(mocks.remove).not.toHaveBeenCalled();
    expect((await deleteProjectForUser(second, userId)).deletedR2Objects).toBe(1);
    expect(mocks.remove).toHaveBeenCalledTimes(1);
    expect(mocks.remove).toHaveBeenCalledWith(key);
    expect((await testDb.select().from(schema.mediaCleanupJobs)).find(job => job.storageKey === key)?.state).toBe("deleted");
  });

  it("retries failed deletes without losing the cleanup record", async () => {
    const key = `uploads/${userId}/image/retry.png`;
    const projectId = await projectWithSource(key);
    mocks.remove.mockRejectedValueOnce(new Error("temporary R2 error"));
    expect((await deleteProjectForUser(projectId, userId)).deletedR2Objects).toBe(0);
    const [job] = (await testDb.select().from(schema.mediaCleanupJobs)).filter(row => row.storageKey === key);
    expect(job).toMatchObject({ state: "pending", attempts: 1, lastError: "temporary R2 error" });
    await client.query("UPDATE media_cleanup_jobs SET next_attempt_at = now() - interval '1 minute' WHERE id = $1", [job.id]);
    expect(await processMediaCleanupJobs(1)).toBe(1);
    expect((await testDb.select().from(schema.mediaCleanupJobs)).find(row => row.id === job.id)?.state).toBe("deleted");
  });

  it("does not delete files referenced by another project's keyframe", async () => {
    const key = `analysis/${userId}/frame.png`;
    const projectId = await projectWithSource(key);
    const [other] = await testDb.insert(schema.projects).values({ userId, title: "Other" }).returning();
    await testDb.insert(schema.videoScenes).values({ projectId: other.id, sceneIndex: 1, startTime: 0, endTime: 1, duration: 1, keyframeUrls: [`https://media.example/${key}`] });
    expect((await deleteProjectForUser(projectId, userId)).deletedR2Objects).toBe(0);
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("expires seven-day content without deleting balances or provider-hosted results", async () => {
    const { project, createdAt, key } = await oldProject();
    await testDb.insert(schema.userCredits).values({ userId, balance: 200 });
    await testDb.insert(schema.videoGeneration).values({ userId, projectId: project.id, taskId: randomUUID(), prompt: "generation prompt", status: "completed", videoUrl: "https://provider.example/result.mp4" });
    const [task] = await testDb.insert(schema.commercialTasks).values({ userId, kind: "analysis", state: "completed", input: { projectId: project.id, mediaUrl: `https://media.example/${key}` }, result: { assets: { privateText: "analysis" }, chargedCredits: 7 }, createdAt, updatedAt: createdAt, expiresAt: createdAt }).returning();
    expect((await expireProjectMedia(10, true)).eligible).toBe(1);
    expect((await testDb.select().from(schema.sceneVersions)).some(s => s.projectId === project.id)).toBe(true);
    expect(mocks.remove).not.toHaveBeenCalled();
    expect((await expireProjectMedia()).expired).toBe(1);
    expect((await testDb.select().from(schema.sceneVersions)).some(s => s.projectId === project.id)).toBe(false);
    expect((await testDb.select().from(schema.projectVersions)).some(s => s.projectId === project.id)).toBe(false);
    expect((await testDb.select().from(schema.projects)).find(p => p.id === project.id)).toMatchObject({ status: "archived", metadata: { retentionDays: 7 } });
    expect((await testDb.select().from(schema.userCredits)).find(c => c.userId === userId)?.balance).toBe(200);
    expect((await testDb.select().from(schema.videoGeneration)).find(g => g.projectId === project.id)?.videoUrl).toBe("https://provider.example/result.mp4");
    const retained = (await testDb.select().from(schema.commercialTasks)).find(t => t.id === task.id)!;
    expect(retained.result).toEqual({ projectId: project.id, retentionExpired: true, chargedCredits: 7 });
    expect(JSON.stringify(retained.input)).not.toContain("mediaUrl");
    expect(await processMediaCleanupJobs(50)).toBe(3);
    expect(mocks.remove).not.toHaveBeenCalledWith("https://provider.example/result.mp4");
    expect((await expireProjectMedia()).expired).toBe(0);
  });

  it("keeps recent content, fresh rewrites and active tasks", async () => {
    const recent = await oldProject(6);
    const rewriting = await oldProject();
    await testDb.insert(schema.projectVersions).values({ projectId: rewriting.project.id, kind: "remix", versionNumber: 1, label: "Rewrite" });
    const active = await oldProject();
    await testDb.insert(schema.commercialTasks).values({ userId, kind: "generation", state: "running", input: { projectId: active.project.id }, expiresAt: new Date(Date.now() + 86400000) });
    expect((await expireProjectMedia()).expired).toBe(0);
    const projects = await testDb.select().from(schema.projects);
    for (const id of [recent.project.id, rewriting.project.id, active.project.id]) expect(projects.find(p => p.id === id)?.status).toBe("ready");
  });

  it("protects shared files belonging to another user's unexpired project", async () => {
    const old = await oldProject();
    const otherUser = randomUUID();
    await testDb.insert(schema.user).values({ id: otherUser, email: `${otherUser}@example.com` });
    const [other] = await testDb.insert(schema.projects).values({ userId: otherUser, title: "Other" }).returning();
    await testDb.insert(schema.referenceVideos).values({ projectId: other.id, sourceUrl: `https://media.example/${old.key}`, storageKey: old.key });
    expect((await expireProjectMedia()).expired).toBe(1);
    await processMediaCleanupJobs(50);
    expect(mocks.remove).not.toHaveBeenCalledWith(old.key);
    expect((await testDb.select().from(schema.referenceVideos)).some(r => r.projectId === other.id)).toBe(true);
  });

  it("protects source files referenced by active standalone generation tasks", async () => {
    const old = await oldProject();
    await testDb.insert(schema.commercialTasks).values({ userId, kind: "generation", state: "queued", input: { images: [`https://media.example/${old.key}`] }, expiresAt: new Date(Date.now() + 86400000) });
    await expireProjectMedia();
    await processMediaCleanupJobs(50);
    expect(mocks.remove).not.toHaveBeenCalledWith(old.key);
  });
});
