# QA Context — project configuration

Every QA agent reads this file before doing anything. Fill it in once per
project. If a field doesn't apply, write `N/A` — agents treat missing or N/A
fields as "not in scope" and will say so in their reports rather than
guessing.

## Project

- **Project name:** <!-- e.g. WorldClock -->
- **Repository docs to read first:** <!-- e.g. AGENTS.md, README.md -->
- **Report output folder:** QA/ <!-- should be gitignored; reports are local evidence -->
- **Intended audience:** <!-- optional; who the product is for, e.g. "general consumers", "network engineers" — lanes evaluating terminology/comprehension cite this; N/A ⇒ agents assume "general end user" and state the assumption -->

## Testing posture

- **Posture:** aggressive <!-- default; use "standard" only with a stated reason -->
- **Reason for standard posture:** N/A <!-- required when Posture is "standard" -->

## Architecture & intent inputs

Optional source-of-truth documents. Use `N/A` when a project has none.

- **ADRs:** <!-- e.g. docs/adr -->
- **API contracts/specs:** <!-- e.g. openapi.yaml, docs/api.md -->
- **Design docs:** <!-- e.g. docs/design.md -->
- **Design tokens/design system files:** <!-- e.g. tokens.json, src/styles/tokens.ts -->
- **Acceptance criteria:** <!-- e.g. issue link, docs/acceptance.md -->

## Runtime

- **Default run policy:** <!-- which path agents use when both exist, e.g. "prefer make run (dev path) for routine QA; use Docker Compose only when the task is explicitly deployment/container QA or a release audit" -->
- **How to start the app (dev path):** <!-- e.g. make run — or N/A if only one path exists -->
- **How to start the app (deployment path):** <!-- e.g. docker compose up --build -d -->
- **How to check it's running:** <!-- e.g. docker compose ps -->
- **How to read logs:** <!-- e.g. docker compose logs --tail 50 <service> -->
- **App URL(s):** <!-- e.g. http://localhost:8787 -->
- **How to stop the app (non-destructive):** <!-- e.g. docker compose down (never --volumes) -->
- **Services that may already be running:** <!-- anything agents must not disturb -->
- **Disposable test target:** <!-- optional; command/URL for a throwaway instance, seeded profile, or fresh-instance strategy agents may freely mutate, e.g. "make run-ephemeral (fresh SQLite under /tmp)" — N/A ⇒ mutation-dependent flows are reported as Observed only -->

## Test commands

- **Fast validation:** <!-- e.g. make check -->
- **Browser/E2E suite:** <!-- e.g. npm test (Playwright) -->
- **Container validation:** <!-- e.g. make docker-test -->
- **Dependency install (if needed):** <!-- e.g. npm ci; npx playwright install chromium webkit -->
- **Dependency audit tool:** <!-- e.g. npm audit -->

## Core flows

List the user-facing flows agents should exercise. bob-qa tests all of them;
regression-qa tests the ones touched by a diff; compatibility-qa reuses this
list for its matrix.

1. <!-- e.g. profile creation, switching, renaming, deletion, persistence -->
2. <!-- e.g. city search, filters, add/remove -->
3. <!-- e.g. preset preview, apply, cancel -->
4. <!-- e.g. theme and format settings -->
5. <!-- ... -->

## API surface

- **Has a backend API?** <!-- yes / no — if no, api-qa stops immediately -->
- **Contract source:** <!-- OpenAPI spec path, or "none — infer from frontend" -->
- **Destructive endpoints requiring confirmation before testing:** <!-- list or N/A -->

## Platform

- **Platform:** <!-- web / android / ios / desktop — selects the checklist file in references/platforms/ -->

## Deployment & threat model

- **Deployment model:** <!-- e.g. self-hosted homelab behind VPN / public SaaS / internal tool -->
- **Who can reach it, over what network:** <!-- e.g. Tailscale-only, LAN, public internet -->
- **Expected concurrency (realistic peak):** <!-- e.g. 2–5 users; sets performance-qa's default load -->
- **Out-of-scope infrastructure:** <!-- hosts/devices agents must never touch, e.g. production Pi, remote servers -->

## Hard boundaries (all agents, all projects)

These apply regardless of the fields above:

- Never delete volumes, databases, backups, or user data. No `--volumes`, no
  `rm -rf`, no resets.
- Never edit source code, tests, config, git history, issues, PRs, or
  releases to make a result pass. Report; don't fix.
- Never submit real credentials, tokens, personal files, or private
  identifiers into any page, form, or request.
- Complete mutation-dependent flows only against the **Disposable test
  target** above. If it is absent or `N/A`, do not mutate owner data: mark
  each affected flow `Observed only`, propagate the qualifier to the
  verdict, and never report that flow as passed or effective.
- Never inspect files, browser data, or applications unrelated to the app
  under test.
- Never test against production or a public hostname unless the user
  explicitly scopes it and confirms authorization.
- If a service was already running before the agent started, identify it and
  prefer not to disturb it.
