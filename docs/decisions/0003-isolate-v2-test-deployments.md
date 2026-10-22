# ADR 0003: Isolate V2 test deployments from the live Vercel project

- Status: Accepted
- Date: 2026-10-22
- Owners: Prompt Lens project team

## Context

Prompt Lens V2 needs a stable online environment before it replaces the existing live product. The repository branch `prompt-lens-V2` was deployed to the existing `prompt-lens` Vercel project as a production deployment on 2026-10-22. That deployment caused `prompt-lens.cc.cd` to serve the unreleased V2 interface.

The live project was rolled back to deployment `dpl_HvZt8Wy8rLr4T4PmqGDuZq9QPTk5`, created on 2026-10-19. Vercel confirmed that `prompt-lens.cc.cd`, the project production URL, and the `main` branch URL all point to that restored deployment.

## Decision

- The existing Vercel project `prompt-lens` remains the live production project for `prompt-lens.cc.cd`.
- All V2 online testing uses the separate Vercel project `prompt-lens-v2-test` and its URL `https://prompt-lens-v2-test.vercel.app`.
- Deploying V2 with a production target is allowed only inside `prompt-lens-v2-test`; Vercel production targets are scoped per project.
- Before every V2 deployment, the project name or project ID must be checked explicitly. Commands and automation must not rely on an implicit Vercel project link.
- The `prompt-lens` project may receive a V2 deployment only when the team explicitly decides to release V2 to the live site.

## Alternatives considered

### Use branch preview deployments inside the live project

Preview deployments can support short reviews, but project-link mistakes and production promotions remain close to the live domain. They are insufficient as the only isolation boundary for ongoing V2 testing.

### Keep V2 local until release

Local testing cannot verify hosted callbacks, environment variables, background workers, authentication, or production-like network behavior.

### Use the live project with a temporary custom domain

This still shares the production project and increases the chance that a deployment or alias operation affects the live domain.

## Consequences

- The live site and V2 test site have separate deployment histories and stable URLs.
- V2 environment variables and access controls must be maintained on the test project.
- A deployment labelled `Production` in `prompt-lens-v2-test` remains a test deployment because the production designation is local to that Vercel project.
- Release promotion requires an explicit deployment to the `prompt-lens` project.

## Verification plan

- Inspect `https://prompt-lens.cc.cd` after any deployment work and confirm its deployment ID belongs to the intended live release.
- Inspect `https://prompt-lens-v2-test.vercel.app` and confirm it resolves through the `prompt-lens-v2-test` project.
- Confirm V2 deployments do not add or change aliases on the `prompt-lens` project.
- Record the live deployment ID before a future V2 production release so rollback remains immediate and unambiguous.
