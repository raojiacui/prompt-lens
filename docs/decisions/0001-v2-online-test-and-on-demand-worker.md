# ADR 0001: Isolated V2 online test and on-demand worker

- Status: Accepted; infrastructure deployed and lifecycle verified
- Date: 2026-10-22
- Owners: Prompt Lens project team

## Context

Prompt Lens V2 needs realistic online testing before it is promoted to the live `prompt-lens.cc.cd` site. The existing Vercel Hobby plan cannot run a cron job every minute. Keeping a Fly worker running continuously would consume compute while there are no jobs. A daily Vercel cron remains useful as a delayed safety net, but it does not provide acceptable recovery latency for active media-processing jobs.

The test environment must protect the live application, production users, production database, and paid provider credentials while still exercising the real deployment path.

## Decision

V2 will use a separate online test stack:

- Vercel project: `prompt-lens-v2-test`;
- Supabase project: `prompt-lens-v2-test`;
- Fly application: `prompt-lens-v2-worker`;
- stable test URL: `https://prompt-lens-v2-test.vercel.app`;
- the live Vercel project, domain, database, users, and worker stay unchanged.

The Fly worker uses an on-demand lifecycle:

1. Creating or recovering a media task calls the worker wake endpoint.
2. While awake, the worker runs reconciliation every minute.
3. After three consecutive successful scans find no remaining work, the worker suspends itself.
4. A later task wakes the worker again.
5. The daily Vercel cron remains a low-frequency recovery safety net.

The V2 test environment may reuse the existing R2 storage and SMTP credentials. It receives new isolated authentication, encryption, cron, and worker secrets. Production KIE, payment, OAuth, and other paid third-party credentials are not copied. KIE generation tests use the tester's BYOK credentials stored in the V2 test database.

The Vercel test project uses the Next.js framework preset and Node.js 22 LTS. Its serverless database connection uses the Supabase transaction pooler on port 6543 with prepared statements disabled by the connection mode. The direct Supabase database host is reserved for environments with IPv6 connectivity and administrative checks.

The Fly application has shared public IPv4 and public IPv6 ingress. Public ingress is required for Vercel to call the worker and for Fly Proxy to auto-start a suspended Machine. The application runs one Machine to prevent duplicate scheduler passes.

Deployment to this isolated stack does not publish V2 to the live site. Repository decision records remain local until the user explicitly requests a push.

## Alternatives considered

### Deploy V2 to the live Vercel project

Rejected because incomplete V2 behavior could affect the public domain and production users.

### Use the production database for online testing

Rejected because test accounts, jobs, migrations, and cleanup could alter production data or make test results ambiguous.

### Keep the Fly worker running continuously

Rejected because idle compute would add avoidable cost.

### Depend only on the daily Hobby cron

Rejected because failed or interrupted tasks could wait up to a day for recovery.

## Consequences

- Web, database, and worker changes can be tested without changing the live stack.
- The first job after suspension may wait for a short Fly machine cold start.
- Reusing R2 and SMTP reduces setup work but preserves operational dependency on those shared services. Random object keys and isolated database records limit cross-environment collisions.
- The extra Vercel, Supabase, and Fly resources require lifecycle tracking and cleanup after V2 promotion.
- Provider tests that require KIE need a tester-supplied BYOK key in the isolated database.
- Vercel deployments exclude local build caches, worktrees, package stores, temporary model weights, and local secret files through `.vercelignore`.

## Verification plan

- Confirm the V2 URL loads and authentication email delivery works.
- Apply the current schema only to the V2 Supabase project and verify production remains unchanged.
- Confirm `GET /healthz` succeeds on `prompt-lens-v2-worker`.
- Create a test task and confirm the worker wakes, reconciles once per minute, and reports scheduler health.
- Confirm three successful empty scans suspend the worker.
- Create another task and confirm the suspended worker resumes.
- Confirm the V2 environment contains only the approved shared R2 and SMTP credentials plus newly generated isolated secrets.
- Confirm no deployment targets `prompt-lens.cc.cd` or the production worker.

## Operational follow-up

- Revisit the daily safety-net schedule if the Vercel plan changes.
- Remove or archive the test resources after V2 promotion when they are no longer needed.

## Verification results

Verified on 2026-10-22:

- all 25 schema migrations were applied to the isolated Supabase project and the resulting 38 public tables have RLS enabled;
- the Vercel project built successfully with the Next.js preset on Node.js 22 and the stable test URL returned HTTP 200;
- `GET /api/commercial/config` returned HTTP 200 from the deployed test site;
- the Vercel runtime reached Supabase through the transaction pooler and the commercial reconciliation endpoint returned HTTP 200;
- the Fly worker health endpoint returned HTTP 200 and exposed successful scheduler state;
- an authenticated public wake request resumed the suspended Machine and immediately scheduled reconciliation;
- three consecutive successful empty reconciliation passes changed the Machine state to `suspended`;
- a later public wake request changed the Machine state back to `started` and reconciliation succeeded again;
- the Fly application has exactly one Machine;
- the production domain and production Vercel project were not deployment targets.

Authentication email delivery, BYOK provider generation, and end-to-end user workflows remain product-level test cases for the online test environment.
