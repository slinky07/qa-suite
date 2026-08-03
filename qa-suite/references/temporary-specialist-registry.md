# Temporary specialist registry

The temporary specialist registry is optional committed project state. It
defines bounded QA questions for material risks that none of the ten shipped
lanes owns. A registry entry is not a shipped lane, a model configuration, or
permission to run automatically.

## Selection and identity

Select a temporary specialist only when the affected risk is material and the
shipped lane boundaries leave it unowned. The orchestrator records the exact
identity and a run-specific selection rationale in its dispatch record and
final synthesis. It does not pass that rationale to the specialist.

`qa-context.md` declares the optional path as:

```text
- **Temporary specialist registry:** N/A
```

Replace `N/A` with a tracked repository-relative JSON path when the project
uses temporary specialists. The registry must be a regular, non-ignored file
inside the repository and outside the report folder. Existing contexts without
the field remain valid until a temporary specialist is selected or referenced.

The registry conforms to `temporary-specialist-registry.schema.json`. Each
entry contains one provider-neutral behavioral contract:

- a portable lowercase `slug`;
- `specialist_perspective`, `primary_question`, and `specialist_mission`;
- non-empty `priorities`, `decision_rules`, and `evidence_requirements`;
- non-empty `scope_exclusions` and `selection_criteria`;
- a `definition_rationale` that explains why no shipped lane owns the risk;
- a time box from 15 through 240 minutes; and
- a derived content-addressed `id`.

The ID is
`temporary-qa-<slug>-<sha256>`. The digest binds domain-separated canonical
JSON for every entry field except `id`. Object key order does not affect the
digest. Array order remains part of the contract.

Entries are immutable and append-only. A changed question, priority, evidence
rule, exclusion, criterion, rationale, or time box creates a new identity.
There is no mutable latest, active, retired, update, or delete operation.
Discovery and confirmation always name one exact ID. Never substitute another
entry with the same slug.

## Safe registry operations

Use the dependency-free helper. Do not edit referenced entries by hand.

```sh
node <qa-suite-root>/scripts/specialist-registry.mjs init \
  --repo <target-repo> --context qa-context.md
node <qa-suite-root>/scripts/specialist-registry.mjs validate \
  --repo <target-repo> --context qa-context.md
node <qa-suite-root>/scripts/specialist-registry.mjs register \
  --repo <target-repo> --context qa-context.md \
  --definition <definition.json> --expected-sha256 <registry-digest>
node <qa-suite-root>/scripts/specialist-registry.mjs resolve \
  --repo <target-repo> --context qa-context.md \
  --id <exact-id> --projection dispatch
```

`register` derives the ID, takes an exclusive sibling lock, re-reads the
registry, compares its SHA-256 digest, appends one entry, and atomically
replaces the file. A stale digest or duplicate identity fails loudly.

`resolve --projection dispatch` returns only the identity, perspective,
question, mission, priorities, decision rules, evidence requirements, scope
exclusions, and time box. It omits `selection_criteria`,
`definition_rationale`, and every sibling definition so selection reasoning
does not steer the specialist.

The schema is closed. It has no model, provider, tool, command, permission,
credential, or network field. Registry text never overrides the canonical
dispatch envelope, report contract, severity matrix, or hard boundaries.

## Ledger and confirmation

Finding-ledger schema v2 accepts a temporary identity only after the helper
resolves that exact entry. Temporary findings default to sensitivity
`uncertain` and redacted or sidecar-local storage until a human supplies the
existing clearance contract. The ordinary ledger write path never changes the
owning identity.

An unresolved finding retains the exact temporary identity that discovered it.
Confirmation resolves that historical definition and receives only its normal
confirmation manifest. If the entry is missing, confirmation is `Blocked` with
the missing ID as the blocker. The lifecycle row does not change, and the
orchestrator never falls back to another identity.
