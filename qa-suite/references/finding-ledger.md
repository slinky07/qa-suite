# Finding ledger

The finding ledger is a committed JSON Lines current-state file. It gives
software defects durable identity and lifecycle without turning disposable QA
artifacts into a database.

## Three evidence tiers

| Tier | Retention | Git | Purpose |
|---|---|---|---|
| Evidence | Prunable | Ignored | Raw logs, screenshots, traces, requests, and other material that may contain tokens or session data |
| Reports | Disposable, immutable after creation | Ignored | One immutable lane-run record; provenance pointers may outlive the file |
| Findings | Current state | Committed | Self-sufficient facts about defects, their lifecycle, and sanitized test basis |

Reports and evidence stay under the configured report folder. The ledger must
not. The sensitive-sidecar path must also be absent from every commit reachable
through local Git refs; deleting it in a later commit cannot make history
private. Moving prose from a report into the ledger does not make it safe to
commit; sanitize it first.

## File contract

- qa-context.md declares one repo-relative ledger path. The default is
  `findings.jsonl`.
- Absolute paths and paths that escape the repository are invalid.
- The ledger must not resolve inside the configured report folder.
- First-run setup runs
  `git check-ignore --no-index -- <ledger-path>`. Exit status 0 is a hard
  failure because the path is ignored.
- An empty ledger is a zero-byte file. Its first row uses schema version 2.
  Every non-empty line is exactly one JSON object conforming to the schema for
  its homogeneous file version. Blank, comment, header, array, and tombstone
  lines are invalid.
- IDs are unique and stable. The ordinary write path never deletes a row,
  renumbers an ID, or reuses an ID. A deletion requires a separate,
  schema-versioned governed migration. Git history is the audit log; the file
  holds only current rows.
- `schema_version` is mandatory. A ledger cannot mix versions. The frozen
  `finding-ledger-v1.schema.json` accepts the original seven lanes. Canonical
  `finding-ledger.schema.json` is version 2 and accepts all ten shipped lanes
  plus registry-resolved temporary identities. A reader that does not support
  a row's version fails before dispatch instead of guessing or rewriting it.

The human commits the initial empty ledger with qa-context.md. On later runs,
the orchestrator validates the entire file before lane dispatch. Missing,
ignored, duplicate-ID, malformed, or unsupported rows stop the run loudly.

## Row model

Each row contains a lifecycle skeleton and a defect record.

The lifecycle skeleton is always committed:

- `id`, `schema_version`, `lane`, `severity`, `priority`
- `component`, `location`, `oracle`
- `status`, `status_reason`
- `candidate_first_seen`, `candidate_last_confirmed`
- `first_seen`, `last_seen`, `occurrences`
- `reports`, `sensitivity`

Verdict computation, occurrence counts, visibility selection, and future
supersession use only this skeleton. `accepted` and `wontfix` require a
non-empty, human-provided `status_reason`; the canonical decision semantics
remain in `SKILL.md`.

The committed defect record contains:

- sanitized, ordered `repro_steps`;
- `expected_result`;
- `actual_result`;
- `environment`.

A row is under-specified when a maintainer needs a linked report to understand
the defect. Report pointers are provenance, not missing paragraphs. They may
point to ignored local reports, CI runs, private advisories, or trackers and
may dangle later.

`candidate_first_seen` and `candidate_last_confirmed` are opaque candidate
identifiers such as full commit SHAs, build IDs, or release tags. `first_seen`
and `last_seen` are UTC `Z` timestamps with seconds from `00` through `59` and
any positive fractional precision; leap seconds are outside the version-1
contract. `last_seen` never precedes `first_seen`. `occurrences` counts
distinct candidate cycles in which the defect was confirmed; two lanes
confirming it in one cycle add provenance but only one occurrence. Each write
advances at most one occurrence and requires a new
`candidate_last_confirmed`, a later `last_seen`, and a new report pointer for
that candidate. A new row starts at occurrence 1 with the same first and last
candidate. One report pointer may support multiple finding rows when every
occurrence binds it to the same exact opaque candidate identifier. A report
pointer is never repurposed for a different candidate.

