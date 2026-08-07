# Finding reconciliation protocol

This document defines version 1 of QA-Suite's programmatic reconciliation
contract. It complements finding-ledger.md: the ledger contract validates the
rows it receives, while this protocol proves that every proposal from every
completed selected lane received exactly one explicit disposition.

The protocol is the authority for the dependency-free
`scripts/finding-reconciliation.mjs` helper. A schema-valid ledger without a
verified reconciliation receipt does not prove proposal completeness and no
host may claim that it does.

## Trust boundary

Deterministic tooling owns proposal inventory, schema validation, digests,
completeness accounting, provenance checks, locking, compare-and-swap,
transaction recovery, ledger publication, and persistence reporting. It fails
closed and never invents, repairs, or silently drops a decision.

An AI orchestrator owns only bounded semantic judgment. For each validated
proposal it selects one allowed disposition, identifies any candidate stable
findings it compared, names the comparison fields it used, and supplies a safe
explanation. Titles never establish identity. Component narrows the candidate
set but does not prove a match. Uncertainty favors a separate finding over a
false merge.

Lane agents remain blind to the complete ledger and sibling reports. A lane
emits only its own immutable Markdown report and its own versioned proposal
sidecar. It never reads or writes a proposal inventory, decision receipt, or
ledger. Host adapters transport the versioned structured values; they do not
redefine the protocol.

The human retains the commit, review, tracker, merge, and release gates.
Neither the helper nor the orchestrator stages or commits reconciliation
output.

## Versioned artifacts

All JSON artifacts use UTF-8 without a byte-order mark and one trailing LF.
Artifact SHA-256 values cover the exact persisted bytes. Canonical JSON is the
recursively key-sorted compact JSON representation; semantic array order is
preserved, set-like arrays use the stable orders below, and numbers outside the
schema's integer fields are forbidden. This rule is host-independent and does
not depend on object insertion order or Markdown rendering.

A lane computes source_content_sha256 over its canonical source proposal with
that field omitted, before any redaction. Inventory tooling computes
content_sha256 over the canonical durable proposal projection with that field
omitted. The source digest binds withheld local bytes; the content digest binds
the safe tracked projection. A digest is continuity evidence, not permission to
publish the source bytes.

### Dispatch manifest

Before lane dispatch, the orchestrator freezes the candidate and every selected
execution in a manifest conforming to
finding-reconciliation-dispatch-v1.schema.json. The tracked location is:

    qa-reconciliation/<run-id>/dispatch-manifest.json

Run IDs are portable filename segments: they exclude `:`, trailing dots, and
Windows reserved device basenames so identical tracked paths work on every
supported host.

Each selected execution has one stable execution_id, lane identity, expected
report pointer, and expected sidecar pointer. Selection reasons stay in the
orchestration record and are not injected into lanes. The manifest uses
exclusive create and is immutable. Without this manifest, completeness cannot
distinguish an unselected lane from a selected execution omitted before
inventory.

### Lane proposal sidecar

Each completed selected lane writes one sidecar beside its ignored report,
using the same base name and the suffix .proposals.json. It conforms to
finding-proposals-v1.schema.json and binds:

- run and selected-execution identity;
- the frozen candidate;
- exact lane identity;
- report pointer and exact report-byte SHA-256;
- a report-local proposal ID and source-content SHA-256;
- component, location, oracle, Severity, Priority, and sensitivity proposal;
  and
- a sanitized comparison record or a local-sensitive comparison record.

An empty proposals array is an explicit zero-proposal result. A missing sidecar
is not equivalent to an empty one. Duplicate local IDs, a changed report,
candidate drift, malformed content, or a digest mismatch blocks inventory
creation.

A sanitized comparison carries only the ordered reproduction, expected result,
actual result, environment, and safe evidence references needed for
conservative comparison. Sensitive content uses comparison storage
sensitive-local in this ignored, untracked sidecar. Inventory tooling verifies
its source digest, then emits only a withheld marker and safe references into
tracked state. It refuses a sidecar that is tracked or not ignored.

Lane proposals cannot claim human-cleared sensitivity. Only the existing human
clearance authority may later change ledger storage, with its required
authority, time, and safe reason.

### Proposal inventory

The orchestrator freezes every completed selected sidecar into one inventory
conforming to finding-reconciliation-inventory-v1.schema.json. The default
tracked location is:

    qa-reconciliation/<run-id>/proposal-inventory.json

