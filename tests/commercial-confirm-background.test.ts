import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ after: vi.fn(), session: vi.fn(), confirm: vi.fn(), run: vi.fn(), wake: vi.fn(), transaction: vi.fn() }));
vi.mock("next/server", async importOriginal => ({ ...await importOriginal<typeof import("next/server")>(), after: mocks.after }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mocks.session } } }));
vi.mock("@/lib/db", () => ({ db: { transaction: mocks.transaction }, commercialTasks: {}, analysisSceneJobs: {} }));
vi.mock("@/lib/billing/reconciliation-worker", () => ({ wakeReconciliationWorker: mocks.wake }));
vi.mock("@/lib/billing/commercial-task-runner", () => ({ confirmCommercialTask: mocks.confirm, confirmCommercialTaskInTransaction: mocks.confirm, runCommercialTask: mocks.run }));
vi.mock("@/lib/billing/commercial-analysis", () => ({ commercialConsumptionEnabled: () => true, commercialAnalysisBundle: vi.fn(), recoverCommercialAnalysisTasks: vi.fn() }));
vi.mock("@/lib/billing/commercial-generation", () => ({ reconcileCommercialGeneration: vi.fn() }));
vi.mock("@/lib/workflow/analysis-tasks", () => ({ recoverAnalysisTasks: vi.fn(), runAnalysisTask: vi.fn(), finalizeCheckpointedWorkflow: vi.fn() }));
vi.mock("@/lib/billing/independent-scene-analysis", () => ({ flushReadyAnalysisSceneResults: vi.fn(), resumeIndependentAnalysis: vi.fn() }));
import { POST as confirmBatch } from "@/app/api/commercial/confirm/route";
import { POST as confirmSingle } from "@/app/api/commercial/tasks/[id]/route";

const id = "11111111-1111-4111-8111-111111111111";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ user: { id: "user" } });
  mocks.transaction.mockImplementation(callback => callback({}));
});
const request = () => new NextRequest("https://test.example/api/commercial/confirm", {
  method: "POST", headers: { origin: "https://test.example", "content-type": "application/json" }, body: JSON.stringify({ ids: [id] }),
});

it.each(["batch", "single"])("returns %s confirmation before wake and runs queued analysis independently", async kind => {
  mocks.confirm.mockResolvedValue({ id, state: "queued", kind: "analysis", credits: 1 });
  let finishWake!: (value: boolean) => void;
  mocks.wake.mockImplementation(() => new Promise<boolean>(resolve => { finishWake = resolve; }));
  const response = await (kind === "batch" ? confirmBatch(request()) : confirmSingle(request(), { params: Promise.resolve({ id }) }));
  expect(response.status).toBe(200);
  expect(mocks.confirm).toHaveBeenCalledOnce();
  expect(mocks.wake).not.toHaveBeenCalled();
  expect(mocks.run).not.toHaveBeenCalled();
  const background = mocks.after.mock.calls.map(([callback]) => callback());
  expect(mocks.wake).toHaveBeenCalledOnce();
  expect(mocks.run).toHaveBeenCalledExactlyOnceWith(id);
  finishWake(false);
  await Promise.all(background);
});

it.each(["batch", "single"])("does not schedule wake for a completed %s confirmation", async kind => {
  mocks.confirm.mockResolvedValue({ id, state: "completed", kind: "analysis", credits: 1 });
  const response = await (kind === "batch" ? confirmBatch(request()) : confirmSingle(request(), { params: Promise.resolve({ id }) }));
  expect(response.status).toBe(200);
  expect(mocks.after).not.toHaveBeenCalled();
});
