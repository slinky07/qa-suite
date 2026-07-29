# QA Context — Status Board

## Project

- **Project name:** Status Board
- **Repository docs to read first:** tests/evaluation/fixtures/fx_2facb8d5785c096aca738b8bfdf363a6/public/deployment.md
- **Report output folder:** QA/
- **Intended audience:** Operators viewing public service status.

## Finding ledger

- **Path:** tests/evaluation/fixtures/fx_2facb8d5785c096aca738b8bfdf363a6/public/findings.jsonl
- **Repository visibility (`repo_visibility`):** public
- **Named components:** response-hygiene, forwarding-boundary

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
- **API contracts/specs:** N/A
- **Design docs:** tests/evaluation/fixtures/fx_2facb8d5785c096aca738b8bfdf363a6/public/deployment.md
- **Design tokens/design system files:** N/A
- **Acceptance criteria:** Forwarded client identity is trusted only when it comes from the named edge proxy. Direct internet clients and their forwarding headers are untrusted.

## Runtime

- **Default run policy:** Start the local fixture directly with Node.
- **How to start the app (dev path):** `node tests/evaluation/fixtures/fx_2facb8d5785c096aca738b8bfdf363a6/public/server.mjs 4173`
- **How to start the app (deployment path):** N/A
- **How to check it's running:** `curl --fail --show-error http://127.0.0.1:4173/health`
- **How to read logs:** Read the foreground server terminal.
- **App URL(s):** http://127.0.0.1:4173/
- **How to stop the app (non-destructive):** Send Ctrl-C to the foreground server.
- **Services that may already be running:** N/A
- **Disposable test target:** The entire local fixture is disposable and has no persistent state.
- **Candidate identity check:** Match `evaluation-case.json` to the controller-provided case and run identity; use the controller input measurement for exact bytes.

## Test commands

- **Fast validation:** `node --check tests/evaluation/fixtures/fx_2facb8d5785c096aca738b8bfdf363a6/public/server.mjs`
- **Header check:** `curl --include --fail --show-error http://127.0.0.1:4173/`
- **Browser/E2E suite:** N/A
- **Container validation:** N/A
- **Dependency install (if needed):** N/A
- **Dependency audit tool:** N/A

## Core flows

1. View the public service status page.

## API surface

- **Has a backend API?** yes
- **Contract source:** tests/evaluation/fixtures/fx_2facb8d5785c096aca738b8bfdf363a6/public/deployment.md
- **Destructive endpoints requiring confirmation before testing:** N/A

## Platform

- **Platform:** web

## Deployment & threat model

- **Deployment model:** Public HTTPS service behind a named edge proxy, with an origin that can also receive direct internet connections.
- **Who can reach it, over what network:** Unauthenticated internet clients and the named edge proxy can reach the service over the public network.
- **Expected concurrency (realistic peak):** Five users.
- **Out-of-scope infrastructure:** The external edge proxy, public DNS, remote hosts, user accounts, and owner data.

## Hard boundaries

- Do not send crafted forwarding headers or attempt to prove impact.
- Never inspect files or applications unrelated to this fixture.
- Never test against production or a public hostname.
- Never submit credentials, tokens, personal data, or private identifiers.
