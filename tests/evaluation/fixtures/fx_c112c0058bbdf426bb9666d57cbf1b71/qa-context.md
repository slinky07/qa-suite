# QA Context — Release Slot

## Project

- **Project name:** Release Slot
- **Repository docs to read first:** tests/evaluation/fixtures/fx_c112c0058bbdf426bb9666d57cbf1b71/public/deployment-contract.md
- **Report output folder:** QA/
- **Temporary specialist registry:** N/A
- **Intended audience:** Local release operators rehearsing one failed candidate rollout and rollback.

## Finding ledger

- **Path:** tests/evaluation/fixtures/fx_c112c0058bbdf426bb9666d57cbf1b71/public/findings.jsonl
- **Repository visibility (`repo_visibility`):** public
- **Named components:** artifact-slot, configuration-slot, rollback-procedure

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
- **Design docs:** tests/evaluation/fixtures/fx_c112c0058bbdf426bb9666d57cbf1b71/public/deployment-contract.md
- **Design tokens/design system files:** N/A
- **Acceptance criteria:** DEPLOY-01 in the named deployment contract.

## Runtime

- **Default run policy:** Run the local in-memory release-slot rehearsal directly with Node.
- **How to start the app (dev path):** `node tests/evaluation/fixtures/fx_c112c0058bbdf426bb9666d57cbf1b71/public/rollout.mjs preflight`
- **How to start the app (deployment path):** `node tests/evaluation/fixtures/fx_c112c0058bbdf426bb9666d57cbf1b71/public/rollout.mjs rehearse`
- **How to check it's running:** Confirm preflight reports the v1 artifact/configuration pair healthy.
- **How to read logs:** Read the command's deterministic identity and verification JSON.
- **App URL(s):** N/A
- **How to stop the app (non-destructive):** N/A. Each command exits after one in-memory rehearsal.
- **Services that may already be running:** N/A
- **Disposable test target:** Each command creates one isolated synthetic in-memory release slot from public fixture bytes.
- **Candidate identity check:** Match `evaluation-case.json` to the controller-provided case and run identity; use the controller input measurement for exact bytes.

## Test commands

- **Fast validation:** `node --check tests/evaluation/fixtures/fx_c112c0058bbdf426bb9666d57cbf1b71/public/rollout.mjs`
- **Preflight suite:** `node --test tests/evaluation/fixtures/fx_c112c0058bbdf426bb9666d57cbf1b71/public/deployment-suite.mjs`
- **Rollback rehearsal:** `node tests/evaluation/fixtures/fx_c112c0058bbdf426bb9666d57cbf1b71/public/rollout.mjs rehearse`
- **Dependency install (if needed):** N/A

## Core flows

1. Verify the healthy v1 artifact and configuration identities.
2. Replace v1 with v2, observe the declared failed verification, then restore the exact v1 identities and healthy state under DEPLOY-01.

## Platform

- **Platform:** desktop

## Deployment & threat model

- **Deployment model:** Disposable in-memory release slot populated only from synthetic fixture bytes.
- **Who can reach it, over what network:** One local Node process; no network listener.
- **Expected concurrency (realistic peak):** One rehearsal.
- **Out-of-scope infrastructure:** Production, shared infrastructure, external services, owner data, and original backups.

## Hard boundaries

- Never deploy to or roll back production or shared infrastructure.
- Never edit source code, tests, configuration, or fixtures to make a result pass.
- Never inspect files or applications unrelated to this fixture.
- Use only the synthetic in-memory release slot.
