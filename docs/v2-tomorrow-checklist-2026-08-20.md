# V2 Tomorrow Development Checklist - 2026-08-20

## Worker Boundaries

| Worker / Module | Scope | Acceptance Criteria | Validation |
| --- | --- | --- | --- |
| FFmpeg Worker | Implement real Cloud Run `/breakdown` service | Accepts signed video URL, validates bearer secret, runs ffprobe, detects shot boundaries, splits scenes, extracts keyframes/audio, returns scene assets | Worker unit test with 6s and 30-60s videos; API smoke test through `/api/workflow/projects/:id/breakdown` |
| Scene Analysis | Replace placeholder blueprint text with structured AI scene analysis | Each scene includes story, visual, camera, action, dialogue/audio placeholders, transition, and editable generationPrompt | Add service tests for JSON parsing and failed-scene retry behavior |
| Model Registry | Expand Registry-backed UI controls | Generate model selector uses `/api/models`; Auto Balanced visible as default, manual model mode available | TypeScript + UI smoke test |
| Project UI | Improve V2 workflow ergonomics | Scene cards use compact tabs/accordions for Overview, Visual, Audio, Prompt; partial scene failure shows Retry | Playwright screenshot check after local run |
| Remix | Add structured per-scene remix logic | Remix V1 modifies scene story/prompt without changing Original; single-scene AI edit can update only that scene | Unit tests for version creation and non-overwrite behavior |
| Generate Handoff | Persist workflow metadata in generation records | `projectId`, `sceneId`, and `versionId` survive Generate submission and status lookup | DB schema/API test or route-level smoke test |

## Constraints

- Do not rewrite existing Analyze, Generate, Audio, or Edit tools; keep them independently usable
- Keep AI calls server-side only; never expose full BYOK values to the browser
- Keep Cloud Run URL and secret server-side only
- Do not hardcode model selection in page components as the source of truth; use Model Registry
- Preserve Original versions; Remix must create new versions
- Scene failures must not invalidate the whole project

## Recommended Validation Commands

```bash
pnpm exec tsc --noEmit
pnpm test -- --run
pnpm lint
pnpm build
```

## Suggested Next Order

1. Implement the real FFmpeg Worker `/breakdown` contract
2. Add route/service tests for project breakdown and scene prompt update
3. Replace placeholder scene blueprint generation with structured AI analysis
4. Add Retry UI/API for failed scene analysis
5. Persist project/scene/version metadata through video generation jobs