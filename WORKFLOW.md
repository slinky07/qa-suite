# QA-Suite engineering workflow

This document defines the repository's loop, dependency-graph, and harness
engineering contract. `AGENTS.md` contains the short mandatory map. This file
contains the operating detail that agents must read before a multi-step,
multi-agent, or multi-PR change.

## Terminology

| Term | Meaning in this repository |
|---|---|
| Loop engineering | The closed delivery loop for one bounded node: issue, implementation, verification, PR, feedback, and human merge. |
| Dependency-graph engineering | A directed acyclic graph of deliverable nodes. An edge means the downstream node cannot qualify until its dependency is resolved. |
| Harness engineering | The repository context, tools, isolation, tests, evidence, state, stop rules, and human gates that make agent work reliable. |
| Knowledge graph | An entity-and-relation store for multi-document reasoning. It is not the delivery graph and is outside this workflow unless an issue explicitly requires one. |

The graph schedules work. The harness constrains and verifies it. Each graph
node runs the delivery loop.

## Control plane and durable state

GitHub issues and PRs are the live control plane. Tracked repository documents,
commits, CI results, and retained artifacts are durable evidence. Chat context,
agent sessions, temporary directories, and worktrees are execution state, not
authority.

Before planning or reporting status:

1. refresh authenticated GitHub state with `gh`;
2. refresh the remote Git state;
3. read the issue and all owner comments;
4. read `AGENTS.md` and every authority it requires for the changed surface;
5. reconcile any plan with live merged and open PRs.

Do not keep the only authoritative plan under `/tmp`, in an ignored file, or
inside a disposable worktree.

For a multi-PR campaign, the parent issue must contain or link the dependency
graph. A long campaign may also use
`docs/exec-plans/active/issue-<number>.md`; introduce that file through a
planning PR, keep GitHub as the live status authority, and move the plan to
`docs/exec-plans/completed/` after closure. A routine single-PR issue does not
need an execution-plan document.

## Graph nodes

A routine issue is one node. A campaign issue may decompose into independently
reviewable PR nodes plus one final integration or closure node.

Every node records:

| Field | Required content |
|---|---|
| Issue | Dedicated issue, or the owning campaign issue and explicit node identifier |
| Outcome | One reviewable deliverable |
| Dependencies | Nodes that must merge or otherwise resolve first |
| Acceptance | Observable completion criteria and blockers |
| Owner | One writer, or one orchestrator for an integration node |
| Write scope | Files or seams the node may change |
| Base | Ref or merged dependency from which work starts |
| Workspace | Worktree path and `codex/issue-<number>-<slug>` branch |
| Verification | Focused checks, required suite, and CI gates |
| Evidence | Commit SHA, command results, artifacts, limitations, and findings |
| Handoff | PR URL, review state, and human action required |

Use these states:

- **Blocked**: a dependency or concrete acceptance blocker is unresolved. Record
  the blocker and the condition that will unblock it.
- **Ready**: every dependency is resolved and the write scope is available.
- **Active**: one owner is implementing or verifying the node.
- **PR review**: the candidate is pushed and its linked PR is under review or CI.
- **Human gate**: all automated gates are settled; owner action is required.
- **Done**: the PR is merged, required evidence is durable, and cleanup is safe.

**Parallelism is the default, not the exception.** On receiving any scope,
plan, or goal, the orchestrator's first analysis is the dependency graph and
its parallel width: enumerate every Ready node, prove which scopes are
disjoint, and dispatch them concurrently — worker nodes up to the ceiling,
helper agents alongside. Serial execution of independent Ready nodes is a
scheduling defect unless a shared file, seam, runtime, or capacity limit is
recorded at dispatch time. The single-worker habit of ordinary sessions must
not leak into graph campaigns.

Only Ready nodes may start. Reject dependency cycles. Independent nodes may be
authored concurrently, but dependent nodes merge in graph order. Prefer a fresh
branch from refreshed `origin/main` after each dependency merges, or from the
declared resolved dependency SHA; stacked branches require an explicit
campaign decision.

## Required node loop

Every mutating node follows:

`issue -> isolated worktree -> branch -> tested commit -> PR -> CI -> human merge`

1. **Frame**: establish the issue, authority, baseline, scope, acceptance
   criteria, verification, and human gate.
2. **Isolate**: create one issue worktree and branch from the declared base.
   Preserve the user's current checkout and unrelated work.
3. **Implement**: make the smallest correct change. Do not expand the node to
   absorb unrelated findings.
4. **Verify**: run focused checks, then the required repository suite. Freeze
   the candidate by commit SHA.
5. **Review once**: perform one blocker-focused review of the frozen candidate.
   Correct supported blockers; do not create repeated polishing loops.
6. **Publish**: push the branch and open or update the linked PR. A node with a
   dedicated child issue may use `Closes #<child-issue>` and
   `Part of #<campaign>`. When nodes share only the campaign issue, only its
   declared final PR uses `Closes #<campaign>`.
7. **Settle CI**: diagnose failures. Rerun only after a relevant change or when
   a failure is demonstrably transient.
8. **Handoff**: stop at the human merge gate unless the owner explicitly grants
   merge authority.

One issue normally produces one branch and one PR. Use multiple PR nodes only
when their outputs, dependencies, or review boundaries are genuinely distinct.

## Orchestrator and workers

The main agent is the formal orchestrator. It operates as the project's
delivery manager and senior architect: it plans, sequences, dispatches, and
reconciles the work of a worker team, and it enforces the plan, the
architecture, and this governance on every result. It owns:

