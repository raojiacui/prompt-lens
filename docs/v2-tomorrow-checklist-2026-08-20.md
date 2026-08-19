# V2 Next Development Checklist - 2026-08-20

## Worker / Module Boundaries

| Worker / Module | Scope | Acceptance Criteria | Recommended Validation |
| --- | --- | --- | --- |
| Cloud Run Worker QA | Deploy and smoke-test `workers/ffmpeg-worker` | `/healthz` returns ok; `/breakdown` handles 6s and 30-60s videos; R2 URLs are public and playable | Worker curl smoke test; app breakdown through `/api/workflow/projects/:id/breakdown` |
| Scene Analysis QA | Validate real OpenRouter output on varied reference videos | JSON fields are concise, useful, and mapped to story/visual/audio/transition/prompt without fallback | Upload 3 sample videos; inspect scene cards; retry one failed scene |
| Generate QA | Validate linked generation status writeback | Scene sent to Generate stores project/scene/version; status polling writes `generated_video_url` to the matching scene version | Generate one scene; poll status; inspect DB row and UI |
| UI Polish | Improve dense scene-card ergonomics after real samples | Long story/visual text remains readable; buttons do not overflow; mobile layout stays usable | Local browser smoke test and screenshots after user starts server |
| Worker Observability | Add deploy/runbook notes and log fields | Worker logs include project key, scene count, ffmpeg failure reason, upload failure reason | Cloud Run logs during smoke test |
| Lint Debt | Clean existing warnings in focused passes | Warning count drops without broad refactors or behavior changes | `pnpm lint` warning count comparison |

## Constraints

- Do not push until explicitly requested
- Do not start local dev server unless the user asks; user will start it locally
- Keep Original versions immutable; Remix and scene rewrite must update only the selected version/scene version
- Keep BYOK, KIE, OpenRouter, and FFmpeg worker secrets server-side only
- Keep FFmpeg Worker as a separate deployable app under `workers/ffmpeg-worker`
- Scene analysis failures must stay isolated to the scene and remain retryable

## Acceptance Checklist

- [ ] Apply DB migrations including `0005_v2_workflow.sql` and `0006_generation_workflow_links.sql`
- [ ] Configure app env: `FFMPEG_WORKER_URL`, `FFMPEG_WORKER_SECRET`, `BYOK_ENCRYPTION_KEY`, and KIE/OpenRouter keys as needed
- [ ] Deploy worker with `WORKER_SECRET` matching app `FFMPEG_WORKER_SECRET`
- [ ] Upload a short reference video and verify multiple scenes/keyframes/audio where applicable
- [ ] Create a remix and verify Original is unchanged
- [ ] Retry one fallback scene after configuring OpenRouter
- [ ] Send a scene to Generate and verify generated URL writes back to the linked scene version

## Recommended Commands

```bash
pnpm exec tsc --noEmit
pnpm test -- --run
pnpm lint
pnpm build
```

Worker local smoke test after installing Docker or running the container:

```bash
curl http://localhost:8080/healthz
curl -X POST http://localhost:8080/breakdown \
  -H "Authorization: Bearer $WORKER_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"videoUrl":"https://signed-video-url"}'
```
