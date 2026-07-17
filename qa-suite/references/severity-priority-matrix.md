# Severity / Priority Matrix

Single source of truth for all QA agents. Every finding in every report gets
**both** values. They are independent axes — never conflate them into one
adjective, and never redefine these scales inside an individual agent.

## Severity — impact if left unfixed

| Level | Name | Definition |
|---|---|---|
| S1 | Blocker | Core flow unusable, data loss, crash, exposed secret, or auth bypass |
| S2 | Critical | Major flow broken or significant exposure, no workaround |
| S3 | Major | Flow degraded or best-practice gap; workaround exists or impact limited by context |
| S4 | Minor | Cosmetic, edge case, hygiene item, low real-world risk |

## Priority — urgency to fix

| Level | Definition |
|---|---|
| P0 | Fix before next merge/release |
| P1 | Fix this cycle |
| P2 | Backlog |
| P3 | Won't fix / accepted behavior |

## Severity → verdict

Severity drives the verdict; priority drives scheduling only. The verdict
vocabulary is defined once in `SKILL.md` (Reports section); this mapping is
fixed so no lane redefines it:

| Findings in scope | Verdict |
|---|---|
| Any confirmed S1/S2, or a core flow demonstrably cannot be completed | No-Go |
| Only S3/S4 | Go with findings — counts on the verdict line, e.g. `Go with findings (1×S3, 3×S4)` |
| None | Go |

`Blocked` and the `Observed only` qualifier are coverage states, not
severity outcomes — they come from environment or safety limits, never from
this table.

## How agents weight severity by context

Severity is assigned against the project's actual deployment context (see
`qa-context.md`), not against an abstract worst case. Agents must state their
weighting when it isn't obvious:

- **security-qa:** a missing HSTS header on a VPN-only internal tool is not
  the same severity as on a public endpoint. State the assumed threat model
  at the top of the report.
- **compatibility-qa:** a bug on a mainstream engine/viewport outranks the
  same bug on a rare combination, all else equal.
- **api-qa:** a schema mismatch on an undocumented internal field is S4; the
  same mismatch breaking a real UI flow is at least S2.
- **performance-qa:** a number without a baseline is not a finding. First
  runs establish the baseline; only deviations from it get severity.

## Failure classification (regression-qa)

In addition to severity/priority, regression findings are classified as:

| Class | Meaning |
|---|---|
| Regression | Previously passing, now failing |
| New failure | New test, never passed |
| Flaky | Inconsistent across reruns — report the pass/fail ratio |
