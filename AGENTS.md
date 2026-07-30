# QA-Suite repository instructions

## Authority map

- Explicit owner instructions and the linked GitHub issue define the requested
  outcome and scope. Verify mutable issue, PR, and CI state with authenticated
  `gh`; do not infer it from stale local prose.
- `qa-suite/` is the distributed QA skill and behavior source of truth.
- [`WORKFLOW.md`](WORKFLOW.md) defines loop engineering, dependency-graph
  execution, orchestration, worktree use, evidence, retries, and human handoff.
  Read it before any multi-step, multi-agent, or multi-PR change.
- `scripts/evaluation/contracts.mjs` is the machine authority for shared
  maintainer evaluation contracts. [`tests/evaluation/README.md`](tests/evaluation/README.md)
  is the human-readable evaluation authority and delivery order.
- `VERSION` is the release version authority. `.codex-plugin/plugin.json`,
  `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, and the
  repository-version statement in `README.md` must match it.
- [`docs/releasing.md`](docs/releasing.md) owns release construction,
  validation, publication, and recovery procedure. Read it before changing or
  operating any release surface.
- If authorities conflict, stop and report the exact conflict. Do not silently
  choose or weaken one.

## Required delivery loop

Every mutating unit follows:

`issue -> isolated worktree -> codex/issue-<number>-<slug> branch -> tested commit -> PR -> CI -> human merge`

- Never commit or push directly to `main`.
- Refresh GitHub and remote Git state before planning. Start an independent
  node from refreshed `origin/main`; start a dependent node only from its
  declared resolved dependency SHA.
- Preserve the user's current checkout and unrelated work. Do not switch,
  clean, reset, stash, or repurpose it without explicit authorization.
- A routine issue uses one branch and one PR. A campaign issue may define
  multiple PR-sized graph nodes and one final integration or closure node.
- A PR may use `Closes #<child-issue>` for its dedicated node and
  `Part of #<campaign>`. When nodes share only the campaign issue, only the
  declared final PR uses `Closes #<campaign>`.
- Human review is the merge gate unless the owner explicitly authorizes merge.
  Issue closure and remote-branch deletion are also human-gated.

## Orchestration and harness

- The main agent is the formal orchestrator. It owns authority interpretation,
  dependency decisions, worker scopes, integration, status, and final handoff.
- Build the dependency graph before implementation. Each node declares its
  outcome, dependencies, acceptance criteria, write scope, verification,
  evidence destination, and owner.
- Run only dependency-ready nodes; analyze parallel width right after
  building the graph and dispatch all proven-disjoint Ready nodes
  concurrently — serializing them without a recorded reason is a scheduling
  defect. At most four concurrent worker nodes (worktree-bound writers with
  disjoint seams), three recommended; fewer on any file, runtime, test, or
  seam overlap. Helper agents (planners, auditors, reviewers, report
  writers, watchdogs, QA-lane dispatch), spawnable by the orchestrator or a
  node within its scope, own no worktree or seam and sit outside the node
  ceiling. Owner gates are unchanged.
- Read-only exploration, tests, and review may run in parallel. Parallel
  writers require separate branches/worktrees and disjoint ownership. Only one
  writer owns a file or integration seam at a time.
- Workers do not merge, close issues, reorder dependencies, widen scope, or
  create undeclared sibling work. The orchestrator reconciles their results
  into one authoritative decision.
- Agree on acceptance and verification before writing. Prefer the smallest
  correct change; do not add a scheduler, graph database, knowledge graph,
  framework, or abstraction unless the current issue requires it.
- Identify every tested candidate by immutable commit SHA.
- A node reaches handoff after focused checks, one settled required repository
  suite, required CI, and one blocker-focused review. Repeat a gate only after
  a relevant change or a demonstrably transient failure.
- Retry an unchanged transient operation once. Diagnose repeated failures and
  record a concrete Blocked state and unblock condition instead of looping.
- Put non-blocking residuals in linked, evidence-backed follow-up issues rather
  than expanding the current PR.

## Worktrees and durable evidence

- Use one isolated worktree per active mutating graph node. A branch may be
  checked out in only one worktree.
- Worktrees and agent sessions are disposable execution state, not campaign
  memory or authority.
- Durable state belongs in GitHub, tracked documents, commits, CI, or retained
  artifacts. Ignored files do not travel through commits, PRs, clones, or
  other worktrees.
- Do not remove a worktree until its PR is merged or abandoned, required
  evidence is durable, uncommitted files are reconciled, and no active process
  depends on it. Then remove it and prune stale registrations.

## Maintainer evaluation boundary

- Maintainer evaluation infrastructure under `scripts/evaluation/` and
  `tests/evaluation/` evaluates the distributed skill but must not redefine or
  be mirrored into `qa-suite/`. It is deliberately excluded from
  `qa-suite.skill` and `qa-suite-source.zip`.
- Preparation, protocol, browser closure, report binding, and previews remain
  `verification_status: "unverified"`, `qualification: "not-evidence"`, and
  `result: null` unless every missing qualifying claim is proven.
- Do not promote an evaluation record until a reviewed qualifying host and
  sandbox adapter proves every missing claim.
- Closed-artifact consumers read the controller-captured snapshot, never the
  mutable lane tree. Read the evaluation authority before changing this
  surface.

## Release boundary

- Release automation and version-only PRs must not edit `qa-suite/`. Feature
  PRs update the skill first and mirror its public contract only where needed.
- The only published assets are `qa-suite.skill` and `qa-suite-source.zip`.
  They contain byte-identical ZIP data built from `qa-suite/` at the exact Git
  ref, never from a working tree.
- Generated archives and QA evidence are ignored and must not be committed.
- Publication requires the documented owner-admin and human gates. Never
  clobber assets, move a frozen tag, or publish/delete a release outside
  [`docs/releasing.md`](docs/releasing.md).

## Verification and handoff

Before PR handoff, run:

```sh
node --test
node scripts/release/check.mjs --ref HEAD
git diff --check origin/main...HEAD
```

Report exact commands and outcomes, frozen commit, PR, retained findings, and
the remaining human gate.
