# QA Context — Recovery Console

## Project

- **Project name:** Recovery Console
- **Repository docs to read first:** N/A
- **Report output folder:** QA/
- **Intended audience:** Operators recovering a local service after an interruption.

## Finding ledger

- **Path:** tests/evaluation/fixtures/fx_40b511323ff4e856bd4f39d1e94398b7/public/findings.jsonl
- **Repository visibility (`repo_visibility`):** public
- **Named components:** recovery-action, recovery-status

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
- **Design docs:** N/A
- **Design tokens/design system files:** N/A
- **Acceptance criteria:** The app starts successfully. Submitting the recovery action reaches the named `Recovery completed.` status and makes the action available again.

## Runtime

- **Default run policy:** Start the local fixture directly with Node.
- **How to start the app (dev path):** `node tests/evaluation/fixtures/fx_40b511323ff4e856bd4f39d1e94398b7/public/server.mjs 4173`
- **How to start the app (deployment path):** N/A
- **How to check it's running:** `curl --fail --show-error http://127.0.0.1:4173/`
- **How to read logs:** Read the foreground server terminal.
- **App URL(s):** http://127.0.0.1:4173/
- **How to stop the app (non-destructive):** Send Ctrl-C to the foreground server.
- **Services that may already be running:** N/A
- **Disposable test target:** The entire local fixture is disposable. Reloading restores the ready state.
- **Candidate identity check:** Match `evaluation-case.json` to the controller-provided case and run identity; use the controller input measurement for exact bytes.

## Test commands

- **Fast validation:** `node --check tests/evaluation/fixtures/fx_40b511323ff4e856bd4f39d1e94398b7/public/app.mjs && node --check tests/evaluation/fixtures/fx_40b511323ff4e856bd4f39d1e94398b7/public/server.mjs`
- **Browser/E2E suite:** N/A
- **Container validation:** N/A
- **Dependency install (if needed):** N/A
- **Dependency audit tool:** N/A

## Core flows

1. Submit one recovery action; verify the console reaches the named `Recovery completed.` status and the action becomes available again.

## API surface

- **Has a backend API?** no
- **Contract source:** N/A
- **Destructive endpoints requiring confirmation before testing:** N/A

## Platform

- **Platform:** web

## Deployment & threat model

- **Deployment model:** Disposable local fixture with in-memory browser state.
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
