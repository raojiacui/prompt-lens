import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ after: vi.fn(), session: vi.fn(), enqueue: vi.fn(), run: vi.fn(), wake: vi.fn(), limit: vi.fn() }));
vi.mock("next/server", async importOriginal => ({ ...await importOriginal<typeof import("next/server")>(), after: mocks.after }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mocks.session } } }));
vi.mock("@/lib/workflow/analysis-tasks", () => ({ enqueueAnalysis: mocks.enqueue, runAnalysisTask: mocks.run }));
vi.mock("@/lib/billing/reconciliation-worker", () => ({ wakeReconciliationWorker: mocks.wake }));
vi.mock("@/lib/utils/rate-limit", () => ({ checkRateLimit: mocks.limit }));
vi.mock("@/lib/billing/video-analysis", () => ({ videoAnalysisBillingErrorResponse: () => null }));
import { POST } from "@/app/api/workflow/projects/[id]/breakdown/route";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ user: { id: "user" } });
  mocks.limit.mockResolvedValue({ allowed: true });
  mocks.enqueue.mockResolvedValue({ id: "task", state: "queued" });
  mocks.wake.mockResolvedValue(false);
});
const request = (origin = "https://test.example") => new NextRequest("https://test.example/api/workflow/projects/project/breakdown", {
  method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ mediaType: "video" }),
});
const context = () => ({ params: Promise.resolve({ id: "project" }) });

it("acknowledges submission before wake and starts analysis while wake is still pending", async () => {
  let finishWake!: (value: boolean) => void;
  mocks.wake.mockImplementation(() => new Promise<boolean>(resolve => { finishWake = resolve; }));
  const response = await POST(request(), context());
  expect(response.status).toBe(202);
  expect(await response.json()).toEqual({ taskId: "task", state: "queued" });
  expect(mocks.wake).not.toHaveBeenCalled();
  expect(mocks.run).not.toHaveBeenCalled();
  expect(mocks.after).toHaveBeenCalledOnce();
  const background = mocks.after.mock.calls[0][0]();
  expect(mocks.wake).toHaveBeenCalledWith("workflow_analysis");
  expect(mocks.run).toHaveBeenCalledExactlyOnceWith("task");
  finishWake(false);
  await background;
  expect(mocks.enqueue).toHaveBeenCalledOnce();
});

it("wakes a running task without starting another execution", async () => {
  mocks.enqueue.mockResolvedValue({ id: "task", state: "running" });
  expect((await POST(request(), context())).status).toBe(202);
  await mocks.after.mock.calls[0][0]();
  expect(mocks.wake).toHaveBeenCalledOnce();
  expect(mocks.run).not.toHaveBeenCalled();
});

it.each(["completed", "failed"])("does not wake or restart a %s task", async state => {
  mocks.enqueue.mockResolvedValue({ id: "task", state });
  expect((await POST(request(), context())).status).toBe(202);
  expect(mocks.after).not.toHaveBeenCalled();
});

it.each(["unauthenticated", "invalid origin", "rate limited"])("preserves the %s submission boundary", async kind => {
  if (kind === "unauthenticated") mocks.session.mockResolvedValue(null);
  if (kind === "rate limited") mocks.limit.mockResolvedValue({ allowed: false });
  const response = await POST(request(kind === "invalid origin" ? "https://other.example" : undefined), context());
  expect(response.status).toBe(kind === "unauthenticated" ? 401 : kind === "invalid origin" ? 403 : 429);
  expect(mocks.enqueue).not.toHaveBeenCalled();
  expect(mocks.after).not.toHaveBeenCalled();
});
