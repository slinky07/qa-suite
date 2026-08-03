# QA Context — Settlement Transfer

## Project

- **Project name:** Settlement Transfer
- **Repository docs to read first:** tests/evaluation/fixtures/fx_900fd4464c2266920845ed938fc894ce/public/data-contract.json
- **Report output folder:** QA/
- **Temporary specialist registry:** N/A
- **Intended audience:** Local operators who require one acknowledged synthetic transfer to preserve the ledger total.

## Finding ledger

- **Path:** tests/evaluation/fixtures/fx_900fd4464c2266920845ed938fc894ce/public/findings.jsonl
- **Repository visibility (`repo_visibility`):** public
- **Named components:** transfer-store, acknowledged-write, recovery-step

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
- **API contracts/specs:** tests/evaluation/fixtures/fx_900fd4464c2266920845ed938fc894ce/public/data-contract.json
- **Design docs:** N/A
- **Design tokens/design system files:** N/A
- **Acceptance criteria:** DATA-01 in the named data contract.

## Runtime

- **Default run policy:** Run one fresh synthetic in-memory store directly with Node.
- **How to start the app (dev path):** `node tests/evaluation/fixtures/fx_900fd4464c2266920845ed938fc894ce/public/probe.mjs normal`
- **How to start the app (deployment path):** N/A
- **How to check it's running:** Confirm the normal probe reports an acknowledged transfer with DATA-01 satisfied.
- **How to read logs:** Read the command's deterministic before, expected, and after state proof.
- **App URL(s):** N/A
- **How to stop the app (non-destructive):** N/A. Each command exits after one in-memory operation.
- **Services that may already be running:** N/A
- **Disposable test target:** Each command creates a fresh two-record synthetic in-memory store; no owner or shared data exists.
- **Candidate identity check:** Match `evaluation-case.json` to the controller-provided case and run identity; use the controller input measurement for exact bytes.

## Test commands

- **Fast validation:** `node --check tests/evaluation/fixtures/fx_900fd4464c2266920845ed938fc894ce/public/transfer-store.mjs && node --check tests/evaluation/fixtures/fx_900fd4464c2266920845ed938fc894ce/public/probe.mjs`
- **Normal-write suite:** `node --test tests/evaluation/fixtures/fx_900fd4464c2266920845ed938fc894ce/public/transaction-suite.mjs`
- **Interrupted-write probe:** `node tests/evaluation/fixtures/fx_900fd4464c2266920845ed938fc894ce/public/probe.mjs interrupted`
- **Dependency install (if needed):** N/A

## Core flows

1. Apply and acknowledge a two-step transfer from reserve to settlement.
2. Recover the same acknowledged transfer after interruption between the debit and credit, then prove DATA-01 with record count, digest, and total.

## API surface

- **Has a backend API?** no
- **Contract source:** N/A
- **Destructive endpoints requiring confirmation before testing:** N/A

## Platform

- **Platform:** desktop

## Deployment & threat model

- **Deployment model:** Disposable synthetic in-memory store with no network or persistent files.
- **Who can reach it, over what network:** One local Node process; no network listener.
- **Expected concurrency (realistic peak):** One transfer.
- **Out-of-scope infrastructure:** Production, shared stores, owner data, external services, and original backups.

## Hard boundaries

- Never mutate production, a shared store, owner data, or an original backup.
- Never edit source code, tests, configuration, or fixtures to make a result pass.
- Never inspect files or applications unrelated to this fixture.
- Use only the fresh synthetic in-memory store.
