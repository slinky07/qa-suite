# Governance-aware issue proposals

This contract keeps serious QA findings from disappearing with ignored local
reports. It produces a durable, copyable handoff without granting QA permission
to mutate an issue tracker.

## Eligibility

Evaluate proposals only after lane evidence is validated, findings are matched,
and the finding ledger is reconciled. The current run's candidate set contains:

- a newly created finding; or
- an existing finding that materially changed in the current run, including a
  transition to `regressed` or a Severity, Priority, or affected-scope change
  that crosses the proposal threshold.

Do not emit the same unchanged proposal on every run.

The canonical default proposes an issue only when the candidate is actionable,
evidence-backed, and has an eligible lifecycle state. A state is eligible when:

- the finding status is `open` or `regressed`; or
- an `accepted` or `wontfix` finding has `Acceptance void — human review
  required` under the canonical Risk acceptance contract because current
  evidence shows higher Severity, wider scope, or a non-equivalent test basis.

The candidate must also meet at least one of these conditions:

- Severity is S1 or S2; or
- Priority is P0.

The `Additional proposal threshold` field in `qa-context.md` may broaden the
default, for example by adding P1 or a named S3 class. It never suppresses the
canonical default. Record the default and every applied addition in the
proposal.

An existing `qa-context.md` without `Issue proposal governance`, or with
`N/A` values, remains valid. Use the canonical threshold, portable Markdown,
and the repository-visible governance that is available. Missing optional
proposal fields are not a configuration migration or a dispatch blocker.

Never propose an issue for:

- an assumption, suggestion, or observed-only note that is not a finding;
- an unchanged finding from an earlier run;
- a `fixed` finding or a currently valid `accepted` or `wontfix` finding; or
- an S3/S4 and P1/P2/P3 finding unless repository-visible project context
  explicitly adds it to the threshold.

Acceptance-void eligibility does not change the human-set ledger status.
Preserve that status and the recorded reason in the proposal, and state why
current evidence voided its verdict exclusion.

Priority controls scheduling and Severity controls impact. Do not combine the
two axes or relabel either one to make a finding eligible.

## Governance discovery

The orchestrator, not a QA lane, reads repository-visible governance before it
formats a proposal. Use the repository's documented precedence. When no
precedence is documented, inspect these sources in order:

1. every applicable `AGENTS.md`;
2. the `Issue proposal governance` fields in `qa-context.md`;
3. README and contribution guidance;
4. architecture decisions, contracts, and acceptance criteria named by the
   repository;
5. issue templates and tracker configuration, including the repository's
   equivalent of `.github/ISSUE_TEMPLATE/`; and
6. read-only tracker metadata or search results only when they are already
   accessible.

Record the files or read-only sources used. A current implementation
conversation, agent memory, private assumptions, and inaccessible private
policy are not governance sources. If visible sources conflict on a
load-bearing rule, report the conflict and ask the human instead of choosing a
convenient interpretation.

Do not assume GitHub, a CLI, credentials, or network access. Use a repository
template when one exists. Otherwise produce portable Markdown that a human can
copy into GitHub, GitLab, Forgejo, Jira, or another tracker.

## Duplicate control

Search only through available read-only paths. Check:

- the finding row's stable ID and report or tracker pointers;
- repository-visible issue references;
- exact failed behavior, component, and named oracle; and
- the accessible tracker, when available.

For `security-s1-s2`, `uncertain`, `human-sensitive`, or other redacted
findings, never send the stable ID, failed behavior, component, oracle, or
evidence-derived search terms to a public or less-restricted tracker. Use only
an approved private lookup whose classification is at least as restrictive,
and use sanitized query keys approved for that destination. Otherwise search
only local safe pointers and record
`Sensitive tracker duplicate check: not performed — no approved private lookup`.

Do not match by title alone. Apply the finding ledger's conservative matching
rule: uncertainty favors two records over a false merge.

When an existing tracked item clearly covers the finding, output
`Existing tracked item` with its safe reference and do not produce a duplicate
proposal. When a possible match is unresolved, preserve the draft and state the
uncertainty. When tracker search is unavailable, state
`Tracker duplicate check: not verified — tracker unavailable`; never claim
that no duplicate exists.

## Proposal artifact

Put the complete redacted proposal in the final synthesis under
`Issue proposals`. Preserve the same copyable content in a new immutable local
artifact beside the run evidence:

```text
QA/YYYY-MM-DD-HHMM-issue-proposals-<short-scope>.md
```

Use the configured report folder instead of `QA/` when it differs. One artifact
may contain multiple proposals and existing-item results from the same run.
Create the artifact with exclusive-create semantics. If the base name already
exists, add the first unused numeric suffix before `.md`, starting with `-2`.
Never append to or overwrite an earlier artifact. Report the actual path used.
The artifact is orchestrator output, not a lane report; never modify a
completed lane report to add it.

