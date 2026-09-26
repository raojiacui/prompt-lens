# V2 analysis execution

## Runtime

- R2 uploads are verified before a project is submitted.
- `POST /api/workflow/projects/:id/breakdown` creates an idempotent database task and returns HTTP 202 with `taskId`.
- Trial analysis always uses the platform KIE key and Gemini 3.8 Flash. BYOK tasks snapshot the selected model and key fingerprint; changing a key stops an existing task instead of changing its payer.
- Short trials and BYOK analysis remain available when commercial billing is enabled. Paid splitting and platform quotes use the commercial confirmation flow.
- Preparation, asset extraction, transcription, music recognition and each scene are separate persisted steps. Trials skip extra transcription/music calls.
- `GET /api/commercial/tasks/:id` reads progress for both ordinary and quoted analysis and schedules the next queued step. Reopening an analyzing project resumes polling from its saved task ID.
- The existing worker scheduler calls `/api/cron/commercial-reconciliation` to advance queued tasks after a browser closes. This now runs ordinary analysis even when commercial consumption is disabled.
- A worker that disappears for six minutes is recovered using saved results. Uncertain KIE inference is not automatically submitted again. Only delivered scenes are charged; undelivered reserved credits are returned.
- Failed scenes retain source media and error metadata, with an empty generation prompt. Partial completion is explicitly recorded.

## Deployment

1. Apply migrations through `0019_media_cleanup_jobs` before serving the updated application. `0017` adds trial reservations and shared rate limits; `0018` extends the task table and enforces one initial analysis task per project; `0019` adds retriable R2 cleanup. Run `pnpm db:check-v2` against the target database and set `COMMERCIAL_MIGRATION_ACCEPTED=0019` only after it passes. The older `0015` marker no longer enables commercial sales.
2. Configure the existing R2, `KIE_AI_API_KEY` (or `KIE_API_KEY`), `FFMPEG_WORKER_URL`, and `FFMPEG_WORKER_SECRET` settings. Video duration is checked by the worker, including short trials; client duration is used only for UI routing.
3. Keep `CRON_SECRET` identical on the web app and worker, and set `COMMERCIAL_RECONCILIATION_BASE_URL` on the worker to the web HTTPS origin. Its existing scheduler calls the reconciliation endpoint after each round, with a 60-second interval. Browser-independent progress requires that scheduler to be running.
4. Verify one trial, one BYOK request, a failed request, a closed-browser task, and shared-media project deletion using real services before enabling public traffic. Automated tests use isolated databases and mocked provider responses; they do not verify live keys or provider availability.

## Retired entry points

The unused `/api/analyze` and ordinary synchronous scene retry endpoint are removed. The agent retains a bounded single-call image/frame analyzer. Commercial retries retain their confirmed quote and only process failed scenes.

Pre-existing commercial quotes without a model snapshot keep their original 2.5 model. New platform Flash quotes snapshot Gemini 3.8 Flash; BYOK quotes accept an enabled analysis model from the registry.