- the interpretation of owner and issue authority;
- graph construction and readiness decisions;
- worker scopes and concurrency;
- integration, candidate freeze, and authoritative status;
- PR composition and the final human handoff.

The orchestrator holds standing authorization to use two distinct kinds of
parallel capacity, without per-wave owner approval. They are not the same
resource and are not counted together:

- **Worker nodes** are the unit of mutation. Each owns one graph node, one
  isolated worktree and branch, and one disjoint file or integration seam.
  One orchestrator can run several at once when the plan is large, their
  scopes cannot impact each other, and the disjointness was planned before
  dispatch — never as an accident of enthusiasm.
- **Helper agents** are spawned assistants: planners, auditors, reviewers,
  report writers, watchdogs, and dispatch of the distributed `qa-suite/`
  lanes against candidate work as QA evidence under the skill's own
  isolation rules. The orchestrator may spawn them, and a worker node may
  spawn its own within its declared scope. A helper never owns a worktree,
  seam, or graph node, writes nothing outside its parent node's worktree,
  and does not count against the worker-node ceiling; it is bounded by
  platform capacity and its parent's scope, and its results reconcile
  through whoever spawned it.

Spawning never transfers the owner gates: PR merge, issue closure, graph
reordering, releases, and safety-gated external calls stay with the human.

Workers receive a bounded objective, relevant authority, allowed tools, write
scope, acceptance criteria, and a precise done condition. They do not merge,
close issues, reorder dependencies, widen scope, or create undeclared sibling
work.

Use read-only workers by default for exploration, test execution, review, and
evidence analysis. Parallel write work requires separate branches/worktrees
and disjoint file or seam ownership. Only one writer may own a file or
integration seam at a time. The orchestrator reconciles all results and returns
one decision.

At most four worker nodes may run concurrently. Three is the recommended
default; choose the number from the workflow. Use four only when every
active node has fully disjoint files, runtime state, tests, and integration
seams. Use fewer than three when work shares any of them. Helper agents are
outside this ceiling.

Project authority is unchanged by orchestration: the original passive
fresh-user philosophy and the distributed `qa-suite/` lane contracts remain
the source of truth for what the product is and how candidate work is
judged. Worker output that conflicts with them is a defect, whatever the
concurrency.

## Harness contract

### Acceptance before implementation

Before writing, state:

- the requested outcome;
- the authoritative files and issue comments;
- the non-goals and protected surfaces;
- the exact completion and blocker conditions;
- the commands and evidence needed for handoff.

### Worktree isolation

Use one worktree per active mutating node. A branch may be checked out in only
one worktree. Worktrees are disposable sandboxes, not campaign memory.

Ignored files do not travel through commits, PRs, clones, or other worktrees.
Before removing a worktree, promote required evidence to a tracked file, attach
it to GitHub or CI, or archive it in an approved durable store.

Do not remove a worktree until:

1. its PR is merged or explicitly abandoned;
2. durable evidence is confirmed;
3. uncommitted and untracked files are reconciled;
4. no active agent or process depends on it.

Afterward, remove the completed worktree and prune stale registrations.

### Candidate identity and evidence

Verification claims must name the tested commit SHA. Record the commands,
results, relevant environment qualifications, CI links, retained artifacts,
and known limitations. Never reuse old QA proof as evidence for a changed
candidate.

### Stop and retry policy

A node is ready for human handoff after:

- focused tests pass;
- one settled required repository suite passes;
- required CI passes;
- one blocker-focused review finds no unresolved acceptance blocker.

Do not repeat a settled gate unless relevant source, configuration,
environment, or evidence changed. Retry an unchanged operation once only when
the failure is clearly transient. A repeated or non-transient failure requires
diagnosis, a corrective change, or an explicit Blocked state with evidence and
an unblock condition.

An unresolved acceptance blocker stops the node. A non-blocking imperfection
becomes a linked, evidence-backed follow-up issue rather than expanding the
current PR. Prefer closure over speculative completeness.

## Human and destructive gates

Human review is the default merge gate. Do not merge a PR, close an issue,
delete a remote branch, publish a release, move or delete a tag, delete a
remote release, or discard unreconciled work unless the owner explicitly
authorizes that action.

The final campaign PR must reconcile the graph, link constituent PRs and
evidence, name deferred findings, and state exactly what remains human-gated.

## Repository verification

Run the smallest relevant checks first. Before PR handoff, run:

```sh
node --test
node scripts/release/check.mjs --ref HEAD
git diff --check origin/main...HEAD
```

The release check is mandatory because repository metadata and release
contracts can affect the distributed artifact even when `qa-suite/` was not
edited.

Release preparation and publication additionally follow
[`docs/releasing.md`](docs/releasing.md). Maintainer evaluation work follows
[`tests/evaluation/README.md`](tests/evaluation/README.md).

## Informative engineering sources

These sources explain the engineering model. Repository authority remains in
the owner request, GitHub issues, `AGENTS.md`, this workflow, and the
surface-specific contracts.

- [OpenAI: Harness engineering](https://openai.com/index/harness-engineering/)
- [OpenAI: Symphony orchestration](https://openai.com/index/open-source-codex-orchestration-symphony/)
- [Anthropic: Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)
- [Anthropic: Harness design for long-running applications](https://www.anthropic.com/engineering/harness-design-long-running-apps)
- [Kimi: Parallel agents and dependency-aware execution](https://www.kimi.com/resources/parallel-agent)
