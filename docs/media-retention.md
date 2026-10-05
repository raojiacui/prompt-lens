# Seven-day Project Retention

Project source files, shot clips, keyframes, audio assets and analysis/rewrite
text expire seven days after the project's latest analysis completion or new
analysis/rewrite content. Viewing a project or changing its title does not renew
this period. Existing projects are covered as well as newly created projects.

Active analysis, generation, review and unexpired quotes postpone cleanup.
Expired projects remain as archived shells with an expiration marker. Prompt
copies in analysis task payloads are removed too. Payment orders, credit ledgers,
refunds and provider-hosted generated video results are not deleted.

Storage deletes use durable cleanup jobs. Shared file references and active task
references prevent deletion. Storage failures are retried with backoff. Project
expiration and creation of deletion jobs happen in one database transaction.

## Scheduling

- `/api/cron/media-retention` requires `Authorization: Bearer CRON_SECRET`.
- `?dryRun=1` reports a bounded eligible-project count without deleting anything.
- Each invocation expires up to 10 projects and attempts up to 50 file deletes.
- `vercel.json` schedules the dedicated endpoint daily at 19:00 UTC (03:00 Asia/Shanghai).
- The existing commercial reconciliation scheduler also invokes retention.
- Production scheduling becomes active only after deployment with `CRON_SECRET` configured.
  A committed config alone is not proof that the production scheduler is running.

For a local, hourly scheduler while the computer and local server are running:

```sh
node scripts/run-media-retention.mjs --once --dry-run
node scripts/run-media-retention.mjs
```

The runner loads the ignored `.env.local`, never prints the scheduler secret, and
defaults to `http://localhost:3000`. `MEDIA_RETENTION_BASE_URL` may point to a
configured remote HTTPS deployment. A local runner is not a production scheduler.

This implementation does not modify R2 bucket lifecycle rules. Independent bucket
rules must be checked separately: an object-age rule can remove files earlier
than project-level retention, and cannot honor active-task or shared-file checks.
