# V2 output-video safety review (staging only)

This stage is independent of Waffo Prompt Sift. Waffo reviews user-authored text before video generation; this stage reviews the generated video itself before revealing its URL.

## Configuration

Sightengine Video Moderation Workflows: https://www.sightengine.com/docs/video-moderation-workflows

- Test project only: prj_wGvOLlXsOzpVUGZiK3spsAIxXAjI. The main project has not been changed.
- Required server-side variables on the test project's production environment: SIGHTENGINE_API_USER, SIGHTENGINE_API_SECRET (sensitive), SIGHTENGINE_WORKFLOW_ID (starts with wfl_).
- Configure appropriate content-safety rules in the Sightengine workflow. An empty workflow provides no meaningful safety review.
- This synchronous workflow is appropriate for videos under 60 seconds. For longer videos implement asynchronous moderation.
- Only an explicit summary.action = accept and status = success allows publishing.
- review/reject withhold the generated video URL and require follow-up. Timeouts, missing credentials, network failures or invalid payloads withhold the output and retry after a delay.
- The existing prompt scan and output scan are separate gates. The output stage is displayed after model generation and before result ready.
- Status and history API responses must not leak unapproved video links or provider raw payloads.
- Do not log user prompts, video URLs, API keys, or full response bodies.

## Verification checklist

1. Configure and enable the Sightengine workflow and three credentials in Vercel test-project environment. Redeploy before trying live output review.
2. Confirm harmless generated video reaches output review, Sightengine reports accept, then and only then UI displays result.
3. Mock reject, review, timeout, service failure, missing keys and repeated status polling; no unapproved links should appear.
4. Check BYOK and paid-generation output paths. Manual reviews must not automatically settle as a delivered product.
5. This is not a complete copyright-detection solution. Real-person deepfakes/copyright disputes may need additional checks and manual review.

No credentials should be committed to Git.