The inventory repeats only the sanitized comparison projection needed for
resumption. It binds the dispatch manifest, each completed source report and
sidecar digest, any selected execution that was gated or blocked before a
report, the candidate, the previous ledger path, schema, digest, and row count,
and a unique composite proposal identity:

    execution ID + lane + report SHA-256 + report-local proposal ID
    + source-content SHA-256 + durable-content SHA-256

The complete selected-execution set from the dispatch manifest must equal the
disjoint union of inventory reports and explicit unexecuted records. Every
completed execution contributes exactly one report and sidecar. An unexecuted
record names its gated or blocked state and a safe reason. Missing, extra, or
multiply represented execution IDs fail closed.

Inventory freeze requires the canonical finding ledger to be tracked and
byte-identical to `HEAD`. A dirty, staged-only, or untracked predecessor fails
with an explicit commit gate. This guarantees that crash recovery and later
historical verification can retrieve the exact pre-write ledger bytes rather
than guessing from a mutable working tree.

Durable proposal projections omit lane-authored titles, locations, oracles, and
local-sensitive comparison bytes. Every persisted string is sanitized. A
withheld projection retains safe component, Severity, Priority, sensitivity,
both digests, and a safe blocked marker. When even the component cannot be
safely named, the proposal blocks for approved manual handling instead of
inventing or leaking a label.

Inventory creation uses exclusive create. The same run_id and identical bytes
are an idempotent success; the same run_id with different bytes is a hard
conflict. Once frozen, an inventory is immutable. Changed reports, sidecars,
candidates, or ledger input require a new run rather than an edit.

### Decision envelope

Bounded semantic judgment is transported in an ignored decision envelope
conforming to finding-reconciliation-decisions-v1.schema.json. It binds the
run, frozen inventory path and digest, candidate, canonical reconciliation
timestamp, optional superseded run, every proposal decision, and the exact
candidate-ledger path and digest when ledger changes are proposed. It contains
no summary, persistence claim, or finding-results grouping for the agent to
guess; deterministic tooling derives those values for the receipt.

The AI-authored draft decision envelope is ignored and must use
`candidate_ledger: null`; it contains bounded semantic decisions, not ledger
bytes. The deterministic `materialize` command verifies those decisions,
copies every predecessor row, evolves only named stable findings, creates only
named new findings, and emits both the complete ignored candidate ledger and a
finalized ignored decision envelope bound to its path and digest. Unrelated
rows are never presented to the AI and survive byte-identically. A blocked-only
or rejected-only run needs no candidate ledger. Created or matched dispositions
cannot coexist with a blocked disposition because no
stable row is published in a blocked run; rejected and blocked dispositions
may coexist. The helper validates candidate rows, stable identities, complete
candidate sets, and report provenance before retaining a receipt.

Every non-standard lane proposal must use local-sensitive comparison storage
before inventory freeze. Inventory withholds those bytes, `review` supplies the
fixed blocked decision, and `materialize` refuses to create a committed row
from it. This includes `security-s1-s2`, `uncertain`, and `human-sensitive`
proposals; no host may downgrade them to `standard` or publish their defect
record without the separate human-clearance contract.

### Reconciliation receipt

After decisions verify, tooling creates one sanitized receipt conforming to
finding-reconciliation-receipt-v1.schema.json at:

    qa-reconciliation/<run-id>/reconciliation-receipt.json

The receipt binds the dispatch-manifest and inventory paths and digests;
candidate identity; every proposal identity and both proposal digests; every
disposition; the candidate finding IDs and evidence fields used for semantic
judgment; grouped stable-finding provenance; reconciliation timestamp; ledger
path, schema version, pre-write and post-write digests and row counts; result
counts; and publication-time persistence state.

The dispatch manifest, inventory, and receipt are sanitized, tracked audit
artifacts. They never contain raw reports, screenshots, private consumer paths,
credentials, sensitive defect details, or withheld comparison content. They
are retained with the ledger for the life of the repository. A correction
creates a new run and receipt that names the superseded run; committed
artifacts are never rewritten in place.

Report and sidecar pointers may later dangle, but their digests and sanitized
inventory projection remain. A fresh clone can therefore validate a committed
receipt without the ignored source reports. It cannot re-judge withheld content
and reports that limitation exactly.

## Dispositions

Every inventoried proposal receives exactly one disposition:

| Disposition | Meaning | Stable finding ID |
|---|---|---|
| created | A distinct, validated product finding creates a new immutable ledger identity. | Required |
| matched | Evidence proves the same defect identity as one named ledger row; the proposal and report become provenance. | Required |
| rejected | The proposal is not a validated product finding; a safe reason and explanation are retained. | Forbidden |
| blocked | Safe reconciliation cannot complete; the receipt names the exact unblock condition. | Forbidden |

