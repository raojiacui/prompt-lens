export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NODE_ENV === "development") {
    const { startLocalAnalysisScheduler } = await import("./lib/billing/local-analysis-scheduler");
    startLocalAnalysisScheduler();
  }
}
