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

const client = new PGlite();
const testDb = drizzle(client, { schema });
mocks.db = testDb;
let userId: string;
async function projectWithSource(key: string) {
  const [project] = await testDb.insert(schema.projects).values({ userId, title: "Project" }).returning();
  await testDb.insert(schema.referenceVideos).values({ projectId: project.id, sourceUrl: `https://media.example/${key}`, storageKey: key });
  return project.id;
}

describe("project R2 media cleanup", () => {
  beforeAll(async () => {
    for (const migration of ["0000_dear_prism", "0003_blushing_thor", "0005_v2_workflow", "0007_foamy_lily_hollister", "0008_payment_orders", "0010_commercial_wallets", "0011_commercial_purchase_lots", "0012_commercial_tasks", "0017_request_reservations", "0018_workflow_analysis_tasks", "0019_media_cleanup_jobs"]) {
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
});
