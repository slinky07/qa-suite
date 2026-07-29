# QA Context — Delivery Queue API

## Project

- **Project name:** Delivery Queue API
- **Repository docs to read first:** tests/evaluation/fixtures/fx_1b2e5dd833eae7bfc5fbb0de25053a5e/public/api-contract.json
- **Report output folder:** QA/
- **Intended audience:** Local clients that queue one synthetic delivery with safe retries.

## Finding ledger

- **Path:** tests/evaluation/fixtures/fx_1b2e5dd833eae7bfc5fbb0de25053a5e/public/findings.jsonl
- **Repository visibility (`repo_visibility`):** public
- **Named components:** delivery-api, delivery-idempotency

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
- **API contracts/specs:** tests/evaluation/fixtures/fx_1b2e5dd833eae7bfc5fbb0de25053a5e/public/api-contract.json
- **Design docs:** N/A
- **Design tokens/design system files:** N/A
- **Acceptance criteria:** An identical delivery retry with the same Idempotency-Key returns the original delivery and leaves exactly one queued delivery.

## Runtime

- **Default run policy:** Start the local fixture directly with Node.
- **How to start the app (dev path):** `node tests/evaluation/fixtures/fx_1b2e5dd833eae7bfc5fbb0de25053a5e/public/server.mjs 4311`
- **How to start the app (deployment path):** N/A
- **How to check it's running:** `curl --fail --show-error http://127.0.0.1:4311/api/deliveries`
- **How to read logs:** Read the foreground server terminal.
- **App URL(s):** http://127.0.0.1:4311/
- **How to stop the app (non-destructive):** Send Ctrl-C to the foreground server.
- **Services that may already be running:** N/A
- **Disposable test target:** The entire local fixture is disposable. Its synthetic in-memory queue is discarded when the server stops.
- **Candidate identity check:** Match `evaluation-case.json` to the controller-provided case and run identity; use the controller input measurement for exact bytes.

## Test commands

- **Fast validation:** `node --check tests/evaluation/fixtures/fx_1b2e5dd833eae7bfc5fbb0de25053a5e/public/server.mjs`
- **API suite:** Exercise API-01 and API-02 directly against the local disposable target.
- **Container validation:** N/A
- **Dependency install (if needed):** N/A
- **Dependency audit tool:** N/A

## Core flows

1. Create one queued delivery, retry the identical request with the same Idempotency-Key, and confirm the original delivery is returned with one queued delivery.

## API surface

- **Has a backend API?** yes
- **Contract source:** tests/evaluation/fixtures/fx_1b2e5dd833eae7bfc5fbb0de25053a5e/public/api-contract.json
- **Destructive endpoints requiring confirmation before testing:** N/A. POST `/api/deliveries` mutates only the declared disposable in-memory target.

## Platform

- **Platform:** web

## Deployment & threat model

- **Deployment model:** Disposable local fixture with synthetic in-memory state.
- **Who can reach it, over what network:** Only the local loopback interface.
- **Expected concurrency (realistic peak):** One QA session.
- **Out-of-scope infrastructure:** External services, remote hosts, user accounts, and owner data.

## Hard boundaries (all agents, all projects)

- Never delete volumes, databases, backups, or user data. No `--volumes`, no
  `rm -rf`, no resets.
- Never edit source code, tests, config, git history, issues, PRs, or
  releases to make a result pass. Report; don't fix.
- QA lanes never inspect a remote tracker or draft issues. Only the
  orchestrator may prepare a local proposal after synthesis. Any tracker
  mutation requires a later explicit user request.
- Never submit real credentials, tokens, personal files, or private
  identifiers into any page, form, or request.
- Complete mutation-dependent flows only against the **Disposable test
  target** above.
- Never inspect files, browser data, or applications unrelated to the app
  under test.
- Never test against production or a public hostname.
- If a service was already running before the agent started, identify it and
  prefer not to disturb it.