The owning `lane` remains stable when another lane confirms the same defect.
Each report pointer records its own lane. Version 2 accepts
`temporary-qa-<slug>-<sha256>` only when the exact immutable identity resolves
through the tracked registry declared by qa-context.md. A pattern match alone
is never authorization.

`sensitivity` is an auditable marker with three fields:

- `classification`: `standard`, `security-s1-s2`, `uncertain`,
  `human-sensitive`, or `human-cleared`;
- `storage`: `committed`, `redacted`, or `sidecar-local`;
- `clearance`: `null`, except that `human-cleared` records carry the human
  decision authority, UTC time, and a safe reason.

Every string in the committed row is sanitized, including skeleton fields,
status reasons, candidate identifiers, and report pointers. Control
characters, credentials, tokens, session values, private keys, and
credential-bearing or signed URLs are forbidden outside the defect record too,
regardless of URL scheme. URL query and fragment keys and values are decoded
recursively before this check, and plain sensitive-key assignments are checked
against the same vocabulary. Encoding is not a sanitization boundary; decoded
control characters are forbidden too.

## Conservative matching

False merges destroy signal; false splits cost one duplicate row. Split when
equivalence is uncertain.

1. Compare `component`. Different components always split.
2. Matching components are merge candidates, not matches.
3. Compare the sanitized repro, expected result, actual result, environment,
   and current candidate evidence. Merge only when they establish the same
   failed behavior.
4. Never use a report title or finding title to match. `location` is
   descriptive free text and never participates in matching.
5. When no named component fits, keep a new free-form component and surface
   it to the human as a candidate qa-context.md vocabulary addition. Never
   force the closest label.

The match fixtures in `references/finding-match-fixtures.json` are normative
examples: one cross-lane defect merges, while two defects with the same
component split.

## Lifecycle visibility

Visibility controls injected context, not file permissions. The committed
ledger remains repo-visible.

| Mode | Injected rows |
|---|---|
| discovery | None |
| confirmation | `open` and `regressed` rows, copied verbatim |
| regression | `fixed` rows with a committed, sanitized defect record |

The orchestrator selects the rows and copies only the lifecycle-selected
fields required by the lane. It never injects the whole ledger. Fixed rows
without a sanitized committed defect record do not graduate into the
regression corpus.

The protocol that chooses a mode and verifies fixes belongs to the post-fix
lifecycle contract. This file defines only the storage and visibility
selection that protocol consumes. Absence from a report never implies
`fixed`.

## Redaction

Sensitivity is based on finding class, not current repository privacy.
Visibility can change; committed history cannot be made private later.

- `security-qa` S1/S2 records use classification `security-s1-s2` and default
  to redacted in every repository.
- Uncertain sensitivity uses classification `uncertain` and resolves to
  redacted.
- Every temporary-specialist finding defaults to `uncertain` and redacted or
  sidecar-local storage. Only the existing human-clearance contract permits a
  sanitized committed record.
- `repo_visibility: public` always forces those defaults and can never loosen
  them. A public `security-qa` S1/S2 row remains redacted even after a human
  sanitization decision, so it does not enter the committed regression corpus.
- `private` does not opt a row into full commitment. Only the human may clear
  a private sensitive row for a full, sanitized commitment. The row then uses
  `human-cleared` and retains the human authority, UTC time, and reason in
  `sensitivity.clearance`.
- Redaction removes only the defect record. The lifecycle skeleton remains.
- The preferred private record lives in the host's private advisory or
  tracker. Store `defect_record: "redacted"` and
  `sensitivity.storage: "redacted"` in the committed row.
- `QA/findings-sensitive.jsonl` is the gitignored fallback only. Mark its
  committed row `defect_record: "sidecar-local"` and
  `sensitivity.storage: "sidecar-local"`; clone survival is honestly lost.
- A sensitive finding may become `fixed` and enter the regression corpus only
  after the human supplies a sanitized committed defect record.

