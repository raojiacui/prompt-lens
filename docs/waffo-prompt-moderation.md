# Waffo Prompt Moderation — branch-local integration

Status: implementation scaffold on a separate branch; NOT enabled in production.

## Server-side behavior
- Shared scanner: `lib/safety/waffo-prompt-scan.ts`.
- Strictly allow `action === "allow"`; `review`, `block`, unexpected responses, missing credentials, network faults, and rate limits are not permitted.
- By default `semantic: "shadow"` measures semantic risk without adding semantic enforcement; existing base scanner decisions are still enforced.
- Hooks added before provider submission to: `/api/video-generate`, `/api/generation-jobs`, commercial generation quote, and the Agent video tool.
- No raw prompt in scanner error logs, and no browser-side merchant credentials.
- The paid generation quote stores an immutable server-owned payload; confirmation uses that snapshot, rather than a new browser prompt.

## Required environment (server only)
```text
WAFFO_MERCHANT_ID=MER_...
WAFFO_PRIVATE_KEY=<RSA key in PEM format>
WAFFO_PROMPT_SCAN_ENABLED=false
```
Turn the flag on only in a dedicated test environment with working merchant credentials. Missing credentials intentionally fail closed once enabled.

## Validation before merging
1. Run `pnpm exec vitest run tests/waffo-prompt-scan.test.ts`, `pnpm exec tsc --noEmit --incremental false`, and `pnpm build`.
2. Test signed API requests using a test merchant and non-sensitive prompts; confirm exactly which API response envelope is returned.
3. Test direct-route calls, paid quote/confirm replay, multiple output batches, reference-video and Agent paths.
4. Confirm review/block/429/timeouts create no provider task and no credit deduction. Confirm request size constraints and disable leaking prompt text in error logs.
5. Review whether generated/rewritten prompts should get an additional scan, and separately evaluate uploaded image/video moderation.
6. Review privacy disclosures and user-facing localized copy; handle false positives via customer support and avoid logging prompt text.

This branch does not modify payment settings or turn on purchases.
