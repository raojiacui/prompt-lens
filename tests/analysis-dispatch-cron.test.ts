import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  recoverWorkflow: vi.fn(), recoverCommercial: vi.fn(), escalateReviews: vi.fn(), notifyReviews: vi.fn(), recoverScenes: vi.fn(), reconcileScenes: vi.fn(), dispatchScenes: vi.fn(), dispatch: vi.fn(),
  consumptionEnabled: vi.fn(), select: vi.fn(), update: vi.fn(),
}));
vi.mock("@/lib/db", async () => ({ ...await import("@/lib/db/schema"), db: { select: mocks.select, update: mocks.update } }));
vi.mock("@/lib/workflow/analysis-tasks", () => ({ recoverAnalysisTasks: mocks.recoverWorkflow }));
vi.mock("@/lib/billing/commercial-analysis", () => ({ recoverCommercialAnalysisTasks: mocks.recoverCommercial, commercialConsumptionEnabled: mocks.consumptionEnabled }));
vi.mock("@/lib/workflow/analysis-dispatch", () => ({ dispatchQueuedAnalysis: mocks.dispatch }));
vi.mock("@/lib/billing/commercial-review", () => ({ escalateOverdueCommercialReviews: mocks.escalateReviews, notifyDueCommercialReviews: mocks.notifyReviews }));
vi.mock("@/lib/billing/independent-scene-analysis", () => ({ recoverStaleAnalysisSceneJobs: mocks.recoverScenes, reconcileTerminalIndependentAnalysis: mocks.reconcileScenes, dispatchQueuedSceneJobs: mocks.dispatchScenes }));

import { GET } from "@/app/api/cron/analysis-dispatch/route";

const request = (secret?: string) => new NextRequest("http://localhost/api/cron/analysis-dispatch", { headers: secret ? { authorization: `Bearer ${secret}` } : {} });
beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "test-secret";
  mocks.consumptionEnabled.mockReturnValue(true);
  mocks.recoverWorkflow.mockResolvedValue(undefined);
  mocks.recoverCommercial.mockResolvedValue(undefined);
  mocks.escalateReviews.mockResolvedValue(0);
  mocks.notifyReviews.mockResolvedValue(0);
  mocks.recoverScenes.mockResolvedValue(0);
  mocks.reconcileScenes.mockResolvedValue(0);
  mocks.dispatchScenes.mockResolvedValue(0);
  mocks.dispatch.mockResolvedValue(true);
  mocks.select.mockReturnValue({ from: () => ({ where: () => ({ orderBy: () => ({ limit: () => Promise.resolve([{ id: "one", result: {} }, { id: "two", result: {} }]) }) }) }) });
  mocks.update.mockReturnValue({ set: () => ({ where: () => ({ returning: () => Promise.resolve([{ id: "claimed" }]) }) }) });
});

it("rejects unauthenticated scans before touching tasks", async () => {
  expect((await GET(request())).status).toBe(401);
  expect(mocks.select).not.toHaveBeenCalled();
});

it("recovers stale tasks without duplicate dispatch and wakes queued tasks", async () => {
  mocks.dispatch.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  const response = await GET(request("test-secret"));
  expect(await response.json()).toMatchObject({ scanned: 2, accepted: 1, recoveryErrors: [] });
  expect(mocks.recoverWorkflow).toHaveBeenCalledWith(expect.objectContaining({ dispatch: false, limit: 1, deadline: expect.any(Number) }));
  expect(mocks.recoverCommercial).toHaveBeenCalledWith(undefined, expect.objectContaining({ dispatch: false, limit: 1, deadline: expect.any(Number) }));
  expect(mocks.escalateReviews).toHaveBeenCalledWith(5);
  expect(mocks.reconcileScenes).toHaveBeenCalledWith(undefined, 5);
  expect(mocks.dispatch.mock.calls.map(([id]) => id)).toEqual(["one", "two"]);
  expect(mocks.update).toHaveBeenCalledTimes(2);
  expect(mocks.dispatch.mock.invocationCallOrder[0]).toBeLessThan(mocks.recoverWorkflow.mock.invocationCallOrder[0]);
});

it("does not send a task when another scan already claimed its dispatch slot", async () => {
  mocks.update.mockReturnValueOnce({ set: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }) });
  const response = await GET(request("test-secret"));
  expect(await response.json()).toMatchObject({ scanned: 2, accepted: 1 });
  expect(mocks.dispatch.mock.calls.map(([id]) => id)).toEqual(["two"]);
});

it("continues waking queued tasks when one recovery path fails", async () => {
  mocks.recoverCommercial.mockRejectedValue(new Error("Temporary database failure"));
  const response = await GET(request("test-secret"));
  expect(await response.json()).toMatchObject({ scanned: 2, accepted: 2, recoveryErrors: ["analysis"] });
});
