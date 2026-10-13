import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ select: vi.fn(), localFetch: vi.fn() }));
vi.mock("@/lib/db", async () => ({ ...await import("@/lib/db/schema"), db: { select: mocks.select } }));
vi.mock("undici", async importOriginal => ({ ...await importOriginal<typeof import("undici")>(), fetch: mocks.localFetch }));
vi.mock("@/lib/billing/commercial-analysis", () => ({ finishCommercialAnalysis: vi.fn(), savedAnalysisModel: vi.fn() }));
vi.mock("@/lib/workflow/scene-analysis", () => ({ analyzeSceneBlueprint: vi.fn(), buildFallbackSceneBlueprint: vi.fn() }));
vi.mock("@/lib/byok/kie", () => ({ getUserKieApiKey: vi.fn() }));
import { dispatchQueuedSceneJobs } from "@/lib/billing/independent-scene-analysis";

function queued(rows: Array<{ id: string; taskId: string; activeCount: number }>) {
  mocks.select.mockReturnValue({ from: () => ({ innerJoin: () => ({ where: () => ({ orderBy: () => ({ limit: () => Promise.resolve(rows) }) }) }) }) });
}
beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "test-secret");
  vi.stubEnv("LOCAL_ANALYSIS_BASE_URL", "http://localhost:3001");
  mocks.localFetch.mockReset().mockImplementation(async () => new Response("{}"));
  mocks.select.mockReset();
});
afterEach(() => { vi.unstubAllEnvs(); });

it("starts the second available lane before a slow first acknowledgement returns", async () => {
  queued([{ id: "first", taskId: "parent", activeCount: 0 }, { id: "second", taskId: "parent", activeCount: 0 }]);
  let acknowledge!: (value: Response) => void;
  mocks.localFetch.mockImplementationOnce(() => new Promise(resolve => { acknowledge = resolve; }));
  const dispatching = dispatchQueuedSceneJobs("parent");
  await vi.waitFor(() => expect(mocks.localFetch).toHaveBeenCalledTimes(2));
  acknowledge(new Response("unavailable", { status: 503 }));
  expect(await dispatching).toBe(1);
});

it("sends only one replacement while the other scene is still running", async () => {
  queued([{ id: "first", taskId: "parent", activeCount: 1 }, { id: "second", taskId: "parent", activeCount: 1 }]);
  expect(await dispatchQueuedSceneJobs("parent")).toBe(1);
  expect(mocks.localFetch).toHaveBeenCalledTimes(1);
});

it("bounds a scan to five requests and two lanes per parent even when all requests fail", async () => {
  queued(Array.from({ length: 16 }, (_, index) => ({ id: `job-${index}`, taskId: `parent-${Math.floor(index / 4)}`, activeCount: 0 })));
  mocks.localFetch.mockImplementation(async () => new Response("unavailable", { status: 503 }));
  expect(await dispatchQueuedSceneJobs()).toBe(0);
  expect(mocks.localFetch).toHaveBeenCalledTimes(5);
  const ids = mocks.localFetch.mock.calls.map(([, request]) => JSON.parse(request.body).sceneJobId);
  expect(ids).toEqual(["job-0", "job-1", "job-4", "job-5", "job-8"]);
});

it("skips database work when dispatch is unconfigured", async () => {
  vi.stubEnv("CRON_SECRET", "");
  expect(await dispatchQueuedSceneJobs()).toBe(0);
  expect(mocks.select).not.toHaveBeenCalled();
});
