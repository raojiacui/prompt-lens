-- These tables are accessed only through the server-side PostgreSQL connection.
-- Block direct Supabase Data API access even if a public API key is available.
ALTER TABLE "agent_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agent_steps" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agent_tool_calls" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agent_artifacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "projects" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "project_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reference_videos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "video_scenes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "scene_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workflow_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "project_assets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_credits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "credit_ledger" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "commercial_wallets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "commercial_reservations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "commercial_ledger" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "commercial_lots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "commercial_allocations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "commercial_refunds" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "commercial_tasks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "daily_visits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "trial_analysis_usage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "trial_analysis_reservations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "api_rate_limits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "media_cleanup_jobs" ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE
  "agent_runs",
  "agent_steps",
  "agent_tool_calls",
  "agent_artifacts",
  "projects",
  "project_versions",
  "reference_videos",
  "video_scenes",
  "scene_versions",
  "workflow_jobs",
  "project_assets",
  "user_credits",
  "credit_ledger",
  "payment_orders",
  "commercial_wallets",
  "commercial_reservations",
  "commercial_ledger",
  "commercial_lots",
  "commercial_allocations",
  "commercial_refunds",
  "commercial_tasks",
  "daily_visits",
  "trial_analysis_usage",
  "trial_analysis_reservations",
  "api_rate_limits",
  "media_cleanup_jobs"
FROM anon, authenticated;
