# Campaign goal: finish Issue #30's promise and integrate for users (v1.4.0)

This document is a self-contained orchestration goal. It assumes no chat
context. The orchestrator must read, in order: this file, `AGENTS.md`,
`WORKFLOW.md`, and every authority file named for a surface it will change.
GitHub is the live control plane: verify every mutable claim below
(issue numbers, states, PR history) with authenticated `gh` before relying on
it. Where this document and live GitHub state disagree, GitHub wins; report
the difference instead of guessing.

## Mission

Convert the Issue #30 lane-evaluation campaign's confirmed diagnoses into
shipped lane improvements, extend finding-ledger participation to all seven
lanes, and publish QA Suite v1.4.0 so installed users receive the fixes.
Preserve the fresh-user (naive Bob) psychology, evidence governance, and every
protected boundary named below.

## Established facts (verify before use)

- Issue #30 closed 2026-07-29 with partial acceptance. The delivery record is
  `tests/evaluation/issue-30-closure.md`. Frozen merged base
  `0a2a2e7e3a942f869b71c8bd45ea9c8dbb22b576`; the distributed `qa-suite/` tree
  was unchanged by that campaign
  (`2df85dedb7d9916458ae78314e3b8989d8f37f28`).
- Human reconciliation over seven completed fixture pairs: five of seven
  adversarial expectations detected, zero control false positives. Bob missed
  both of its adversarial assertions. The API pair's deeper specialist lane
  ended `Blocked` and is excluded from detection and miss counts.
- PR #33 (merged 2026-07-17) added Bob IA/trust guidance to
  `qa-suite/references/agents/bob-qa.md`. The evaluation ran 2026-07-28/29,
  after that merge. Therefore Issue #29 iteration 1 is empirically
  insufficient and Issue #29 remains the open P1 remediation authority.
- The finding ledger is the persistent-knowledge layer:
  `qa-suite/references/finding-ledger.md`,
  `qa-suite/references/finding-ledger.schema.json`,
  `qa-suite/scripts/finding-ledger.mjs`, and the Finding ledger section of
  `qa-suite/SKILL.md`. The orchestrator owns all ledger writes. Lanes never
  read or write the ledger; ledger-derived knowledge reaches a lane only
  through the governed verification manifest protocol already defined in
  `SKILL.md`.
- Maintainer evaluation infrastructure lives in `scripts/evaluation/` and
  `tests/evaluation/` and is excluded from the published archives. Its module
  map and frozen/active boundary are in `scripts/evaluation/CODEMAP.md`.

## Protected surfaces (do not weaken)

- Bob's fresh-user psychology: `bob-qa.md` forbids reliance on memory,
  previous summaries, or conversation context. Any change that gives a lane
  standing knowledge across runs is a defect, not a feature.
