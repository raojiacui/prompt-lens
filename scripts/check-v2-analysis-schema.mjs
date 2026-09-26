import postgres from "postgres";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required to check the V2 analysis schema.");
  process.exitCode = 1;
} else {
  const db = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 10 });
  try {
    const [status] = await db`
      SELECT
        to_regclass('public.trial_analysis_usage') IS NOT NULL AS trial_usage,
        to_regclass('public.trial_analysis_reservations') IS NOT NULL AS trial_reservations,
        to_regclass('public.api_rate_limits') IS NOT NULL AS rate_limits,
        to_regclass('public.commercial_tasks') IS NOT NULL AS analysis_tasks,
        to_regclass('public.workflow_analysis_project_unique') IS NOT NULL AS analysis_unique_index,
        to_regclass('public.media_cleanup_jobs') IS NOT NULL AS media_cleanup
    `;
    const missing = Object.entries(status).filter(([, present]) => !present).map(([name]) => name);
    if (missing.length) {
      console.error(`V2 analysis schema is incomplete: ${missing.join(", ")}`);
      process.exitCode = 1;
    } else {
      console.log("V2 analysis schema is ready through migration 0019.");
    }
  } catch (error) {
    console.error("V2 analysis schema check failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await db.end();
  }
}
