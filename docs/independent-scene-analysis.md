# Independent scene analysis

All commercial analysis quotes and failed-shot retries use durable independent scene jobs.
There is no experiment flag or serial model execution path. Asset extraction creates the
parent checkpoint and scene jobs atomically. Each video runs at most two inferences at a
time; the shared PostgreSQL limiter permits four active leases per KIE key and 15 starts
per ten seconds. Unknown provider outcomes retain their leases until expiry.

Retries create jobs only for the selected failed shots. They reuse extracted assets and
update the existing scene versions. Settlement includes previous successes and deducts
previous charges, so successful shots and delivered splitting are never charged twice.

## Historical tasks

Unfinished serial tasks are adopted into the independent queue under the parent execution
lock. Completed shots become terminal jobs, saved model answers become recoverable scene
checkpoints, and stale unknown requests become failed checkpoints without resubmission.
This compatibility conversion does not execute the old inference path. Completed task
records, wallet history, and source media remain intact.

## Local operation

Set `CRON_SECRET`, an explicit loopback `LOCAL_ANALYSIS_BASE_URL`, and
`LOCAL_ANALYSIS_USER_IDS` for the development scheduler. The account list limits only local
background scans of a potentially shared database; it does not gate the analysis flow.
Production continues using the authenticated dispatch and reconciliation cron routes.
Migrations 0023 and 0024 must be applied before starting this version.

## Rollback

The old V2 code is preserved by `backup/v2-before-parallel-default-20261013`.
Before rolling code back, stop new submissions and finish or reconcile all queued/running
scene jobs and held analysis reservations. Leave the additive database tables in place.
Do not reset the database or discard saved checkpoints. Switching Git alone does not
roll back in-flight work or wallet state.

Generation and free-trial workflow tasks have separate billing and execution contracts;
they are not removed as part of replacing the commercial serial analysis path.
