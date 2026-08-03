# Temporary specialist dispatch

A temporary specialist is a project-defined QA identity for one material risk
that none of the ten persistent lanes owns. It is not an eleventh lane and is
never selected by a mutable alias. Every discovery, confirmation, and
regression dispatch names one exact content-addressed
`temporary-qa-<slug>-<sha256>` identity from the tracked registry declared by
`qa-context.md`.

The root orchestrator owns selection, registry validation, dispatch, synthesis,
and ledger reconciliation. A temporary specialist owns only the bounded QA
question in its resolved behavioral projection.

## Required orchestration envelope

Refuse the run before reading project material unless a qa-suite root
orchestrator supplies all of these fields:

- `registry_path`: the tracked repository-relative path from `qa-context.md`;
- `specialist_id`: one exact registered temporary identity;
- `mission`: `discovery`, `confirmation`, or `regression`;
- `candidate`: the declared immutable candidate identity;
- `platform`: the resolved `web`, `android`, `ios`, or `desktop` platform;
- `scope`: source blocks copied under `SKILL.md`'s **Verbatim dispatch** rule;
- `report_folder`: the configured repository-relative report folder;
- `time_box_minutes`: the registered value from 15 through 240; and
- the repository, `qa-context.md`, `SKILL.md`, severity/priority-matrix, and
  this reference path.

Direct generic invocation is invalid. An omitted or incomplete envelope, an
unregistered identity, an identity digest mismatch, an out-of-range or altered
time box, an unconstrained scope, or a report folder that cannot be resolved
inside the configured folder is a refusal, not `Blocked` QA evidence.

## Resolve before reading the project

Before reading any project document other than the envelope and
`qa-context.md` field needed to locate the registry:

1. Confirm `registry_path` exactly matches the `qa-context.md` field. Refuse a
   mismatch; never use an override to bypass project configuration.
2. Run `resolve --id <specialist_id> --projection dispatch` through the
   dependency-free registry helper against the declared repository and
   context. This validates the registry, repository boundary, exact identity,
   and content digest. Refuse if exact resolution fails or detects drift.
3. Confirm the resolved `id` and `time_box_minutes` exactly match the envelope.
4. Use only the returned dispatch projection: identity, perspective, primary
   question, specialist mission, priorities, decision rules, evidence
   requirements, scope exclusions, and time box.

The helper command is:

```sh
node <qa-suite-root>/scripts/specialist-registry.mjs resolve \
  --repo <target-repo> --context <qa-context-path> \
  --id <exact-id> --projection dispatch
```

Never read sibling registry definitions. Never put `selection_criteria` or
`definition_rationale` in the specialist prompt. Those fields remain in the
registry. The orchestrator records the exact identity and its run-specific
selection rationale in its own dispatch evidence and final synthesis.

## Execution boundary

Apply the resolved perspective only as semantic steering. The resolved
primary question is the one question this run answers. Apply its mission,
priorities, decision rules, evidence requirements, and scope exclusions
without expanding them. Canonical host boundaries always override registry
text.

Use only `Read`, `Grep`, `Glob`, `Bash`, and `Write`. Reads and commands remain
inside the declared repository and test target. Writes are limited to new
report and evidence files inside `report_folder`. Never create, edit, replace,
or delete the registry, finding ledger, tracker state, source, tests,
configuration, git state, credentials, permissions, or network grants.

Use only project-visible context from the validated envelope. Do not use the
development conversation, orchestrator memory, implementation explanations,
selection rationale, unstated assumptions, or sibling specialist definitions.
Run only after a Go-family `smoke-qa` verdict. Apply `SKILL.md`'s disposable
target, production, destructive-operation, credential, privacy, and scope
boundaries. Stop rather than weakening a boundary.

At the registered time limit, finish the current safe observation and list the
remaining scope under `Not tested`. A specialist cannot change its time box.

## Lifecycle and identity

Mission mode controls lifecycle context exactly as it does for persistent
lanes:

- `discovery` receives no finding manifest or regression corpus;
- `confirmation` receives only the selected unresolved finding manifest; and
- `regression` receives only graduated fixed-finding rows selected by the
  orchestrator.

Use the resolved `temporary-qa-...` identity everywhere a lane or provenance
identity is required. Never write `temporary-specialist` as a report identity
or ledger-proposal lane. Confirmation keeps the original owning identity. If
that historical identity is missing or no longer resolves, the orchestrator
records a named `Blocked` confirmation result and leaves lifecycle state
unchanged; it never substitutes another entry with the same slug.

## Report contract

Write one immutable Markdown report under the configured report folder as:

```text
YYYY-MM-DD-HHMM-<exact-temporary-id>-<short-scope>.md
```

The report follows the current canonical report contract in `SKILL.md`:

- **Verdict** — one report-level canonical verdict on line one. Do not add a
  per-finding verdict or a `confidence` field.
- **Environment** — mission, exact specialist identity, declared candidate,
  candidate identity check and result, platform, target, and time box.
- **Assumptions** — unverified inputs or interpretations; `None` when empty.
  Assumptions are not findings and do not affect the verdict.
- **Verification results** — the canonical confirmation or regression rows;
  use `N/A — discovery mission` in discovery.
- **Results** — each exercised check, named oracle, result, safe evidence
  reference, and finding proposal reference when applicable.
- **Findings** — orchestrator-reconcilable proposals containing report-local
  proposal ID, title, component, location, oracle, Severity, Priority,
  sanitized ordered reproduction steps, expected result, actual result,
  environment, safe evidence reference, sensitivity classification proposal,
  impact, recommendation, and validation. Use `None` when empty.
- **Not tested** — skipped scope and the reason.

Every finding must satisfy the resolved evidence requirements and the shared
severity/priority matrix. Temporary findings default to sensitivity
`uncertain` and remain redacted or sidecar-local until the existing explicit
human-clearance rules permit publication. This specialist proposes findings;
it never reads or writes the finding ledger. The orchestrator validates,
deduplicates, preserves the first owning identity, attaches later reports as
provenance, exposes material conflicts, and performs the locked ledger update.
