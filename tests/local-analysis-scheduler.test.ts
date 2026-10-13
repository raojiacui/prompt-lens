import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ resume: vi.fn() }));
vi.mock("@/lib/billing/independent-scene-analysis", () => ({ resumeLocalIndependentAnalyses: mocks.resume }));
import { startLocalAnalysisScheduler } from "@/lib/billing/local-analysis-scheduler";

let scheduler: ReturnType<typeof startLocalAnalysisScheduler>;
beforeEach(() => {
  vi.useFakeTimers();
  mocks.resume.mockReset().mockResolvedValue(undefined);
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("COMMERCIAL_SCENE_JOB_EXPERIMENT", "true");
  vi.stubEnv("COMMERCIAL_SCENE_JOB_TEST_USER_IDS", "59593254-1819-4e2e-8600-c3bebff86669");
  vi.stubEnv("CRON_SECRET", "local-test-secret");
  vi.stubEnv("LOCAL_ANALYSIS_BASE_URL", "http://127.0.0.1:3001");
});
afterEach(() => {
  scheduler?.stop();
  scheduler = undefined;
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it("continues scanning without browser requests and survives a failed scan", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.resume.mockRejectedValueOnce(new Error("temporary database failure"));
  scheduler = startLocalAnalysisScheduler();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(mocks.resume).toHaveBeenCalledTimes(2);
  scheduler?.stop();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(mocks.resume).toHaveBeenCalledTimes(2);
});

it("keeps a single scheduler and never overlaps slow scans", async () => {
  let finish!: () => void;
  mocks.resume.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  scheduler = startLocalAnalysisScheduler();
  expect(startLocalAnalysisScheduler()).toBe(scheduler);
  await vi.advanceTimersByTimeAsync(90_000);
  expect(mocks.resume).toHaveBeenCalledTimes(1);
  finish();
  await vi.advanceTimersByTimeAsync(15_000);
  expect(mocks.resume).toHaveBeenCalledTimes(2);
});

it.each([
  ["NODE_ENV", "production"], ["COMMERCIAL_SCENE_JOB_EXPERIMENT", "false"],
  ["COMMERCIAL_SCENE_JOB_TEST_USER_IDS", ""], ["CRON_SECRET", ""],
  ["LOCAL_ANALYSIS_BASE_URL", ""], ["LOCAL_ANALYSIS_BASE_URL", "https://example.com"],
])("stays disabled with %s=%s", async (name, value) => {
  vi.stubEnv(name, value);
  scheduler = startLocalAnalysisScheduler();
  expect(scheduler).toBeUndefined();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(mocks.resume).not.toHaveBeenCalled();
});
