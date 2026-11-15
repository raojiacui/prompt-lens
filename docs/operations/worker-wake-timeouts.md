# Worker wake timeout handling

The production workflow submission for project
`ab027c47-7d80-4595-8fe8-89ec0adf2161` logged
`commercial.reconciliation.wake_failed` at 2026-11-15 14:53:42 Asia/Shanghai.
The request to `/scheduler/wake` exceeded the application's 15-second timeout.
The same task continued through analysis dispatch and logged a successful model
return at 14:56:16. These logs do not establish whether Fly resume latency,
network delay, or service load caused the slow response.

## Behavior

- Wake notifications run in Next.js `after()`, after the submission response.
  Workflow analysis starts concurrently with its wake notification. Commercial
  confirmation routes also defer the notification; generation submission keeps
  its existing execution and acknowledgement semantics.
- Each wake attempt has a fresh 15-second abort signal. Timeout/network failures,
  HTTP 408, HTTP 429 and HTTP 5xx responses allow up to three total attempts,
  separated by one and two seconds. Permanent HTTP errors such as 401/403/404
  stop immediately. Failed wakes still resolve `false` rather than fail the task.
- Only `/scheduler/wake` is retried. No task creation, model request, payment,
  credit reservation or settlement is retried by this helper. Worker `wake()`
  resets the idle counter and requests another scan; existing task claims still
  control execution.
- Retry/success/final-failure events record attempt number and elapsed time.
  Failure diagnostics include error names and nested network codes with the
  existing secret/URL redaction. A recovered attempt emits a warning followed
  by success; `wake_failed` is emitted only after a terminal failure.

## Verification and rollout

Tests simulate the first request timing out, a successful retry, persistent
network failure, transient/permanent HTTP failures, missing configuration and
slow wakes concurrent with workflow/commercial submission. Existing analysis,
wallet, dispatch and worker scheduler regression tests cover task recovery and
settlement. All tests use mocks or isolated local databases, without live model
or payment calls.

Deploy the Web change through `prompt-lens-V2`. No Fly image, machine count,
secrets, idle policy or database schema change is required. After release,
correlate `wake_retry`, `wake_succeeded` and final `wake_failed` events with Fly
startup/request logs. Persistent failures still need infrastructure diagnosis;
bounded retries cannot guarantee recovery from an outage.
