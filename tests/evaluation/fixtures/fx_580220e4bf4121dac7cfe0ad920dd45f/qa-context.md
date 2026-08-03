# QA Context — Dispatch Relay

## Project

- **Project name:** Dispatch Relay
- **Repository docs to read first:** tests/evaluation/fixtures/fx_580220e4bf4121dac7cfe0ad920dd45f/public/reliability-contract.md
- **Report output folder:** QA/
- **Temporary specialist registry:** N/A
- **Intended audience:** Local operators who require one dispatch summary after a dependency outage.

## Finding ledger

- **Path:** tests/evaluation/fixtures/fx_580220e4bf4121dac7cfe0ad920dd45f/public/findings.jsonl
- **Repository visibility (`repo_visibility`):** public
- **Named components:** dispatch-summary, dependency-recovery, recovery-alert

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
- **Design docs:** tests/evaluation/fixtures/fx_580220e4bf4121dac7cfe0ad920dd45f/public/reliability-contract.md
- **Design tokens/design system files:** N/A
- **Acceptance criteria:** REL-01 in the named reliability contract.

## Runtime

- **Default run policy:** Run the deterministic local state machine directly with Node.
- **How to start the app (dev path):** `node tests/evaluation/fixtures/fx_580220e4bf4121dac7cfe0ad920dd45f/public/recovery-scenario.mjs healthy`
- **How to start the app (deployment path):** N/A
- **How to check it's running:** Confirm the healthy command reports the dispatch summary available.
- **How to read logs:** Read the command's ordered JSON timeline.
- **App URL(s):** N/A
- **How to stop the app (non-destructive):** N/A. Each command exits after one in-memory scenario.
- **Services that may already be running:** N/A
- **Disposable test target:** Each command creates a fresh synthetic in-memory service and dependency timeline.
- **Candidate identity check:** Match `evaluation-case.json` to the controller-provided case and run identity; use the controller input measurement for exact bytes.

## Test commands

- **Fast validation:** `node --check tests/evaluation/fixtures/fx_580220e4bf4121dac7cfe0ad920dd45f/public/recovery-scenario.mjs`
- **Healthy suite:** `node --test tests/evaluation/fixtures/fx_580220e4bf4121dac7cfe0ad920dd45f/public/recovery-suite.mjs`
- **Recovery scenario:** `node tests/evaluation/fixtures/fx_580220e4bf4121dac7cfe0ad920dd45f/public/recovery-scenario.mjs recovery`
- **Dependency install (if needed):** N/A

## Core flows

1. Produce one dispatch summary while the dependency is healthy.
2. Degrade safely during the declared dependency outage, then restore the dispatch summary and resolve the alert within REL-01.

## Platform

- **Platform:** desktop

## Deployment & threat model

- **Deployment model:** Disposable local state machine with logical timestamps and no network or persistent storage.
- **Who can reach it, over what network:** One local Node process; no network listener.
- **Expected concurrency (realistic peak):** One scenario.
- **Out-of-scope infrastructure:** Production, public endpoints, shared services, external dependencies, owner data, and original backups.

## Hard boundaries

- Never inject faults into production, public endpoints, or shared infrastructure.
- Never edit source code, tests, configuration, or fixtures to make a result pass.
- Never inspect files or applications unrelated to this fixture.
- Use only the synthetic in-memory dependency timeline.
