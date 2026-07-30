# Evaluation module map

Informative map of `scripts/evaluation/` for orchestrators and workers. This
file defines no contract and changes no behavior. Machine authority stays in
`contracts.mjs`; the human-readable evaluation authority stays in
`tests/evaluation/README.md`; the Issue #30 delivery record stays in
`tests/evaluation/issue-30-closure.md`. If this map disagrees with the code,
the code wins — fix the map in the same PR that changed the code.

## Why this map exists

The evaluation layer is 17 modules and ~15,300 lines written across 26 PRs.
Two failure modes threaten later work: an agent hallucinating an export or
behavior it did not read, and an agent "improving" the frozen live-controller
stack nobody intends to maintain. This map states, per module: what it is,
which tier it belongs to, and which test file owns it — so a worker can load
only what its node needs and cite real lines.

## Tiers

- **Tier A — active.** Lane-agnostic evaluation core. Maintained; changes
  follow the normal node loop and must keep `node --test` green.
- **Tier F — frozen reference.** The Bob live-execution stack, pinned to
  Codex CLI 0.145 transport behavior. Do not extend, refactor, or repair it
  unless a filed issue (harness-disposition R4 or successor) explicitly
  authorizes that work. It may be *invoked as-is* for Bob reruns; if it no
  longer runs, record Blocked with evidence instead of patching it.

## Tier A — active core

| Module | Lines | Role | Owning tests |
|---|---|---|---|
| `contracts.mjs` | 1925 | Machine authority for suite/case/lane/closure contracts and validation | `tests/evaluation-foundation.test.mjs` |
| `runner.mjs` | 1790 | Non-qualifying snapshot runner: single-case disclosure, lane-root preparation, artifact closure | `tests/evaluation-runner.test.mjs` |
| `scoring.mjs` | 455 | Non-qualifying preview math; every output keeps the non-claims stamp | `tests/evaluation-foundation.test.mjs` |
| `git-snapshot.mjs` | 452 | Frozen-commit snapshot and subject-tree export | `tests/evaluation-runner.test.mjs` |
| `run-case.mjs` | 122 | Strict CLI entry for the snapshot runner | `tests/evaluation-runner.test.mjs` |

The reusable corpus (fixtures, sealed oracles, public suites) lives in
`tests/evaluation/fixtures|oracles|suites` and is validated structurally by
`tests/evaluation-fixture-corpus.test.mjs` and
`tests/evaluation-seven-lane-corpus.test.mjs`, plus one per-pair test file per
lane pair.

## Tier F — frozen reference (Codex-0.145-pinned Bob live stack)

| Module | Lines | Role | Owning tests |
|---|---|---|---|
| `browser-gateway.mjs` | 3501 | Confined rendered-page boundary; gateway-local policy, tools, closure | `tests/evaluation-browser-gateway.test.mjs`, `-live.test.mjs` |
| `codex-bob-phase-target.mjs` | 1334 | Measured one-phase live target | `tests/evaluation-codex-bob-phase-target.test.mjs` |
| `bob-host-executor.mjs` | 1063 | Bounded Bob host execution | `tests/evaluation-host-executor.test.mjs` |
| `codex-bob-live-controller.mjs` | 941 | Three-phase runtime composition and retained controller state | `tests/evaluation-codex-bob-live-controller.test.mjs` |
| `bob-host-protocol.mjs` | 893 | Controller sequence for Bob host adapters | `tests/evaluation-host-protocol.test.mjs` |
| `codex-host-policy.mjs` | 547 | Pure Codex host-configuration contract | `tests/evaluation-codex-host-policy.test.mjs` |
| `bob-qualification-composer.mjs` | 450 | Closed Bob preview composition | `tests/evaluation-bob-qualification-composer.test.mjs` |
| `codex-0145-events.mjs` | 444 | Pinned Codex 0.145 transport event parsing | `tests/evaluation-codex-0145-events.test.mjs` |
| `codex-bob-phase-adapter.mjs` | 404 | Atomic phase adaptation | `tests/evaluation-codex-bob-phase-adapter.test.mjs` |
| `codex-bob-phase-composition.mjs` | 401 | Atomic phase composition | `tests/evaluation-codex-bob-phase-composition.test.mjs` |
| `codex-session-chain.mjs` | 389 | Codex session chaining | `tests/evaluation-codex-session-chain.test.mjs` |
| `bob-report-adapter.mjs` | 200 | Closed Bob report metadata binding | `tests/evaluation-bob-report-adapter.test.mjs` |
| `schemas/*.schema.json` | — | Bob phase output schemas (interface inventory, expected-use model, task-execution draft) | via adapter/composition tests |

Known bounded limitations of tier F are recorded in the closure record's P1
residuals (provider identity, sandbox qualification, containment, latency).
They are tracked there and in filed issues — not fixed opportunistically.

## Rules for any change in this directory

1. Read before citing. Never reference an export, option, or behavior without
   having read the defining lines in this checkout; cite `path:line` in the
   PR description.
2. Smallest correct change. Prefer deleting or reusing over adding; no new
   framework, scheduler, or store.
3. Keep the non-claims. Any output object keeps
   `verification_status: "unverified"`, `qualification: "not-evidence"`,
   `result: null` unless a reviewed qualifying host proves every missing
   claim (see `tests/evaluation/README.md`).
4. Oracle opacity. Sealed oracle content never reaches a lane, an adapter, or
   a remediation author's prompt.
5. Tier F is read-only by default. Authorization to modify it comes from a
   filed issue, not from convenience.
6. Verification before handoff: `node --test` from the repository root, then
   `node scripts/release/check.mjs --ref HEAD` (evaluation files are inside
   the release-integrity CI path filter), then
   `git diff --check origin/main...HEAD`.
7. Update this map in the same PR when modules are added, removed, moved, or
   change tier.

## Candidate future reorganization (not performed here)

A physical partition (`scripts/evaluation/live/` for tier F) would make the
boundary structural instead of documented, at the cost of touching every
import in ~12 test files. Do it, if at all, as one dedicated
behavior-preserving node with `node --test` proof before and after — never as
a side effect of another change.