The rejection reason codes are unsupported-evidence,
tooling-or-environment-failure, assumption-as-finding,
duplicate-of-named-stable-finding, candidate-mismatch, and
malformed-or-incomplete-proposal. The duplicate rejection is limited to an
administrative duplicate already represented by another proposal from the same
report; a proposal from another lane or report that evidences the same defect
is matched so its provenance is preserved.

Blocked reason codes are sensitive-manual-handling, candidate-drift,
report-drift, proposal-drift, ledger-drift, and
manual-semantic-review-required. A blocked decision includes a non-empty,
actionable unblock_condition.

An S1/S2 or P0 proposal remains in the receipt's prominent-risk set until it is
created, matched, explicitly rejected, or blocked. High impact never bypasses
evidence validation. Silent omission is not a disposition.

## Completeness and provenance invariants

Verification is linear in the number of proposals and selected executions,
O(n), using composite-ID maps and stable-finding indexes. It must:

1. account once for every dispatch-manifest execution as completed, gated, or
   blocked, and distinguish a valid empty sidecar from a missing one;
2. reject duplicate report identities, sidecar identities, report-local IDs,
   and composite proposal identities;
3. require exactly one decision for each inventoried proposal;
4. reject unknown proposals and multiple decisions for one proposal;
5. reject created or matched IDs absent from the candidate ledger;
6. reject immutable ledger identity changes, row deletion, removed report
   provenance, and candidate, report, proposal, or ledger digest drift;
7. require each finding_results group to equal the complete set of created and
   matched proposal identities for its stable finding ID;
8. require candidate ledger report pointers to preserve every contributing
   lane, report, and candidate identity;
9. recompute created, matched, rejected, blocked, unresolved, and
   prominent-risk counts instead of trusting supplied totals; and
10. fail before publication unless unresolved is zero.

A receipt with explicit blocked decisions may be retained with
blocked-not-published; it is complete accounting but not a reconciled ledger. A
publishable receipt requires both blocked and unresolved to be zero.

Candidate selection for semantic review first indexes ledger rows by exact
component. The read-only `review` command accepts one exact component from a
frozen inventory and returns only that component's safe proposals plus the
exact-component candidate rows and IDs from the committed predecessor ledger.
It never persists another protocol artifact and never injects the full report
corpus, full ledger, or lane-authored title. A withheld proposal includes the
verifier's fixed blocked-decision fields without its local-sensitive bytes.
The AI may still split from all candidates, merge
multiple same-component proposals conservatively, or block for manual review.
It resolves the component task as one unit. After selecting any new stable IDs,
each decision names the canonical predecessor candidate IDs plus every new ID
created for that component, excluding its own new ID only for its `created`
decision. The verifier recomputes and requires that exact set.

After all component decisions are combined into one schema-valid draft
envelope, `materialize` performs the non-semantic ledger work. It validates
decision identity and complete proposal accounting against the frozen
inventory, constructs the full candidate ledger without asking the AI to copy
unrelated rows, validates the ledger transition, and binds its digest into the
finalized envelope. Repeating the command with identical inputs is an
idempotent success; differing bytes at an existing output path fail closed.

Set-like arrays have one canonical order: selected executions, inventory
reports, and unexecuted records by execution_id; proposals within a sidecar or
report by local_id; receipt decisions and prominent risks by the composite
proposal identity; finding_results by stable_finding_id; proposal references
within a finding result by composite identity; candidate finding IDs and report
pointers by Unicode code point; and evidence fields by their schema enum order.
Ordered reproduction steps preserve lane order. Safe and local evidence
references sort by Unicode code point. Ties are invalid, not
implementation-defined.

reconciled_at is a canonical UTC timestamp frozen in the validated decision
envelope. It is part of the exact input set, retained in the transaction
journal, and reused by every retry and host adapter. Given the same manifest,
inventory, ledger, draft decision envelope, and timestamp, materialized
candidate outputs are byte-identical across hosts.

## Transaction and recovery

Inventory freeze and reconciliation use a run lock plus the existing ledger
sibling lock, acquired in canonical path order. Reconciliation compares the
current ledger SHA-256 with the inventory's previous digest before any staged
output is accepted. The repository must ignore that exact sibling lock and its
owner/recovery artifacts; a broad dependency-lock ignore is not permitted.

