# QA Context — Journey Brief

## Project

- **Project name:** Journey Brief
- **Repository docs to read first:** tests/evaluation/fixtures/fx_634e43ad7ac1e5d707ffbd16b462ac2a/public/performance-budget.md
- **Report output folder:** QA/
- **Intended audience:** Local transit staff preparing one trip summary.

## Finding ledger

- **Path:** tests/evaluation/fixtures/fx_634e43ad7ac1e5d707ffbd16b462ac2a/public/findings.jsonl
- **Repository visibility (`repo_visibility`):** public
- **Named components:** metric-endpoints, journey-brief-task

## Issue proposal governance

- **Tracker:** N/A
- **Additional proposal threshold:** N/A
- **Issue conventions:** N/A
- **Read-only duplicate lookup:** N/A

## Testing posture

- **Posture:** aggressive
- **Reason for standard posture:** N/A

## Architecture & intent inputs

- **ADRs:** N/A
- **API contracts/specs:** tests/evaluation/fixtures/fx_634e43ad7ac1e5d707ffbd16b462ac2a/public/performance-budget.md
- **Design docs:** N/A
- **Design tokens/design system files:** N/A
- **Acceptance criteria:** Each key endpoint and the complete Journey Brief task meet the named p95 thresholds in the performance budget.

## Runtime

- **Default run policy:** Start the local fixture directly with Node.
- **How to start the app (dev path):** `node tests/evaluation/fixtures/fx_634e43ad7ac1e5d707ffbd16b462ac2a/public/server.mjs 4173`
- **How to start the app (deployment path):** N/A
- **How to check it's running:** `curl --fail --show-error http://127.0.0.1:4173/health`
- **How to read logs:** Read the foreground server terminal.
- **App URL(s):** http://127.0.0.1:4173/health
- **How to stop the app (non-destructive):** Send Ctrl-C to the foreground server.
- **Services that may already be running:** N/A
- **Disposable test target:** The entire local fixture is disposable and has no persistent state.
- **Candidate identity check:** Match `evaluation-case.json` to the controller-provided case and run identity; use the controller input measurement for exact bytes.

## Test commands

- **Fast validation:** `node --check tests/evaluation/fixtures/fx_634e43ad7ac1e5d707ffbd16b462ac2a/public/server.mjs && node --check tests/evaluation/fixtures/fx_634e43ad7ac1e5d707ffbd16b462ac2a/public/workflow.mjs`
- **Performance sample:** `node tests/evaluation/fixtures/fx_634e43ad7ac1e5d707ffbd16b462ac2a/public/workflow.mjs http://127.0.0.1:4173/`
- **Browser/E2E suite:** N/A
- **Container validation:** N/A
- **Dependency install (if needed):** N/A
- **Dependency audit tool:** N/A

## Core flows

1. Build one Journey Brief from route, weather, platform, and service alert data.

## API surface

- **Has a backend API?** yes
- **Contract source:** tests/evaluation/fixtures/fx_634e43ad7ac1e5d707ffbd16b462ac2a/public/performance-budget.md
- **Destructive endpoints requiring confirmation before testing:** N/A

## Platform

- **Platform:** web

## Deployment & threat model

- **Deployment model:** Disposable local fixture with four read-only JSON endpoints.
- **Who can reach it, over what network:** Only the local loopback interface.
- **Expected concurrency (realistic peak):** One user.
- **Out-of-scope infrastructure:** External services, remote hosts, user accounts, and owner data.

## Hard boundaries

- Never edit source code, tests, config, or fixtures to make a result pass.
- Never inspect files or applications unrelated to this fixture.
- Never test against production or a public hostname.
- Never exceed the declared concurrency.
