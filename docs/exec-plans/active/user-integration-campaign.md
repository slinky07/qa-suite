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
and linking: #29, #28, #24, #19, #22, #23, and R1–R6. Promote this document
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
| N11 | Release v1.4.0 per `docs/releasing.md` | N1–N6 merged | `VERSION`, plugin manifests, `README.md` version line | Deterministic byte-identical archives; release-integrity green; N7–N9 evidence linked in the PR body |
| N12 | Campaign closure | all above resolved or explicitly Blocked | umbrella issue, `docs/exec-plans/` | Graph reconciled; deferred findings named (R4 disposition, recurring runs, R5); plan moved to `docs/exec-plans/completed/` |

## Parallelism schedule

Maximum three concurrent writer nodes; fewer when scopes touch. Read-only
exploration, test runs, and reviews parallelize freely.

- Wave 1 (start immediately, in parallel): N1, N3, and one N6 child.
  N2 may replace the N6 child in the first wave if capacity allows, since its
  scope (`SKILL.md`) is disjoint from N1/N3. N10 may run any time as a
  maintainer-side node when a writer slot is free.
- Wave 2: N7 starts the moment N1 merges (do not wait for other nodes —
  pipeline, no barrier). N8 after N2; N9 after N3. Remaining N6 children fill
  free writer slots.
- Wave 3: N4 (needs N1+N2+N3 merged), N5 (needs N2 merged).
- Wave 4: N11, then N12. Sequential, single writer.

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

## Definition of done

v1.4.0 is published from a human-merged main containing N1–N6; rerun records
N7–N9 exist with preserved non-claims; every residual is either resolved or
tracked in a filed issue; the umbrella issue closes with the reconciled graph.
