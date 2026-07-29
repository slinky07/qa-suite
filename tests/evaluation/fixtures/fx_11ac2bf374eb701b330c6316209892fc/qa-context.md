# QA Context — Cancellation Window

## Project

- **Project name:** Cancellation Window
- **Repository docs to read first:** N/A
- **Report output folder:** QA/
- **Intended audience:** Customers checking whether a purchase can still be cancelled.

## Finding ledger

- **Path:** tests/evaluation/fixtures/fx_11ac2bf374eb701b330c6316209892fc/public/findings.jsonl
- **Repository visibility (`repo_visibility`):** public
- **Named components:** cancellation-eligibility

## Testing posture

- **Posture:** aggressive
- **Reason for standard posture:** N/A

## Architecture & intent inputs

- **Acceptance criteria:** A purchase remains eligible from day 0 through the configured cancellation-window day, inclusive.
- **Other contracts/specs:** N/A

## Runtime

- **Default run policy:** Run the local Node test directly.
- **How to start the app (dev path):** N/A
- **How to check it's running:** N/A
- **How to read logs:** Read the test command output.
- **Disposable test target:** The fixture is read-only and has no persistent state.
- **Candidate identity check:** Match `evaluation-case.json` to the controller-provided case and run identity; use the controller input measurement for exact bytes.

## Test commands

- **Fast validation:** `node --check tests/evaluation/fixtures/fx_11ac2bf374eb701b330c6316209892fc/public/base/cancellation.mjs && node --check tests/evaluation/fixtures/fx_11ac2bf374eb701b330c6316209892fc/public/candidate/cancellation.mjs && node --check tests/evaluation/fixtures/fx_11ac2bf374eb701b330c6316209892fc/public/cancellation-suite.mjs`
- **Full automated suite:** `CANCELLATION_REVISION=candidate node --test tests/evaluation/fixtures/fx_11ac2bf374eb701b330c6316209892fc/public/cancellation-suite.mjs`
- **Baseline suite:** `CANCELLATION_REVISION=base node --test tests/evaluation/fixtures/fx_11ac2bf374eb701b330c6316209892fc/public/cancellation-suite.mjs`
- **Change inventory:** `git diff --no-index --stat tests/evaluation/fixtures/fx_11ac2bf374eb701b330c6316209892fc/public/base/cancellation.mjs tests/evaluation/fixtures/fx_11ac2bf374eb701b330c6316209892fc/public/candidate/cancellation.mjs`
- **Dependency install:** N/A

## Core flows

1. Check cancellation eligibility for a purchase inside and after the configured window.
2. Check eligibility on the configured final cancellation day.

## Platform

- **Platform:** desktop

## Deployment & threat model

- **Deployment model:** Disposable local fixture with no network service.
- **Out-of-scope infrastructure:** External services, remote hosts, user accounts, and owner data.

## Hard boundaries

- Never edit source code, tests, or fixtures to make a result pass.
- Never inspect files or applications unrelated to this fixture.
- Never test against production or a public hostname.
