# QA Context - project configuration

Every QA agent reads this file before doing anything. This example is filled for
a small self-hosted web app that normally runs through Make, can be validated
through Docker Compose, and is reachable only over a VPN.

## Project

- **Project name:** PantryBoard
- **Repository docs to read first:** AGENTS.md, README.md, docs/deployment.md
- **Report output folder:** QA/
- **Intended audience:** general consumers — household members comfortable with everyday web apps, no technical background assumed

## Testing posture

- **Posture:** aggressive
- **Reason for standard posture:** N/A

## Architecture & intent inputs

Optional source-of-truth documents. Use `N/A` when a project has none.

- **ADRs:** docs/adr
- **API contracts/specs:** docs/openapi.yaml
- **Design docs:** docs/design.md
- **Design tokens/design system files:** N/A
- **Acceptance criteria:** N/A

## Runtime

- **Default run policy:** prefer `make run` (dev path) for routine QA; use Docker Compose only when the task is explicitly deployment/container QA or a release audit
- **How to start the app (dev path):** make run
- **How to start the app (deployment path):** docker compose up --build -d
- **How to check it's running:** docker compose ps; curl -f http://localhost:8787/health
- **How to read logs:** docker compose logs --tail 80 web
- **App URL(s):** http://localhost:8787
- **How to stop the app (non-destructive):** docker compose down
- **Services that may already be running:** local Postgres on 5432, Tailscale daemon, Caddy reverse proxy
- **Disposable test target:** make run-qa — fresh throwaway Compose stack on http://localhost:8788 with a seeded demo household and its own uniquely named Postgres data directory; agents may freely add, apply, and delete data there; stop non-destructively with make stop-qa

## Test commands

- **Fast validation:** make check
- **Browser/E2E suite:** npm run test:e2e
- **Container validation:** make docker-test
- **Dependency install (if needed):** npm ci; npx playwright install chromium webkit firefox
- **Dependency audit tool:** npm audit

## Core flows

List the user-facing flows agents should exercise. bob-qa tests all of them;
regression-qa tests the ones touched by a diff; compatibility-qa reuses this
list for its matrix.

1. Create a household invite and accept it from a second browser profile.
2. Add, edit, complete, and delete a grocery item.
3. Search and filter pantry items by category and expiration state.
4. Change theme, timezone, and notification preferences.
5. Export the current grocery list as CSV.

## API surface

- **Has a backend API?** yes
- **Contract source:** docs/openapi.yaml
- **Destructive endpoints requiring confirmation before testing:** DELETE /api/households/{id}, DELETE /api/items/{id}

## Platform

- **Platform:** web

## Deployment & threat model

- **Deployment model:** self-hosted homelab behind VPN
- **Who can reach it, over what network:** household members over Tailscale only; no public internet exposure intended
- **Expected concurrency (realistic peak):** 2-5 users
- **Out-of-scope infrastructure:** production mini PC, NAS backups, router, Caddy admin API, remote Tailscale ACLs

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
  each affected flow `Observed only` and never report it as passed or
  effective. Append the qualifier to a Go-family lane verdict; for `No-Go`
  or `Blocked`, retain the canonical first-line state and propagate the
  observed-only flow to the final summary.
- Never inspect files, browser data, or applications unrelated to the app
  under test.
- Never test against production or a public hostname unless the user
  explicitly scopes it and confirms authorization.
- If a service was already running before the agent started, identify it and
  prefer not to disturb it.
