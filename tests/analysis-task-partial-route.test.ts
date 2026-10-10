import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PgDialect } from "drizzle-orm/pg-core";

const mocks = vi.hoisted(() => ({ session: vi.fn(), find: vi.fn(), bundle: vi.fn(), after: vi.fn(), recover: vi.fn() }));
vi.mock("next/server", async importOriginal => ({ ...await importOriginal<typeof import("next/server")>(), after: mocks.after }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mocks.session } } }));
vi.mock("@/lib/db", async () => ({ ...await import("@/lib/db/schema"), db: { query: { commercialTasks: { findFirst: mocks.find } } } }));
vi.mock("@/lib/billing/commercial-analysis", () => ({ commercialAnalysisBundle: mocks.bundle, recoverCommercialAnalysisTasks: mocks.recover }));
vi.mock("@/lib/billing/commercial-task-runner", () => ({ confirmCommercialTask: vi.fn(), runCommercialTask: vi.fn() }));
vi.mock("@/lib/billing/commercial-generation", () => ({ reconcileCommercialGeneration: vi.fn() }));
vi.mock("@/lib/workflow/analysis-tasks", () => ({ recoverAnalysisTasks: vi.fn(), runAnalysisTask: vi.fn() }));
import { GET } from "@/app/api/commercial/tasks/[id]/route";

const id = "22222222-2222-4222-8222-222222222222";
const call = () => GET(new NextRequest(`http://localhost/api/commercial/tasks/${id}`), { params: Promise.resolve({ id }) });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ user: { id: "alice" } });
  mocks.find.mockResolvedValue({ id, userId: "alice", kind: "analysis", state: "running", updatedAt: new Date(), expiresAt: new Date(Date.now() + 60000), input: { pricing: { scenes: [1, 2] } }, result: { assets: { scenes: [1, 2] }, finishedSceneIds: ["1"], successfulSceneIds: ["1"] } });
  mocks.bundle.mockResolvedValue({ sceneVersions: [{ id: "completed-shot" }] });
});
it.each(["running", "queued"])("returns saved results while commercial analysis is %s", async state => {
  const task = await mocks.find();
  mocks.find.mockResolvedValue({ ...task, state });
  const response = await call();
  expect(await response.json()).toMatchObject({ state, completedScenes: 1, totalScenes: 2, bundle: { sceneVersions: [{ id: "completed-shot" }] } });
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
});
it("also returns intermediate results for uploaded-file workflow tasks", async () => {
  const task = await mocks.find();
  mocks.find.mockResolvedValue({ ...task, kind: "workflow_analysis", result: { cursor: 1, assets: { scenes: [1, 2] } } });
  expect(await (await call()).json()).toMatchObject({ state: "running", completedScenes: 1, bundle: { sceneVersions: [{ id: "completed-shot" }] } });
});
it("does not load a project before any scene is processed", async () => {
  const task = await mocks.find();
  mocks.find.mockResolvedValue({ ...task, result: {} });
  expect((await (await call()).json()).bundle).toBeUndefined();
  expect(mocks.bundle).not.toHaveBeenCalled();
});
it.each([[5, false], [7, true], [31, true]])("uses the shared six-minute inactivity limit at %s minutes", async (minutes, shouldRecover) => {
  const task = await mocks.find();
  mocks.find.mockResolvedValue({ ...task, updatedAt: new Date(Date.now() - Number(minutes) * 60000) });
  await call();
  expect(mocks.recover).toHaveBeenCalledTimes(shouldRecover ? 1 : 0);
});
it.each([[30, false], [61, true]])("recovers a durable save checkpoint after %s seconds without waiting for inference timeout", async (seconds, shouldRecover) => {
  const task = await mocks.find();
  mocks.find.mockResolvedValue({ ...task, updatedAt: new Date(Date.now() - Number(seconds) * 1000), result: { ...task.result, pendingResult: { sceneId: "2", blueprint: {} } } });
  await call();
  expect(mocks.recover).toHaveBeenCalledTimes(shouldRecover ? 1 : 0);
});
it.each([true, false])("reports whether a reviewed save can continue polling: %s", async pending => {
  const task = await mocks.find();
  mocks.find.mockResolvedValue({ ...task, state: "review", result: { ...task.result, pendingResult: pending ? { sceneId: "2", blueprint: {} } : null } });
  expect(await (await call()).json()).toMatchObject({ state: "review", saveRecoveryPending: pending });
});
it("reports single-shot retry progress separately from cumulative project successes", async () => {
  const task = await mocks.find();
  mocks.find.mockResolvedValue({ ...task, state: "completed", input: { pricing: { scenes: [1, 2, 3] }, retry: { sceneVersions: ["2"] } }, result: { finishedSceneIds: ["2"], successfulSceneIds: ["1", "2"] } });
  expect(await (await call()).json()).toMatchObject({ totalScenes: 1, completedScenes: 1, partial: true });
});
it("keeps returning terminal failed results even without completed scenes", async () => {
  const task = await mocks.find();
  mocks.find.mockResolvedValue({ ...task, state: "failed", result: {} });
  expect((await (await call()).json()).bundle).toBeDefined();
});
it("does not include analysis bundles in generation status", async () => {
  const task = await mocks.find();
  mocks.find.mockResolvedValue({ ...task, kind: "generation", state: "completed" });
  await call();
  expect(mocks.bundle).not.toHaveBeenCalled();
});
it("requires ownership before returning partial results", async () => {
  mocks.find.mockResolvedValue(undefined);
  expect((await call()).status).toBe(404);
  expect(new PgDialect().sqlToQuery(mocks.find.mock.calls[0][0].where).params).toEqual([id, "alice"]);
  expect(mocks.bundle).not.toHaveBeenCalled();
});
it("requires authentication before reading task results", async () => {
  mocks.session.mockResolvedValue(null);
  expect((await call()).status).toBe(401);
  expect(mocks.find).not.toHaveBeenCalled();
});
