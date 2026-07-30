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
| P3 | No planned fix this cycle |

`P3` is a scheduling value only. It does not set or imply `accepted` or
`wontfix`, and it never excludes a finding from verdict computation. See the
`Risk acceptance` section in `SKILL.md`.

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
- **bob-qa information architecture:** IA findings default to S4. Raise an
  IA finding to S3 only when evidence shows task impact: failed or abandoned
  completion, an incorrect prediction with real consequence, or an
  unrecoverable path. The existing S1/S2 definitions still govern and
  require demonstrated core-flow failure or data risk; IA framing alone
  cannot elevate a finding.

## Failure class → severity

Failure class, Severity, and verdict are separate decisions. First record the
observed class and evidence. Then assign Severity from demonstrated impact in
the declared deployment context. Finally apply the fixed Severity-to-verdict
table above. Do not choose Severity to reach an expected verdict.

| Lane or class | Classification rule | Severity anchors |
|---|---|---|
| Regression | `Regression`, `New failure`, and `Flaky` describe history or repeatability only. They do not raise or lower impact. | Use the reproduced impact: core flow unusable, data loss, or crash → S1; major flow broken with no workaround → S2; degraded flow with a workaround or limited context → S3; cosmetic, edge, or low-risk effect → S4. |
| Security | Record the concrete security condition and the current threat-model evidence. A category name, checklist failure, or theoretical exploit path is not proof of exposure. | Exposed secret or demonstrated auth bypass → S1; demonstrated significant exposure with no workaround → S2; a contextual best-practice gap with limited impact → S3; a hygiene or edge issue with low real-world risk → S4. |
| Compatibility | Scope the finding to the exact engine, viewport, OS, or device combination exercised. Emulated or single-axis evidence does not establish an untested engine or real device. | On a supported combination: core flow unusable → S1; major flow broken with no workaround → S2; degraded flow with a workaround → S3; cosmetic or edge-only difference → S4. |

Do not classify missing coverage as a product finding. Put an unexercised area
in `Not tested`; use `Blocked` only when environment or tooling prevented the
declared scope; use `Observed only` when safety prevented a mutation-dependent
completing action. A confirmed S1/S2 remains S1/S2 even when only one supported
combination or one lane reproduced it.

## Failure classification (regression-qa)

In addition to severity/priority, regression findings are classified as:

| Class | Meaning |
|---|---|
| Regression | Previously passing, now failing |
| New failure | New test, never passed |
| Flaky | Inconsistent across reruns — report the pass/fail ratio |