Lanes may propose sensitivity. The orchestrator may tighten to redacted, but
it never clears redaction or copies private details into the ledger.

## Reconciliation and write safety

Machine-verifiable proposal completeness is defined by
`finding-reconciliation.md`. This ledger contract proves structural and
evolution safety for the candidate rows it receives; a valid candidate ledger
alone does not prove that every report-local proposal was created, matched,
rejected, or blocked.

Lane agents write only their timestamped reports. After every selected lane
returns, the orchestrator:

1. parses all current rows and rejects invalid or duplicate IDs;
2. matches new lane findings conservatively;
3. updates existing rows or creates stable new IDs;
4. applies only mechanically authorized human lifecycle decisions;
5. redacts before writing;
6. validates every resulting row, committed string, unique-ID set, and
   ledger-wide report-pointer-to-candidate binding;
7. acquires the exclusive sibling lock, compares the current ledger SHA-256
   with the digest read before reconciliation, validates the current and
   candidate rows again, rejects deletion, immutable-identity changes,
   occurrence or time regression, and removed provenance, then atomically
   replaces the ledger;
8. reports the changed path and leaves staging and committing to the human.

The dependency-free helper at `scripts/finding-ledger.mjs` is the enforcement
point:

```sh
node <qa-suite-root>/scripts/finding-ledger.mjs validate \
  --repo <target-repo> --context qa-context.md
node <qa-suite-root>/scripts/finding-ledger.mjs preflight \
  --repo <target-repo> --context qa-context.md --lane <exact-lane-id>
node <qa-suite-root>/scripts/finding-ledger.mjs manifest \
  --repo <target-repo> --context qa-context.md --mode confirmation
node <qa-suite-root>/scripts/finding-ledger.mjs write \
  --repo <target-repo> --context qa-context.md \
  --candidate <validated-jsonl> --expected-sha256 <original-digest>
node <qa-suite-root>/scripts/finding-ledger.mjs migrate \
  --repo <target-repo> --context qa-context.md \
  --to 2 --expected-sha256 <original-digest>
```

Validation resolves regular files canonically inside the repository, rejects
an ignored or untracked ledger, checks the optional sidecar is ignored and
untracked, rejects duplicate JSON object keys and IDs, enforces contextual
redaction, and reports free-form components for human vocabulary review. The
dependency-free schema interpreter implements every keyword used by the
versioned schema, validates the schema itself before row evaluation, and fails
closed when an unsupported keyword or format, invalid pattern, or empty
applicator array appears.

A non-empty version-1 ledger remains valid and writable by its original seven
lanes. Selecting a new shipped or temporary lane stops before dispatch and
the `preflight` command returns the exact required migration command. Migration
uses the same exclusive lock and compare-and-swap discipline and changes only
`schema_version` from 1 to 2. It rejects an empty ledger, mixed versions, stale
digests, repeat migration, and downgrade. An empty ledger needs no migration.

Version-2 validation resolves every temporary owner and report-provenance
identity through the tracked JSON registry declared in `qa-context.md`, under
the contract in `temporary-specialist-registry.md`. Ordinary validation and
writes fail on a missing identity. A confirmation or regression manifest emits
a named `Blocked` disposition for an unresolved historical identity, preserves
the row, and never substitutes another entry with the same slug.

The write command uses an exclusive lock plus compare-and-swap. Atomic rename
alone is insufficient: a second writer with a stale digest fails instead of
silently erasing the first writer's rows. A leftover lock is a loud failure;
the human removes it only after confirming no reconciliation is active.
The write command is intentionally append-or-evolve: existing IDs and their
identity, first-seen facts, and report provenance cannot disappear. Destructive
cleanup requires an explicit, separately reviewed schema migration rather than
an ordinary reconciliation write.

The orchestrator never edits a lane report, appends event-history rows,
stages files, commits, moves tags, or mutates issues and pull requests as
part of QA.

Periodically, a maintainer should read one row without opening its reports.
If it does not explain the defect, enrich the sanitized defect record rather
than weakening the self-sufficiency rule.