Because a ledger and receipt are two files, publication uses a sanitized
transaction journal in the run directory rather than pretending two renames
are atomic. The journal records only paths, digests, phases, and timestamps. It
must never be tracked. Staged files are written in their destination file
systems, flushed, validated, and renamed in this order:

1. write and verify the candidate ledger, candidate receipt, and journal;
2. atomically replace the ledger and advance the journal;
3. atomically publish the receipt and advance the journal;
4. verify both published digests; and
5. remove staged files, journal, and locks.

On retry, tooling inspects the journal and exact bytes. Prior ledger plus no
receipt resumes before publication. Candidate ledger plus a verified staged
receipt resumes receipt publication. Candidate ledger plus matching receipt
finalizes cleanup. A receipt without its candidate ledger, unexpected bytes,
missing staged data, an unrecognized phase, or any third digest fails closed
with the exact manual recovery condition. It never rolls back or guesses.

The delivery workflow forbids worktree disposal while a journal, staged file,
or uncommitted reconciliation artifact remains. Retrying the same frozen
inventory and exact decision set reuses the original reconciled_at and produces
byte-identical candidate outputs. A changed decision set is a new attempt and
must not overwrite a published receipt.

## Persistence state and handoff

The immutable receipt records one publication-time state:

- blocked-not-published means all proposals are accounted for, but at least one
  blocked decision prevented a ledger write; or
- pending-human-commit means receipt and ledger were published to the working
  tree and verified, but durability has not been established.

A blocked receipt is exclusive-created without replacing the ledger and may be
committed as the durable unblock record. It never enters the two-file ledger
publication transaction.

Current persistence is derived, not guessed from that historical field. A
verification command compares the dispatch manifest, inventory, receipt, and
ledger bytes with HEAD:

- all four exact artifacts in the same reachable commit:
  durable-committed;
- exact working-tree bytes not all in that commit: pending-human-commit;
- any unexpected manifest, inventory, receipt, ledger, working-tree, or HEAD
  relationship:
  blocked-recovery-required.

This avoids the impossible self-reference of editing a committed receipt to say
that the receipt itself is committed. Until durable-committed is proven, final
synthesis uses the exact state:

    Ledger reconciled; persistence pending human commit

The handoff reports ledger path and schema version; dispatch manifest,
inventory, and receipt paths and SHA-256 values; pre-write and post-write ledger
SHA-256 values; previous and resulting row counts; created, matched, rejected,
blocked, and unresolved counts; prominent S1/S2 and P0 dispositions; whether
all four artifacts are tracked; whether each differs from HEAD; and the exact
files the human must review and commit.

A later run checks for a journal, staged files, or an uncommitted or mismatched
dispatch manifest, inventory, receipt, and ledger before reading the older
committed ledger. It blocks with an explicit recovery decision instead of
treating committed history as the complete current state.

## Compatibility and rollout

Reconciliation protocol version 1 accepts existing homogeneous ledger schema
version 1 or 2 without rewriting it. A version-1 ledger remains limited to its
seven original lanes. Selecting a newer shipped or temporary identity still
requires the existing explicit migration to ledger schema version 2 before
inventory freeze. Empty ledgers start at version 2.

Protocol, dispatch, sidecar, inventory, and receipt schema versions evolve
independently from ledger schema versions. Unsupported versions fail before
semantic review. No compatibility adapter may discard fields, infer decisions,
mutate an immutable ledger identity, or auto-migrate persisted state.

R1 defines and schema-lints the data contracts. R2 implements behavioral
validation, inventory construction, completeness verification, transactions,
and recovery. R3 integrates the protocol into the orchestrator and host
adapters. R4 supplies adversarial and control fixtures, cross-host
compatibility, installed-payload verification, and release proof. Each phase
must preserve the issue's human gates and may claim only the behavior actually
implemented and verified in that phase.

## Helper commands

The canonical helper commands are `dispatch`, `inventory`, `review`,
`materialize`, `reconcile`, `recover`, and `verify`. Each accepts `--repo`;
commands that read the finding ledger also accept `--context`. The read-only
`review` also requires the frozen inventory and one exact component and emits
canonical JSON to standard output; all supported hosts transport those bytes
unchanged.
`materialize` accepts the frozen inventory, the AI-authored draft decisions,
and separate candidate-ledger and finalized-decision output paths. Timestamps
are explicit inputs rather than wall-clock defaults. Dispatch, inventory, and
receipt locations derive from the validated run ID. The helper never stages,
commits, pushes, merges, or deletes Git state.
