# N9 smoke screenshot rerun

## Decision

The maintainer-side reconciliation records N9 acceptance as passed for the
frozen candidate. The adversarial case produced the allowed `No-Go` verdict
and bound the detected recovery failure to a screenshot. The control case
produced the allowed `Go` verdict with no finding, so the control
false-positive count is zero. No adapter ran, and owner human confirmation
remains the final campaign gate.

The first adversarial attempt was `Blocked` before any target page rendered.
The controller closed that attempt. The orchestrator reports that it then used
the single permitted host/tooling retry, preserving the same frozen case,
candidate, public task, and acceptance checks while changing only to the
owner-approved host browser boundary after the inner-sandbox `SIGABRT`. No
screenshot was possible or required for the Blocked attempt because it made
no rendered-state claim.

## Frozen inputs

| Input | Value |
|---|---|
| Suite | `smoke-evaluation-v1` |
| Lane | `smoke-qa` |
| Controller commit | `0a2a2e7e3a942f869b71c8bd45ea9c8dbb22b576` |
| Controller program SHA-256 | `6c23be8be2daa675922e181bbd8937232fd198f0193178cc60e0f9b973722b54` |
| Subject commit | `571b84f204c637ed049064ca16799665348cb460` |
| Subject `qa-suite/` tree | `ee02714393f3b870189be67adf7a7d9180a15151` |
| Orchestrator-reported runtime | Node `v26.5.0`; Codex CLI `0.145.0` |
| Orchestrator-reported external semantic sessions | 3 for 2 cases, including the one permitted retry |

The orchestrator dispatch record reports that each external session used a
fresh context and received only its selected public case, public QA contract,
frozen candidate, and neutral discovery mission. It reports that prior
reports, sibling case material, sealed roles, expected verdicts, owner
documents, and controller state were not dispatched. The closed envelopes do
not authenticate those operational statements; `context_isolation` and
`fixture_opacity` remain `not-attested`.

## Attempts and closures

| Attempt | Run ID | Case | Orchestrator-reported external session | Verdict | Input tree SHA-256 | Workspace tree SHA-256 | Artifact tree SHA-256 | Captured report |
|---|---|---|---|---|---|---|---|---|
| Initial | `run_0cc6aa5c9ed46861e926f40833ed4371` | `fx_40b511323ff4e856bd4f39d1e94398b7` | `019fb0e1-ea0e-77e2-adc2-ab19ede9feb1` | `Blocked` — Chrome was terminated before a tab opened (`SIGABRT`; cleanup `EPERM`) | `aa41c231ef33679a48d5af1d9f43cb0555a2876a4cb2a769508b2e53aab68396` | `fb8b830aca57b34c83ae7bdb8642317932c46152ef37c57ecd7a6aee24bcca0a` | `280b7a43adb6dba5dc533e7f66e4e625f458b1180886755d96bc5d5740b2eae2` | `QA/2026-07-29-2239-smoke-recovery-console.md`; SHA-256 `ed9c39e77d257d7fbc64ce8ad69dc10960e8cb6b897a09ac8cf1c6aa73ec3e28`; 1,687 bytes |
| Permitted retry | `run_959474908b6387bdccb7b69ddfb3f558` | `fx_40b511323ff4e856bd4f39d1e94398b7` | `019fb0e4-fdb4-7260-837f-ad1269b777e2` | `No-Go` | `da7cc3ec6aec71ea86db35585723bab5b2e96c9ece4b80b274f8b8474433ce44` | `c07774437003c458262c032c30cd1bbdce4534461f16aa300fede14b2fb3e5dd` | `b44869b979097c534ca88557762fbb00fb0b4b40dc8d544d69427b0222b9eb38` | `QA/2026-07-29-2241-smoke-recovery.md`; SHA-256 `ad0e4cc3bfff41a029ab44501b0a27a40b5078435369feb29052a5ee6b5c6e01`; 2,845 bytes |
| Initial | `run_2cab3ef67d1d7765f1c9f5c4f2618fbb` | `fx_6ebc3d5ab940b8515e91655881655b64` | `019fb0e8-e59c-74c3-b0e9-e697a1317a5c` | `Go` | `fc5bb8bd302480067dfd3b8594bc064ff929f9a307342528506280cf70e03262` | `03dbcfe75ae4c7b834285029c66b4fe4c302af95641d1a73d77eccafabddea19` | `8b9cd19f2f48188b2e93d0adc6cce96d461b52e6555a60aa31fe659b034c75e2` | `QA/2026-07-29-2246-smoke-recovery-console.md`; SHA-256 `8b334fdb84d84693111efe51153c930368d64eb48c2a0c1242878dcfe111cdec`; 1,790 bytes |

