# Waffo Prompt Moderation — branch-local integration

Status: implementation scaffold on a separate branch; NOT enabled in production.

## Server-side behavior
- Shared scanner: `lib/safety/waffo-prompt-scan.ts`.
- Strictly allow `action === "allow"`; `review`, `block`, unexpected responses, missing credentials, network faults, and rate limits are not permitted.
- By default `semantic: "off"` disables the optional semantic-scoring channel while **still running the required baseline keyword/policy prompt scan**. Only `action === "allow"` proceeds. Use `shadow` or `enforce` only after separate product review.
- Hooks added at **video-generation boundaries only** (not chat, LLM video analysis or prompt rewriting) to: `/api/video-generate`, `/api/generation-jobs`, commercial generation quote, and the Agent video tool.
- No raw prompt in scanner error logs, and no browser-side merchant credentials.
- The paid generation quote scans the user-authored prompt **before reference-video media copying**, then stores an immutable server-owned payload; confirmation uses that snapshot, rather than a new browser prompt.

## Required environment (server only)
```text
WAFFO_MERCHANT_ID=MER_...
WAFFO_PRIVATE_KEY=<RSA key in PEM format>
WAFFO_PROMPT_SCAN_ENABLED=false
```
Turn the flag on only in a dedicated test environment with working merchant credentials. Missing credentials intentionally fail closed once enabled.

## Validation before merging
1. Run `npm test -- --run tests/waffo-prompt-scan.test.ts`, `npx tsc --noEmit --incremental false`, and `npm run build`.
2. Test signed API requests using a test merchant and non-sensitive prompts; confirm exactly which API response envelope is returned.
3. Test direct-route calls, paid quote/confirm replay, multiple output batches, reference-video and Agent paths.
4. Confirm review/block/429/timeouts create no provider task and no credit deduction. Confirm request size constraints and disable leaking prompt text in error logs.
5. Scan the user-authored generation prompt exactly once per generation quote or direct submission. LLM rewriting itself is not a Waffo scan trigger; separately evaluate image/video input moderation if needed.
6. Review privacy disclosures and user-facing localized copy; handle false positives via customer support and avoid logging prompt text.

This branch does not modify payment settings or turn on purchases.
