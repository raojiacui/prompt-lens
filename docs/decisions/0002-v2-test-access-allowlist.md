# ADR 0002: Email allowlist for the V2 online test

- Status: Accepted
- Date: 2026-10-22
- Owners: Prompt Lens project team

## Context

The isolated V2 deployment is available on a public Vercel URL so realistic online testing can continue before the release reaches the live site. During this stage, product pages, user APIs, test data, and provider integrations must be available only to the two designated testers. The Vercel team owner's account does not match the requested test email, so Vercel team authentication would not express the required access list.

## Decision

The V2 test project will set `ACCESS_ALLOWED_EMAILS` to the two approved email addresses. When that variable contains at least one address:

- email matching is trimmed, case-insensitive, and exact;
- only allowlisted emails can request or redeem an email login code;
- social login is disabled to avoid an unverified path around the email gate;
- product pages and ordinary APIs require a signed Better Auth cookie cache whose user email is allowlisted;
- the login page remains public and first presents a test notice with a link to `https://prompt-lens.cc.cd`; approved testers can dismiss the notice and authenticate;
- cron, internal dispatch, and payment webhook routes remain reachable through their existing secret or signature authentication.

Deployments without `ACCESS_ALLOWED_EMAILS` retain the existing public sign-in behavior. This keeps the access restriction scoped to the isolated V2 test project and leaves the live site unchanged.

Approved testers at acceptance time:

- `raojiacuui@gmail.com`
- `raojinbo@gmail.com`

## Alternatives considered

### Vercel Authentication

Rejected for this test because it grants access through Vercel membership, while the requested tester email is not the current Vercel team member identity.

### Shared HTTP password

Rejected because it creates another credential to distribute and cannot identify which tester created a task.

### Restrict only the login form

Rejected because an existing session or a direct API call could bypass a form-only check.

## Consequences

- Both approved testers use the existing passwordless email-code flow.
- Unauthorized visitors are redirected to the login page and cannot call ordinary product APIs.
- Expired Better Auth cookie caches can require a brief return through the login page before an active session is refreshed.
- Operational callbacks keep working independently of browser sessions.
- Adding or removing a tester requires changing the test project's environment variable and redeploying.

## Verification plan

- Confirm an anonymous request to the V2 root redirects to `/login`.
- Confirm a non-allowlisted email receives HTTP 403 before an OTP email is sent.
- Confirm both allowlisted email addresses pass the access policy.
- Confirm social sign-in receives HTTP 403 while the allowlist is enabled.
- Confirm cron, internal dispatch, and payment webhook paths still reach their own authentication handlers.
- Confirm the same code with no allowlist variable retains the existing live-site behavior.