The orchestrator reports that it inspected captured artifacts and applied the
sealed role mapping only after each listed attempt closed. The closed
envelopes themselves retain `method_order: "unverified_by_report"`. Each
closure also retained
`verification_status: "unverified"`, `qualification: "not-evidence"`, and
`result: null`.

## Acceptance reconciliation

The maintainer-side mapping accounts for each declared public smoke check once
per completed case below. No adapter validation is claimed. Paths name
controller-captured immutable artifacts, not mutable lane files.

| Maintainer-side post-closure role | Required check | State | Captured screenshot | Maintainer-side reconciliation |
|---|---|---|---|---|
| Adversarial | `check_app_startup` | Pass — HTTP 200, titled nonblank page, no initial console errors | `QA/evidence/2026-07-29-2241-smoke-recovery-initial.png`; SHA-256 `33e0458dc74f72565b1b9cabcbad138fc96a905cfdc5f47d1f20b559d6ad0a01`; 22,800 bytes | Startup precondition was exercised; no defect was expected from this check. |
| Adversarial | `check_recovery_action` | Fail — after one action, the status remained `Starting recovery…` and the action remained disabled | `QA/evidence/2026-07-29-2241-smoke-recovery-blocking.png`; SHA-256 `c0aefae50c732f226593f445c29fc1c8cc148d04675ba7bcbf58b723f9cee1ee`; 22,002 bytes | Expected recovery-action defect detected. The `No-Go` verdict is allowed and the required screenshot evidence is present. |
| Control | `check_app_startup` | Pass — HTTP 200, titled nonblank page, no initial console errors | `QA/evidence/2026-07-29-2246-smoke-recovery-initial.png`; SHA-256 `33e0458dc74f72565b1b9cabcbad138fc96a905cfdc5f47d1f20b559d6ad0a01`; 22,800 bytes | Startup precondition passed without a proposed finding. |
| Control | `check_recovery_action` | Pass — one action reached visible `Recovery completed.`, the action was enabled again, and no console error was recorded | `QA/evidence/2026-07-29-2246-smoke-recovery-completed.png`; SHA-256 `7464445437ee5a187d054250d315c1134b1637c169141c62b9fa0864319db301`; 22,699 bytes | The `Go` verdict is allowed. No control finding was proposed, so the false-positive budget was respected. |

## Evaluation outcome

| Measure | Result |
|---|---|
| Adversarial defects expected | 1 |
| Adversarial defects detected | 1 |
| Adversarial defects missed | 0 |
| Blocked semantic attempts | 1 |
| Control false positives | 0 |
| Completed cases with screenshot-bound rendered claims | 2 of 2 |
| N9 acceptance | Pass |

## Limitations and residuals

- The controller-owned fixture process supplied startup context. The lane
  verified the HTTP response and rendered startup state, but did not own or
  capture the foreground startup logs.
- The initial sandboxed browser launch failed before target rendering. The
  orchestrator execution record says the permitted retry kept the same case,
  candidate, task, and acceptance checks while using the already
  owner-approved host browser boundary that could open the isolated tab. This
  retry does not upgrade any controller isolation claim.
- Smoke exercised one representative recovery action per case. Repeated
  actions, edge cases, and deeper QA lanes were out of scope.
- A pre-dispatch preparation against an earlier subject was superseded before
  any external semantic session ran. It produced zero artifacts and is not
  counted as an attempt above.
- The lane/state parents remain retained under
  `/Users/slinky/Documents/QA-Suite-worktrees/` as recoverable local execution
  state, not as durable campaign evidence. This record becomes durable only
  after commit and merge. An independent process and listener audit found no
  remaining N9 fixture, gateway, Codex, or listening process; browser-tab
  finalization remains an orchestrator-reported operational fact.

## Preserved non-claims

For all three closed attempts:

- `input_integrity: "verified"`
- `artifact_inventory: "closed"`
- `adapter_status: "not-run"`
- `method_order: "unverified_by_report"`
- `context_isolation: "not-attested"`
- `execution_isolation: "not-attested"`
- `fixture_opacity: "not-attested"`
- `network_isolation: "not-attested"`
- `state_authentication: "not-attested"`
- `verification_status: "unverified"`
- `qualification: "not-evidence"`
- `result: null`

This record is a maintainer-side controller reconciliation of closed artifacts.
It does not promote the runs to qualifying maintainer evaluation evidence and
does not claim adapter execution, authenticated state, or isolation properties
that the controller did not attest. Runtime versions, external session IDs,
dispatch freshness, the browser-boundary authorization, post-closure role
mapping, and browser-tab finalization come from orchestrator logs or
maintainer inspection rather than `closed.json`; they do not upgrade the
preserved non-claims. Owner human confirmation remains the final campaign
gate.
