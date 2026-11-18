# V2 Google Cloud Video Intelligence output moderation (test project only)

This replaces Sightengine in the `prompt-lens-v2-test` deployment. The main production project is unchanged. Waffo Prompt Sift still audits user-authored video generation prompts before a model is called.

## Google Cloud setup (required before live verification)

1. Create/select a Google Cloud project and enable **Video Intelligence API**; confirm billing/quota settings. Google Cloud may charge beyond free monthly usage.
2. Create a service account with the least permissions required for Video Intelligence and (when used) Cloud Storage. Generate a JSON key and add it directly to **Vercel > prompt-lens-v2-test > Settings > Environment Variables > Production**, as `GOOGLE_VIDEO_MODERATION_SERVICE_ACCOUNT_JSON`. Never commit or paste the key into a chat or log.
3. Create a private Google Cloud Storage bucket for moderate-to-large videos. Grant the service account object create/read/delete permissions, and set a short lifecycle TTL for `prompt-lens-test-output-review/` (for example delete after 1 day). Set `GOOGLE_VIDEO_MODERATION_GCS_BUCKET` to its name in the test environment.
4. Redeploy **only** `prompt-lens-v2-test`. Do not configure these credentials for the main project until a separately approved production rollout.
5. Confirm privacy wording and data transfers for Google Cloud Video Intelligence in the test site's policy.

The implementation uploads the video bytes directly as `inputContent` for small files, or temporarily uploads a larger video to the private GCS bucket and submits `gs://` for analysis. It **never** gives a raw user-supplied URL to Google as an arbitrary fetch target. To bound memory and requests, the current server-side implementation refuses videos larger than 50 MiB; these remain withheld for review. Videos larger than the inline threshold need the bucket. Do not rely on this first iteration for larger video workflows.

## Behavior

- Google Video Intelligence `EXPLICIT_CONTENT_DETECTION` reviews *visual adult content only*. It cannot reliably detect violence, copyright infringement, trademark misuse, non-consensual deepfakes, hateful content or unsafe spoken audio. A passing result is **not** Waffo-wide AIGC compliance.
- The Google API is asynchronous: submission yields an operation, and the original video URL stays hidden until polling retrieves a completed result.
- Every returned frame must be `VERY_UNLIKELY` or `UNLIKELY` for an automatic allow. `POSSIBLE`, unknown and missing evidence require human review. `LIKELY` and `VERY_LIKELY` are held as blocked.
- Invalid responses, missing credentials, unavailable operations, API failures or timeouts are **fail-closed**: the generated URL is not shown. After 30 minutes of unresolved polling, route to human review.
- Both BYOK and paid video-generation deliveries must pass the release gate. Existing stage `reviewing_output` remains in the progress UI.
- Avoid logging credentials, full user prompts, video URLs, Google raw responses or video content; do not include any in errors sent to the client.
- The temporary GCS object is deleted after a terminal moderation result on a best-effort basis; the short GCS lifecycle policy is the backstop.

## Verification

1. Run TypeScript type-check, output moderation tests and production build.
2. Test approval, rejection, review, invalid frame likelihoods, provider failures, operation polling, duplicate polling, timeout, and missing credentials.
3. Confirm video URLs are not exposed through job status, generation history, paid reconciliation or workflow outputs before explicit approval.
4. Run one real harmless generated video and a safe synthetic test sample through the Google Cloud integration after configuring credentials.
5. Audit coverage against Waffo's AIGC policy and supplement adult-content scanning with appropriate rules and human review. Do not advertise this visual-only classifier as complete copyright/deepfake monitoring.

## API references

- https://docs.cloud.google.com/video-intelligence/docs/feature-explicit-content
- https://docs.cloud.google.com/video-intelligence/docs/reference/rest/v1/videos/annotate
- https://docs.cloud.google.com/video-intelligence/quotas
