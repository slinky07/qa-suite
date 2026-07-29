# Issue #30 campaign closure

Status date: 2026-07-29

This is the historical delivery record for
[Issue #30](https://github.com/slinky07/qa-suite/issues/30). The normative
evaluation contracts remain in `tests/evaluation/README.md` and
`scripts/evaluation/`. This record does not define another contract and does
not change the distributed QA Suite.

## Decision

The bounded maintainer campaign has reached its owner merge gate. It closes
with partial acceptance and explicit P1 residuals; it does not claim that
every original acceptance item passed.

- Frozen merged base:
  `0a2a2e7e3a942f869b71c8bd45ea9c8dbb22b576`.
- Distributed `qa-suite/` tree:
  `2df85dedb7d9916458ae78314e3b8989d8f37f28` (unchanged by the campaign).
- The final pull request closes Issue #30 only when the owner merges it.

## Acceptance reconciliation

| Issue #30 acceptance item | Disposition |
|---|---|
| One adversarial fixture and clean control for every lane | Met structurally: seven lanes, sixteen cases, and eight pairs are committed. |
| Baselines state detected and missed practical failures | Partial: seven pairs completed; the API pair is incomplete. |
| Remediation follows an observed miss | Guardrail met. No distributed-lane remediation is claimed by this maintainer campaign. |
| Post-remediation reruns prove improvement without a control false positive | Not met and not claimed. [Issue #29](https://github.com/slinky07/qa-suite/issues/29) remains the Bob remediation authority. |
| Evidence, verdict, Severity, Priority, and coverage limitations are recorded | Met for completed runs. The API control's deeper lane is incomplete and excluded. |
| Issue #29 remains linked and is not duplicated | Met. Maintainer infrastructure did not replace its distributed-lane work. |
| The fixture suite is reusable for future releases | Partial: structural corpus validation runs through existing release tests; recurring semantic execution is not qualified or scheduled. |

The
[verdict and opacity comment](https://github.com/slinky07/qa-suite/issues/30#issuecomment-4954141078)
remains controlling: [Issue #31](https://github.com/slinky07/qa-suite/issues/31)
owns canonical verdict semantics, controls have explicit false-positive
budgets, and `Blocked` is incomplete coverage rather than detection.

The
[Bob method-order comment](https://github.com/slinky07/qa-suite/issues/30#issuecomment-5062017129)
is preserved by the controller-observed order:
interface inventory, expected-use model, then logical task execution. That
order is not promoted into semantic proof or qualification.

## Delivery record

| Boundary | Merged pull requests |
|---|---|
| Shared contracts and non-qualifying runner | [#52](https://github.com/slinky07/qa-suite/pull/52), [#53](https://github.com/slinky07/qa-suite/pull/53) |
| Bob method order and opaque fixture pairs | [#54](https://github.com/slinky07/qa-suite/pull/54), [#55](https://github.com/slinky07/qa-suite/pull/55), [#56](https://github.com/slinky07/qa-suite/pull/56) |
| Bounded execution and closed report/result binding | [#57](https://github.com/slinky07/qa-suite/pull/57), [#58](https://github.com/slinky07/qa-suite/pull/58), [#59](https://github.com/slinky07/qa-suite/pull/59), [#60](https://github.com/slinky07/qa-suite/pull/60), [#61](https://github.com/slinky07/qa-suite/pull/61) |
| Browser, cleanup, and controller request boundaries | [#62](https://github.com/slinky07/qa-suite/pull/62), [#63](https://github.com/slinky07/qa-suite/pull/63), [#64](https://github.com/slinky07/qa-suite/pull/64) |
| Pinned transport, gateway binding, phase composition, containment, and host policy | [#65](https://github.com/slinky07/qa-suite/pull/65), [#66](https://github.com/slinky07/qa-suite/pull/66), [#67](https://github.com/slinky07/qa-suite/pull/67), [#68](https://github.com/slinky07/qa-suite/pull/68), [#69](https://github.com/slinky07/qa-suite/pull/69), [#70](https://github.com/slinky07/qa-suite/pull/70) |
| Client-login-observed live controller and closed Bob composition | [#71](https://github.com/slinky07/qa-suite/pull/71), [#72](https://github.com/slinky07/qa-suite/pull/72) |
| Smoke, regression, performance, security, API, and compatibility pairs | [#73](https://github.com/slinky07/qa-suite/pull/73), [#74](https://github.com/slinky07/qa-suite/pull/74), [#75](https://github.com/slinky07/qa-suite/pull/75) |
| Seven-lane corpus and release-readiness reconciliation | [#76](https://github.com/slinky07/qa-suite/pull/76) |

## Evaluation outcome

- The reusable corpus contains seven lanes, sixteen cases, and eight
  adversarial/control pairs.
- Fifteen cases and seven pairs completed. The API control passed smoke, but
  its deeper specialist lane was `Blocked`; that pair is excluded from
  detection, evidence, and qualification.
- Human reconciliation over the seven complete pairs observed five of seven
  adversarial expectations detected and zero control findings. This is not a
  machine score or release certification.
- The successful
  [post-merge release-integrity run](https://github.com/slinky07/qa-suite/actions/runs/30462961971)
  tested merged `main`: 300 tests, 296 passed, 4 intentional live-browser
  skips, and 0 failures.
- The release-integrity job generated both package filenames from the frozen
  base as byte-identical archives, with SHA-256
  `90296d5986f1ddc219067eb3f49e0af4165df8a4738849a74e824e0dfca46972`.
  It did not verify or update the already-published v1.3.0 release assets.

## P1 residuals

- Bob missed both adversarial assertions; remediation and before/after proof
  remain with Issue #29.
- The API control's deeper specialist execution is incomplete. `Blocked`
  counts as neither detection nor miss.
- Smoke evidence lacks screenshot binding.
- Regression, security, and compatibility classification differed from their
  sealed expectations.
- Compatibility evidence used emulated widths and does not establish broader
  engine, device, or target identity coverage.
- Generic lanes do not have closed semantic adapters or a qualifying
  normalized-result boundary.
- Bob provider identity, hostile same-user protection, sandbox qualification,
  report semantic parity, and semantic fixture opacity remain unattested.
- High-reasoning finalization latency and stronger process/session containment
  remain bounded limitations.
- Recurring semantic release automation remains unsupported; only structural
  corpus integrity runs in the release test gate.

## Preserved non-claims

Every evaluation output remains:

```json
{
  "verification_status": "unverified",
  "qualification": "not-evidence",
  "result": null
}
```

This campaign does not claim a qualifying evaluator, complete Issue #30
acceptance, generic-lane semantic automation, or proof that any QA lane passes
its evaluation.
