-- Application data is accessible only through the privileged server connection.
DO $security$
DECLARE
  app_table text;
  api_role text;
  policy_name text;
BEGIN
  FOREACH app_table IN ARRAY ARRAY[
    'user','session','account','verification','user_api_keys','analysis_history',
    'operation_logs','daily_visits','audio_analysis','video_clip','video_generation',
    'user_credits','credit_ledger','payment_orders','agent_runs','agent_steps',
    'agent_tool_calls','agent_artifacts','projects','project_versions','reference_videos',
    'video_scenes','scene_versions','workflow_jobs','project_assets','commercial_wallets',
    'commercial_reservations','commercial_ledger','commercial_lots','commercial_allocations',
    'commercial_refunds','commercial_tasks','trial_analysis_usage','trial_analysis_reservations',
    'api_rate_limits','media_cleanup_jobs'
  ] LOOP
    IF to_regclass(format('public.%I', app_table)) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', app_table);
    FOR policy_name IN SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = app_table
    LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', policy_name, app_table);
    END LOOP;
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC', app_table);
    FOREACH api_role IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
        EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM %I', app_table, api_role);
      END IF;
    END LOOP;
  END LOOP;
  FOREACH api_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', api_role);
    END IF;
  END LOOP;
END
$security$;
