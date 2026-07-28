# QA Context — Pocket Notes

## Project

- **Project name:** Pocket Notes
- **Repository docs to read first:** N/A
- **Report output folder:** QA/
- **Intended audience:** General end users who want a small local note board.

## Finding ledger

- **Path:** tests/evaluation/fixtures/fx_39e78c1246b2cf2952277010d5f5cedc/public/findings.jsonl
- **Repository visibility (`repo_visibility`):** public
- **Named components:** note-creation, display-preferences, note-board

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
- **Acceptance criteria:** The visible interface and the core flows below.

## Runtime

- **Default run policy:** Start the local fixture directly with Node.
- **How to start the app (dev path):** `node tests/evaluation/fixtures/fx_39e78c1246b2cf2952277010d5f5cedc/public/server.mjs 4173`
- **How to start the app (deployment path):** N/A
- **How to check it's running:** `curl --fail http://127.0.0.1:4173/`
- **How to read logs:** Read the foreground server terminal.
- **App URL(s):** http://127.0.0.1:4173/
- **How to stop the app (non-destructive):** Send Ctrl-C to the foreground server.
- **Services that may already be running:** N/A
- **Disposable test target:** The entire local fixture is disposable. Reloading resets all notes and preferences.
- **Candidate identity check:** Match `evaluation-case.json` to the controller-provided case and run identity; use the controller input measurement for exact bytes.

## Test commands

- **Fast validation:** `node --check tests/evaluation/fixtures/fx_39e78c1246b2cf2952277010d5f5cedc/public/app.mjs && node --check tests/evaluation/fixtures/fx_39e78c1246b2cf2952277010d5f5cedc/public/server.mjs`
- **Browser/E2E suite:** N/A
- **Container validation:** N/A
- **Dependency install (if needed):** N/A
- **Dependency audit tool:** N/A

## Core flows

1. Add a note with a title and note text; verify named success feedback and the rendered note.
2. Change the note-board display preferences; verify compact cards and timestamp visibility.

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
