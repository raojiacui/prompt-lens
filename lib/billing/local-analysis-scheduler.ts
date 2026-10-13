import { resumeLocalIndependentAnalyses } from "./independent-scene-analysis";
import { taskErrorDetails } from "./task-diagnostics";

type Scheduler = { stop: () => void };
const runtime = globalThis as typeof globalThis & { localAnalysisScheduler?: Scheduler };

export function startLocalAnalysisScheduler(): Scheduler | undefined {
  if (process.env.NODE_ENV !== "development" || process.env.COMMERCIAL_SCENE_JOB_EXPERIMENT !== "true"
    || !process.env.COMMERCIAL_SCENE_JOB_TEST_USER_IDS || !process.env.CRON_SECRET) return;
  // Require an explicit loopback target so this scheduler cannot wake a deployed service.
  let target: URL;
  try { target = new URL(process.env.LOCAL_ANALYSIS_BASE_URL || ""); } catch { return; }
  if (target.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(target.hostname) || target.username || target.password) return;
  if (runtime.localAnalysisScheduler) return runtime.localAnalysisScheduler;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;
  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(tick, 15_000);
    timer.unref();
  };
  const tick = async () => {
    try { await resumeLocalIndependentAnalyses(); }
    catch (error) { console.error("commercial.scene.local_scheduler_failed", { error: taskErrorDetails(error) }); }
    finally { schedule(); } // Schedule after completion; slow scans must not overlap.
  };
  const scheduler = { stop: () => {
    stopped = true;
    clearTimeout(timer);
    if (runtime.localAnalysisScheduler === scheduler) delete runtime.localAnalysisScheduler;
  } };
  runtime.localAnalysisScheduler = scheduler;
  schedule();
  return scheduler;
}
