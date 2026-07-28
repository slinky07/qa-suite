# QA Context — Project Finder

## Project

- **Project name:** Project Finder
- **Repository docs to read first:** N/A
- **Report output folder:** QA/
- **Intended audience:** Team members looking for a project by name and status.

## Finding ledger

- **Path:** tests/evaluation/fixtures/fx_87a49bf089d33e76d6115d4aef954c01/public/findings.jsonl
- **Repository visibility (`repo_visibility`):** public
- **Named components:** project-filtering, result-workspace, filter-recovery

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
- **How to start the app (dev path):** `node tests/evaluation/fixtures/fx_87a49bf089d33e76d6115d4aef954c01/public/server.mjs 4173`
- **How to start the app (deployment path):** N/A
- **How to check it's running:** `curl --fail http://127.0.0.1:4173/`
- **How to read logs:** Read the foreground server terminal.
- **App URL(s):** http://127.0.0.1:4173/
- **How to stop the app (non-destructive):** Send Ctrl-C to the foreground server.
- **Services that may already be running:** N/A
- **Disposable test target:** The entire local fixture is disposable. Reloading restores the complete project list and default filters.
- **Candidate identity check:** Match `evaluation-case.json` to the controller-provided case and run identity; use the controller input measurement for exact bytes.

## Test commands

- **Fast validation:** `node --check tests/evaluation/fixtures/fx_87a49bf089d33e76d6115d4aef954c01/public/app.mjs && node --check tests/evaluation/fixtures/fx_87a49bf089d33e76d6115d4aef954c01/public/server.mjs`
- **Browser/E2E suite:** N/A
- **Container validation:** N/A
- **Dependency install (if needed):** N/A
- **Dependency audit tool:** N/A

## Core flows

1. Filter projects by project name and status; verify the result count and matching cards.
2. Exercise a no-result filter, edit the filters using the visible interface, and restore the complete project list.

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
