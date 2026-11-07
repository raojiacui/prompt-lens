import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import type { AnalysisInput } from "@/lib/billing/commercial-analysis";
import type { FfmpegSceneAsset } from "@/lib/ffmpeg-worker/client";

const mocks = vi.hoisted(() => ({ db: null as unknown, media: vi.fn() }));
vi.mock("@/lib/db", async () => ({ ...await import("@/lib/db/schema"), get db() { return mocks.db; } }));
vi.mock("@/lib/billing/commercial-media", () => ({ commercialMediaRequest: mocks.media }));
import { prepareIndependentSceneAsset } from "@/lib/billing/scene-assets";

const client = new PGlite();
const db = drizzle(client, { schema });
mocks.db = db;
let task: typeof schema.commercialTasks.$inferSelect;
let jobs: (typeof schema.analysisSceneJobs.$inferSelect)[];
let sceneIds: string[];

beforeAll(async () => {
  for (const name of ["0000_dear_prism", "0003_blushing_thor", "0005_v2_workflow", "0007_foamy_lily_hollister", "0008_payment_orders", "0010_commercial_wallets", "0011_commercial_purchase_lots", "0012_commercial_tasks", "0016_trial_analysis_usage", "0017_request_reservations", "0018_workflow_analysis_tasks", "0023_analysis_scene_jobs"]) {
    await client.exec(readFileSync(`drizzle/${name}.sql`, "utf8"));
  }
});
beforeEach(async () => {
  const userId = randomUUID(), projectId = randomUUID();
  await db.insert(schema.user).values({ id: userId, email: `${userId}@example.com` });
  await db.insert(schema.projects).values({ id: projectId, userId, title: "Preview preservation" });
  const scenes = [1, 2].map(index => ({ sceneIndex: index, startTime: index - 1, endTime: index, duration: 1, keyframeUrls: [] as string[] }));
  sceneIds = (await db.insert(schema.videoScenes).values(scenes.map(scene => ({ ...scene, projectId }))).returning()).map(scene => scene.id);
  const input = { projectId, mediaUrl: "https://media.example/source.mp4", preview: { sourceHash: "owned-source" }, pricing: { automaticSplit: true, scenes: scenes.map(scene => ({ id: String(scene.sceneIndex), startUs: scene.startTime * 1e6, endUs: scene.endTime * 1e6 })) } } as unknown as AnalysisInput;
  [task] = await db.insert(schema.commercialTasks).values({ userId, kind: "analysis", state: "running", input, result: { assets: { metadata: {}, scenes }, sceneRecords: { "1": sceneIds[0], "2": sceneIds[1] } }, expiresAt: new Date(Date.now() + 600000) }).returning();
  jobs = await db.insert(schema.analysisSceneJobs).values([1, 2].map(index => ({ taskId: task.id, sceneId: String(index), sceneIndex: index, state: "running", executionId: randomUUID(), result: { phase: "preparing" } }))).returning();
  mocks.media.mockReset().mockImplementation(async (_url, body) => {
    const interval = body.scenes[0];
    return { metadata: {}, scenes: [{ sceneIndex: 1, startTime: interval.startUs / 1e6, endTime: interval.endUs / 1e6, duration: 1, clipUrl: `https://media.example/${interval.id}.mp4`, keyframeUrls: [0, 1, 2].map(n => `https://media.example/${interval.id}-${n}.jpg`) }] };
  });
});
afterAll(async () => { await client.close(); });

it("retains each prepared asset independently of later parent progress writes", async () => {
  for (const job of jobs) await prepareIndependentSceneAsset(task, job, job.executionId!);
  const stored = await db.select().from(schema.analysisSceneJobs).where(eq(schema.analysisSceneJobs.taskId, task.id)).orderBy(schema.analysisSceneJobs.sceneIndex);
  expect(stored.map(job => (job.result as { preparedAsset?: FfmpegSceneAsset }).preparedAsset?.clipUrl)).toEqual(["https://media.example/1.mp4", "https://media.example/2.mp4"]);
  const rows = await db.select().from(schema.videoScenes).orderBy(schema.videoScenes.sceneIndex);
  expect(rows.filter(row => sceneIds.includes(row.id)).every(row => row.clipUrl && (row.keyframeUrls as string[]).length === 3)).toBe(true);
  // Simulate an old/incomplete parent snapshot and missing display record.
  await db.update(schema.commercialTasks).set({ result: task.result }).where(eq(schema.commercialTasks.id, task.id));
  await db.update(schema.videoScenes).set({ clipUrl: null, keyframeUrls: [] }).where(eq(schema.videoScenes.id, sceneIds[0]));
  await prepareIndependentSceneAsset(task, stored[0], stored[0].executionId!);
  expect(mocks.media).toHaveBeenCalledTimes(2);
  const [repaired] = await db.select().from(schema.videoScenes).where(eq(schema.videoScenes.id, sceneIds[0]));
  expect(repaired.clipUrl).toBe("https://media.example/1.mp4");
});

it("rejects a missing scene link instead of acknowledging unpersisted assets", async () => {
  await db.update(schema.commercialTasks).set({ result: { ...task.result as object, sceneRecords: { "1": randomUUID(), "2": sceneIds[1] } } }).where(eq(schema.commercialTasks.id, task.id));
  await expect(prepareIndependentSceneAsset(task, jobs[0], jobs[0].executionId!)).rejects.toThrow("ANALYSIS_SCENE_CHECKPOINT_MISSING");
});

it("does not publish assets after the scene execution has been replaced", async () => {
  await expect(prepareIndependentSceneAsset(task, jobs[0], randomUUID())).rejects.toThrow("ANALYSIS_EXECUTION_LOST");
  const [row] = await db.select().from(schema.videoScenes).where(eq(schema.videoScenes.id, sceneIds[0]));
  expect(row.clipUrl).toBeNull();
});
