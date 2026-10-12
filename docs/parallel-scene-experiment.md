# Independent scene analysis experiment

The baseline is `prompt-lens-V2` at `ea79fb5264caefce385b292fd5f9864a2d08ebad`.
The experiment runs on `codex/parallel-scene-analysis` in a separate worktree. The
existing checkout and its uncommitted `next-env.d.ts` change are untouched.

The feature is off unless `COMMERCIAL_SCENE_JOB_EXPERIMENT=true` and the user's
ID is listed in `COMMERCIAL_SCENE_JOB_TEST_USER_IDS`. These settings affect new
quotes only. Existing experimental jobs continue to run when the flag is off.
Each video can run at most two scene inferences concurrently. Experimental
requests with one KIE key share a PostgreSQL limit of four active leases and
15 starts per ten seconds. A request with an unknown provider outcome keeps
its lease until expiry. Existing serial and generation traffic is not counted
by this experimental limiter, so real account-wide capacity still needs
measurement before paid rollout.

## Safe rollback

1. Turn off `COMMERCIAL_SCENE_JOB_EXPERIMENT` to stop creating new jobs.
2. Keep the experimental worker and cron running until all existing jobs have
   finished, and reconcile any task in review before changing the deployed code.
3. Check the production database:

   ```sql
   SELECT state, count(*) FROM analysis_scene_jobs
   WHERE state IN ('queued', 'running') GROUP BY state;

   SELECT state, count(*) FROM commercial_tasks
   WHERE input->>'executionMode' = 'scene_jobs_v1'
     AND state IN ('queued', 'running', 'review') GROUP BY state;

   SELECT count(*) FROM commercial_reservations r
   JOIN commercial_tasks t ON r.task_key = 'commercial:' || t.id::text
   WHERE t.input->>'executionMode' = 'scene_jobs_v1' AND r.state = 'held';
   ```

4. Return to `prompt-lens-V2` only when all three checks are empty or zero.
   Leave the additive database migrations in place. Do not reset or overwrite
   the original checkout.

No real paid two-lane test is approved by these local checks. Compare the same
video and model under serial, independent single-lane, and two-lane modes
after mock concurrency, fault injection, and account-wide rate behavior pass.
