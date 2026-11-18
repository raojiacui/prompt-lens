# Dynamic AIGC safety policy and review audit (test branch only)

Waffo's AIGC merchant-review checklist requires a maintained keyword policy and retained automated/human review decisions:
https://docs.waffo.ai/zh/mor/account-reviews/aigc-compliance

## Setup

- Apply `drizzle/0026_moderation_controls.sql` against the **isolated test database only**, after reviewing the target DATABASE_URL in the deployment provider. The production project and database must not be changed by this test rollout. The migration is also registered in the Drizzle journal.
- The test project's identity is locked to `prj_wGvOLlXsOzpVUGZiK3spsAIxXAjI`. Outside it, moderation-management routes return 404 and the new dynamic term gate is disabled.
- Open Dashboard → Administration → Content moderation. Admin endpoints use owner verification and same-origin CSRF protection for mutations.
- Edit phrase/category/action/status/notes, or add new terms as the policy changes. Disabled rules remain in the database; revision and actor are written to append-only audit records. Changes take effect for new prompt checks without redeployment.
- Only the signed-in site administrator can view the records, and the UI is limited to recent entries. Manual review writes a separate audit annotation and **does not unblock** held outputs automatically.
- Maintain the wordlist intentionally; do not treat the initial seed as complete. Review copyright characters/brands and proper names contextually instead of blocking all innocuous mentions. Keep a dated process for updating rules, adjudicating false positives, and evaluating policy coverage.

## Event handling and privacy

Database setup verified on 2026-11-18: the isolated test database has both moderation tables and 11 initial terms. Migration 0026 enables RLS and revokes direct access from PUBLIC, anon and authenticated; application access stays server-side. See ADR 0069 for evidence and pending end-to-end checks.

- The test project runs local dynamic phrase checks before mandatory Waffo Prompt Sift, while retaining Waffo semantic enforcement. A local `review` or `block` result stops generation immediately.
- Successful or failed Waffo prompt checks and Google-generated-video review verdicts are logged to `moderation_records`. Known user identity and task IDs are attached where available. For text, only the SHA-256 fingerprint is retained; no raw prompts, video URLs, API keys or provider raw response bodies are stored.
- The new audit table is append-only through application endpoints. Database administrators should limit delete/update access to backups and maintenance.
- A database outage at prompt-check time is fail-closed. On output checks, a failed audit write prevents a new approval transition. Note that existing approved results and historical tasks require separate reconciliation and may predate this audit system.
- The seeded terms are indicative, not a certification. A literal keyword list cannot reliably determine IP infringement, impersonation context, violence, audio risk or consent. Waffo's policy also prohibits certain **product features**, which no scanner alone can make compliant.
- Create a retention policy for safety audit metadata, and protect reviewer notes against storing raw personally identifying content. Manually record reviews with minimal explanations.

## Testing/verification before making the rollout public

1. Validate the migration in the isolated test database. Check indexes and that no shared production tables changed.
2. Run `npm test -- --run tests/waffo-prompt-scan.test.ts tests/moderation-controls.test.ts tests/video-output-moderation.test.ts`, TypeScript checks and production build.
3. With admin signed in, add a term, edit its category/action, disable it, refresh and confirm its revision and audit records.
4. Test both Waffo allow/block/review and local block/review. A database failure must **not** silently approve generation.
5. Test the async Google operation states and failures; do not reveal unreviewed video URLs.
6. Audit missing records, retry behavior, personally identifying data in logs, and the scope of the automated detectors against the Waffo checklist.
7. Confirm user reports, ongoing policy reviews and a manual escalation owner are operational. This implementation alone does **not** certify compliance.