- Evidence rules, `Not tested` reporting, severity/priority governance, and
  verdict semantics (Issue #31 is the semantics authority).
- Evaluation non-claims: every evaluation output keeps
  `verification_status: "unverified"`, `qualification: "not-evidence"`,
  `result: null` verbatim. Reruns are human-reconciled comparisons, not
  certifications.
- Fixture opacity: sealed oracle content never reaches a lane, an adapter, or
  a lane-remediation author's prompt. Remediation authors receive failure-class
  descriptions only (see N1).
- Release integrity: only `qa-suite.skill` and `qa-suite-source.zip` are
  published, built byte-identical from `qa-suite/` at an exact ref.

## Non-goals

- No new lanes (Issue #36) and no pluggable external execution (Issue #26).
- No rewrite, extension, or maintenance of the frozen Bob live-controller
  stack (see CODEMAP tier F). It may be invoked as-is if a Bob rerun requires
  it; if it no longer runs, record Blocked with evidence — do not repair it
  inside this campaign.
- No scheduler, graph database, knowledge-graph store, or new framework.
- No direct pushes to `main`; a human merges every PR; issue closure is
  human-gated.

## Phase 0 — control plane (gh only, no code)

File these issues first, in the repository's loose ASD-STE100 prose style,
each evidence-backed with citations to `tests/evaluation/issue-30-closure.md`
and the relevant fixture or run SHAs. Check for existing duplicates before
filing each one.

- R1: Verdict-classification drift — regression, security, and compatibility
  detected their planted defects but classified them differently than the
  sealed expectations. Semantics authority is Issue #31.
- R2: Smoke evidence lacks screenshot binding.
- R3: The API adversarial/control pair is incomplete (deeper lane `Blocked`);
  complete it or formally retire it.
- R4: Harness disposition — recommended default: freeze CODEMAP tier F
  (Codex-0.145-pinned live controller stack) as reference; keep tier A active;
  decide whether recurring semantic runs are scheduled or explicitly
  de-scoped.
- R5: Compatibility evidence used emulated widths only; real engine/device
  coverage is unestablished.
- R6: Any still-owed ledger and contract-fundamentals follow-up filings per
  the post-fix lifecycle conventions (cross-reference Issue #37's merged
  lifecycle definition); verify against the live tracker what is actually
  missing before filing.

Then file one umbrella campaign issue containing the dependency graph below
and linking: #29, #28, #24, #19, #22, #23, #50, and R1–R6. Promote this document
via a planning PR (it may already exist on branch
`claude/evaluation-foundation`; reuse that PR if open).

## Dependency graph

Every node follows the WORKFLOW.md node loop:
issue → isolated worktree → `codex/issue-<n>-<slug>` branch → tested commit →
PR → CI → human merge. Independent nodes branch from refreshed `origin/main`.
Each node's PR uses `Closes #<child>` plus `Part of #<umbrella>`; only N12
uses `Closes #<umbrella>`.

| Node | Outcome | Depends on | Write scope | Acceptance |
|---|---|---|---|---|
| N1 | Bob oracle iteration 2 (#29, P1) | — | `qa-suite/references/agents/bob-qa.md`, `qa-suite/references/ux-foundations.md` | Detection reasoning targets the missed failure classes (unrelated-task combination, unclear consequences, recovery needing unexplained technical knowledge) via the fresh-user oracle, not fixture-specific phrasing; review confirms no sealed-oracle leakage |
| N2 | Verdict-classification alignment (R1) | — | `qa-suite/SKILL.md` verdict sections, `qa-suite/references/severity-priority-matrix.md` | Classification rules make the three observed drifts unambiguous under #31 semantics; sole owner of the SKILL.md seam until merged |
| N3 | Smoke screenshot binding (R2) | — | `qa-suite/references/agents/smoke-qa.md`, `qa-suite/assets/project-agent-smoke-qa.*` | Smoke evidence requires a screenshot reference for each critical-path claim, within smoke's time-box |
| N4 | Ledger parity across all seven lanes | N1, N2, N3 merged | report-format sections of all seven `qa-suite/references/agents/*.md` | Every lane proposes findings in the orchestrator-reconcilable format, is eligible for verification missions, and restates ledger blindness in its own file |
| N5 | Passive fresh-user philosophy docs (#28, P1) | N2 merged (SKILL.md seam) | `README.md`, `qa-suite/SKILL.md` intro | Value explanation precedes usage detail; psychology language matches `bob-qa.md` |
| N6 | User-facing quick wins: #24 install paths, #19 Codex marketplace metadata, #22 ignore rules, #23 smoke-agent commit policy | — | per child issue; all disjoint from N1–N5 | Each child issue's own acceptance; one small PR per issue |
| N7 | Bob fixture-pair reruns (before/after record) | N1 merged | `tests/evaluation/` rerun record only | Both Bob pairs rerun per the evaluation method; human-reconciled comparison recorded; non-claims preserved. Stop rule: if Bob misses again, at most one further N1-style iteration, then record Blocked in #29 with the residual |
| N8 | Rerun regression/security/compatibility pairs | N2 merged | `tests/evaluation/` rerun record | Classification now matches sealed expectations; no control false positive |
| N9 | Rerun smoke pair | N3 merged | `tests/evaluation/` rerun record | Screenshot-bound evidence present; no control false positive |
| N10 | API pair resolution (R3) | — | `tests/evaluation/` | Pair completed and rerun, or retired with a recorded reason |
| N13 | Controlled external-reference handling (#50) | N1–N5 merged | `docs/` (reference register, ADR), `AGENTS.md` pointer, `scripts/release/` + tests for the binary-rejection gate | #50's acceptance criteria, per its own sequencing: after the functional P1 and evaluation work, before the release chain. The motivating PDF now lives untracked at the repository root as `Graph-Engineering-Anthropic-Playbook.pdf` (moved out of `qa-suite/references/` on 2026-07-29); no publisher attribution is inferred from the filename |
| N11 | Release v1.4.0 per `docs/releasing.md` | N1–N6 and N13 merged | `VERSION`, plugin manifests, `README.md` version line | Deterministic byte-identical archives; release-integrity green; the N13 uncontrolled-binary gate passes; N7–N9 evidence linked in the PR body |
| N12 | Campaign closure | all above resolved or explicitly Blocked | umbrella issue, `docs/exec-plans/`, plus the four tracked evaluation-record links named in the Issue #87 scope reconciliation | Graph reconciled; deferred findings named (R4 disposition, recurring runs, R5); plan moved to `docs/exec-plans/completed/`; no goal-created worktree remains after N12 post-merge cleanup; the two owner-protected pre-goal Issue #30 worktrees remain untouched; `qa-suite/` contains no untracked files |

## Parallelism schedule

Up to four concurrent worker nodes, three recommended (WORKFLOW.md owns the
ceiling); fewer when scopes touch. Helper agents — planners, auditors,
reviewers, report writers, watchdogs, QA-lane dispatch, spawned by the
orchestrator or by a node within its scope — are a separate class outside
that ceiling, and read-only
exploration, test runs, and reviews parallelize freely.

- Wave 1 (start immediately, in parallel): N1, N3, and one N6 child.
  N2 may replace the N6 child in the first wave if capacity allows, since its
  scope (`SKILL.md`) is disjoint from N1/N3. N10 may run any time as a
  maintainer-side node when a writer slot is free.
- Wave 2: N7 starts the moment N1 merges (do not wait for other nodes —
  pipeline, no barrier). N8 after N2; N9 after N3. Remaining N6 children fill
  free writer slots.
- Wave 3: N4 (needs N1+N2+N3 merged), N5 (needs N2 merged), then N13 (needs
  N1–N5 merged; it gates the release).
- Wave 4: N11 (needs N13), then N12. Sequential, single writer.

Seam ownership: `qa-suite/SKILL.md` belongs to N2 until merged, then N5, then
N4 rebases on the result. Only one writer owns a file at a time.

## Harness rules for every worker (anti-hallucination contract)

- Ground every claim: read the file before citing it; PR descriptions cite
  `path:line` for each behavioral claim. No claim without a read.
- Verify mutable state with `gh` at node start; never act on remembered issue
  or PR state, including the numbers in this document.
- Before PR handoff run, from the node worktree root:
  `node --test`, `node scripts/release/check.mjs --ref HEAD`,
  `git diff --check origin/main...HEAD` — plus the node's focused checks.
- Identify every tested candidate by full commit SHA.
- Retry an unchanged transient failure once; otherwise diagnose or record
  Blocked with an unblock condition. Never loop a settled gate.
- Non-blocking imperfections become linked follow-up issues, never PR growth.
- Workers do not merge, close issues, reorder the graph, or widen scope. The
  orchestrator reconciles all results and stops at the human merge gate.
- After a node's PR merges and its evidence is durable, remove the node's
  worktree and prune stale registrations (AGENTS.md worktree rule). Leaving
  merged campaign worktrees behind is a defect; N12 verifies no
  campaign-created worktree remains. The two owner-protected pre-goal Issue
  #30 worktrees are outside this campaign's cleanup scope.

## Definition of done

v1.4.0 is published from a human-merged main containing N1–N6 and N13; rerun
records N7–N9 exist with preserved non-claims; every residual is either
resolved or tracked in a filed issue; the umbrella issue closes with the
reconciled graph.

## Closure reconciliation

N12 moves this plan to `completed/`. Its merge is the campaign's terminal
action and closes Issue #87.

| Node | Terminal result |
|---|---|
| N1 | Done — [PR #88](https://github.com/slinky07/qa-suite/pull/88) |
| N2 | Done — [Issue #82](https://github.com/slinky07/qa-suite/issues/82), [PR #90](https://github.com/slinky07/qa-suite/pull/90) |
| N3 | Done — [Issue #83](https://github.com/slinky07/qa-suite/issues/83), [PR #89](https://github.com/slinky07/qa-suite/pull/89) |
| N4 | Done — [PR #94](https://github.com/slinky07/qa-suite/pull/94) |
| N5 | Done — [Issue #28](https://github.com/slinky07/qa-suite/issues/28), [PR #91](https://github.com/slinky07/qa-suite/pull/91) |
| N6 | Done — [Issue #22](https://github.com/slinky07/qa-suite/issues/22) / [PR #92](https://github.com/slinky07/qa-suite/pull/92), [Issue #24](https://github.com/slinky07/qa-suite/issues/24) / [PR #93](https://github.com/slinky07/qa-suite/pull/93), [Issue #19](https://github.com/slinky07/qa-suite/issues/19) / [PR #95](https://github.com/slinky07/qa-suite/pull/95), and [Issue #23](https://github.com/slinky07/qa-suite/issues/23) / [PR #96](https://github.com/slinky07/qa-suite/pull/96) |
| N7 | Explicitly `Blocked` — [PR #101](https://github.com/slinky07/qa-suite/pull/101), final behavior iteration [PR #102](https://github.com/slinky07/qa-suite/pull/102), terminal record [PR #103](https://github.com/slinky07/qa-suite/pull/103); residual remains [Issue #29](https://github.com/slinky07/qa-suite/issues/29) |
| N8 | Explicitly `Blocked` — [PR #104](https://github.com/slinky07/qa-suite/pull/104); successor [Issue #105](https://github.com/slinky07/qa-suite/issues/105) |
| N9 | Done — [PR #100](https://github.com/slinky07/qa-suite/pull/100) |
| N10 | Done — [Issue #84](https://github.com/slinky07/qa-suite/issues/84), [PR #107](https://github.com/slinky07/qa-suite/pull/107); non-blocking classification residual [Issue #106](https://github.com/slinky07/qa-suite/issues/106) |
| N13 | Done — [Issue #50](https://github.com/slinky07/qa-suite/issues/50), [PR #97](https://github.com/slinky07/qa-suite/pull/97) |
| N11 | Done — [PR #108](https://github.com/slinky07/qa-suite/pull/108) and published v1.4.0 |
| N12 | This final closure PR; its merge closes [Issue #87](https://github.com/slinky07/qa-suite/issues/87) |

Campaign-supporting governance changes also merged through
[PR #98](https://github.com/slinky07/qa-suite/pull/98) and
[PR #99](https://github.com/slinky07/qa-suite/pull/99). The post-tag
[PR #109](https://github.com/slinky07/qa-suite/pull/109) changed only the
draft-release attestation action. Its merge
`a5ca7385bdbb260bc39b0586335836ee876065ad` is current `main`, the N12
base, and the publication-run head. The publication workflow remained
identical to the tagged copy; the immutable release identity remains
`25769d26168bec7ba680b4f271ca11d4670c3670` and passed final verification.

### Release and installed-user proof

The immutable [v1.4.0 release](https://github.com/slinky07/qa-suite/releases/tag/v1.4.0)
was published on 2026-08-02 by
[run 30764060831](https://github.com/slinky07/qa-suite/actions/runs/30764060831).
`gh release verify v1.4.0` passed. The annotated tag object
`bad5a6525a91c2ddac61af326daca81db2e90290` resolves to release commit
`25769d26168bec7ba680b4f271ca11d4670c3670`.

The release is neither a draft nor a prerelease and is immutable. Its only
assets are `qa-suite.skill` and `qa-suite-source.zip`; each is 248,484
bytes and both have SHA-256
`a4b9f4d8c4cfaec6f33a2d78911b685279d727693dd4a053e2d91ef84e89aac7`.
The workflow retained
[publication evidence](https://github.com/slinky07/qa-suite/actions/runs/30764060831/artifacts/8838375460)
and
[final release evidence](https://github.com/slinky07/qa-suite/actions/runs/30764060831/artifacts/8838380695).

Fresh Codex verification refreshed the Git marketplace, removed and re-added
`qa-suite@qa-suite`, and confirmed it installed and enabled at version
1.4.0. The durable owner update is
[Issue #87 comment 5160053607](https://github.com/slinky07/qa-suite/issues/87#issuecomment-5160053607).

### Deferred work

The exact open campaign-residual set is:

- [Issue #29](https://github.com/slinky07/qa-suite/issues/29) retains the
  terminal Bob residual from N7.
- [Issue #85](https://github.com/slinky07/qa-suite/issues/85) owns the Tier-F
  harness disposition and recurring-run decision.
- [Issue #86](https://github.com/slinky07/qa-suite/issues/86) owns real engine
  and device compatibility coverage.
- [Issue #105](https://github.com/slinky07/qa-suite/issues/105) owns the
  post-N8 verdict-classification authority conflict.
- [Issue #106](https://github.com/slinky07/qa-suite/issues/106) owns the
  post-N10 API classification authority conflict.
- R6 required no new issue: the
  [Issue #37 owner reconciliation](https://github.com/slinky07/qa-suite/issues/37#issuecomment-5074098301)
  records the ledger and contract-fundamentals filing set as complete.

These are explicit deferred or `Blocked` dispositions. They are not
silently promoted into v1.4.0 release failures.

### Workspace reconciliation

`qa-suite/` contains no untracked files. All completed campaign-node
worktrees were removed. The N12 worktree is removed only after its PR merges
and its evidence is durable.

The owner explicitly exempted the pre-goal `issue-30-codex-0145-events` and
`issue-30-codex-host-sandbox` worktrees from campaign cleanup. They remain
untouched, are not campaign leftovers, and do not weaken the requirement that
no goal-created worktree remain after N12 cleanup.