Every proposal contains:

- `Finding` — stable finding ID and lifecycle status;
- `Proposed tracker` — named tracker or `portable Markdown`;
- `Title` — repository convention when visible, otherwise a concise fallback
  identified as such. The fallback is
  `<priority>: <concise imperative outcome>`; never invent a repository
  category;
- `Threshold` — Severity, Priority, and why the finding is eligible;
- `Affected scope` — component, location, and affected flow or population;
- `Environment` — tested candidate and relevant environment;
- `Reproduction or observations` — ordered sanitized steps or observations;
- `Expected result` and `Actual result`;
- `Evidence` — safe report, CI, advisory, or local evidence references;
- `Oracle` — the named contract, criterion, or standard;
- `Impact`;
- `Suggested acceptance criteria`;
- `Uncertainties`;
- `Not tested`;
- `Governance sources`;
- `Duplicate check`; and
- `Authorization` — the exact notice
  `Draft only — no tracker mutation occurred. A separate explicit user request is required.`

Acceptance criteria describe observable completion, not an invented
implementation. Apply the report redaction contract to the final synthesis and
artifact. Never copy credentials, personal data, private identifiers, signed
URLs, or sensitive raw evidence into a proposal.

## Sensitive findings

Respect the finding row's sensitivity classification and storage decision. A
security S1/S2 finding for a public repository targets a private security
advisory or another approved private tracker, not a public issue. If no safe
private channel is repository-visible, produce only a redacted handoff with a
safe private-evidence pointer and state that the human must select the secure
destination.

The proposal workflow never weakens the finding ledger's redaction rules and
never treats an ignored local artifact as safe to publish.

## Authorization boundary

QA lanes only report findings and evidence. They never inspect a remote
tracker, draft an issue, or contact an external tracker service.

During a QA run, the orchestrator may read visible governance, perform an
available read-only duplicate check, prepare the final proposal, and write the
local proposal artifact. It must not create, edit, comment on, label, assign,
close, move, or otherwise mutate an external tracker.

Tracker mutation is a later workflow. It begins only after the user explicitly
requests that specific external action.

## Examples

### GitHub conventions are visible

```markdown
Finding: FND-session-bypass — open
Proposed tracker: GitHub Issues, private security advisory
Title: security/P0: Enforce authorization on session lookup
Threshold: S1 / P0 — canonical default (S1/S2 or P0)
Affected scope: authentication; session lookup; signed-in users
Environment: candidate 8c12...; local disposable target
Reproduction or observations: Safe reproduction is retained in private evidence.
Expected result: A user can read only sessions authorized for that user.
Actual result: A different user's session metadata was returned.
Evidence: private-advisory://FND-session-bypass
Oracle: docs/security-contract.md, Authorization boundary
Impact: Unauthorized disclosure of session metadata.
Suggested acceptance criteria:
- Cross-user session lookup returns the contract-defined denial response.
- A regression check covers authorized and unauthorized lookup.
Uncertainties: Exposure outside the disposable target was not assessed.
Not tested: Production and public endpoints.
Governance sources: AGENTS.md; .github/ISSUE_TEMPLATE/security.yml
Duplicate check: No matching stable ID or failed behavior in the accessible private tracker.
Authorization: Draft only — no tracker mutation occurred. A separate explicit user request is required.
```

### Non-GitHub tracker is inaccessible

The project declares a self-hosted Forgejo tracker, adds P1 to its proposal
threshold, and provides no tracker access to the QA session.

```markdown
Finding: FND-export-header — regressed
Proposed tracker: Forgejo Issues (inaccessible); portable Markdown
Title: P1: Restore the documented quantity header in CSV exports
Threshold: S3 / P1 — eligible through the repository's P1 addition
Affected scope: grocery export; CSV header row
Environment: candidate build-104; local disposable target
Reproduction or observations: Export a list containing one item and inspect row one.
Expected result: The header contains name and quantity.
Actual result: The quantity header is absent.
Evidence: QA/2026-07-27-0900-regression-export.md
Oracle: docs/export-contract.md, section 2
Impact: Downstream imports cannot map the quantity column reliably.
Suggested acceptance criteria:
- The CSV header matches section 2 of the export contract.
- The export regression test covers an item with a quantity.
Uncertainties: Existing Forgejo issue matches could not be inspected.
Not tested: Third-party spreadsheet importers.
Governance sources: AGENTS.md; docs/contributing.md#issue-format
Duplicate check: Tracker duplicate check: not verified — tracker unavailable
Authorization: Draft only — no tracker mutation occurred. A separate explicit user request is required.
```
