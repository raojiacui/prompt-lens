# Security hardening: 2026-10-02

## Implemented

- All 36 application tables are server-only: RLS enabled, old policies removed,
  privileges revoked from PUBLIC, anon and authenticated. Verification codes,
  sessions, API keys, histories, wallets and payment records are included.
- Administration still requires the verified, unbanned owner account
  `raojiacui@gmail.com`, not a supplied role or configured user ID. Generic
  Better Auth administration endpoints remain blocked. Credit grants require
  a same-origin request.
- Anonymous account creation is disabled. Unverified, anonymous and banned
  accounts cannot reserve platform trials. Successful trials remain limited
  to two, including concurrent reservations. Failed tasks return allowance.
- Self-service account deletion is disabled to prevent trial reset through
  delete/re-register and cascading deletion of financial records. Account
  deletion requests must be handled through support with record retention.
- Ordinary feature key resolution defaults to BYOK only. Paid platform analysis
  explicitly opts in and still reserves/deducts allowance before provider calls.
- Video provider clients never read an environment key implicitly when their
  caller omits a key. Key decryption failures cannot silently use platform keys
  for non-administrators.
- API keys must be encrypted at rest. Reads are masked and private/no-store;
  writes and deletion require same-origin requests. User IDs come from the
  authenticated session, not request input.
- History reads remain scoped to the current user, are private/no-store and
  have bounded pagination. Remix source versions must belong to the owned
  target project before any scenes are read or models called.
- Deferred audio analysis, audio clipping and video editing POST endpoints
  return 410 without fetching media or calling a provider. Historical GET
  handlers remain available to their owners. Deferred implementation code is
  not exported as an endpoint.
- Replacement assets have a 15 MB limit, MIME/extension checks, a per-account
  rate limit, same-origin checks and user-specific storage namespaces.
- Clean database migrations no longer fail from duplicated video-generation
  table creation. Migration 0022 adds the authentication session compatibility
  field required by the patched authentication dependency.
- Runtime authentication, framework, HTTP clients and storage SDKs were updated;
  the test runner was also patched.

## Database and release state

- Migrations 0021 and 0022 were applied transactionally to the database configured
  in the current workspace. Public-role table access was checked after 0021.
  Direct application of these idempotent migrations does not update Drizzle's
  migration journal in that database; normal migration execution may rerun them.
- All 178 existing API-key records matched the encrypted storage format. No key
  values were output. This format check is not a full decryption/rotation audit.
- No public SECURITY DEFINER functions were found in that database.
- Code changes are local commits on `prompt-lens-V2`, not a deployed application
  patch. Production must receive and deploy these commits before its API behavior
  changes. Restart the existing local development process after dependency updates.

## Verification

- 355 tests across 49 files passed, including database role denial, concurrent
  trial limits, private key/history query filters, remix ownership, disabled
  media routes, upload boundaries and provider calls with missing keys.
- TypeScript checking passed after aligning the storage SDK and signing library.
- Tests used isolated databases and mocks; no paid KIE or EasyDown calls were made.
- A production build and two real authenticated-account browser sessions were not
  run in this pass. Existing local development service was not restarted.
- Final dependency audit: 0 critical, 25 high, 64 moderate and 5 low advisories.
  These are dependency-graph findings, not 94 proven exploitable application bugs.
  Optional peers and development-tool paths need separate reachability analysis.

## Remaining launch blockers

1. Media privacy: current R2 helpers and worker output use public URLs. Account
   API isolation does not make those URLs private. Anyone who obtains a public
   media URL may be able to view it without logging in. Private storage, owner-
   authorized playback/download and short-lived provider URLs must be implemented
   together, then public bucket/domain access disabled. Do not disable it alone:
   current playback and model media fetching depend on it.
2. Triage and patch remaining high dependency advisories on reachable runtime
   paths, particularly email/payment integrations, before launch approval.
3. Deploy the application patch and verify with two real accounts that histories,
   projects, keys, task polling and admin endpoints reject cross-account access;
   verify that an exhausted unpaid trial cannot start a provider call.

This is a scoped hardening and regression pass, not a guarantee that the entire
repository or its deployed infrastructure has no remaining vulnerabilities.
