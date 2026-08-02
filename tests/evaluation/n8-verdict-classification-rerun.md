# N8 verdict-classification rerun record

Status date: 2026-07-30

This is the bounded maintainer-evaluation record for N8 in the
[user integration campaign](../../docs/exec-plans/completed/user-integration-campaign.md).
The normative contracts remain in `tests/evaluation/README.md` and
`scripts/evaluation/`. This record does not define another contract and does
not change the distributed `qa-suite/`.

## Decision

N8 is `Blocked`. Its terminal acceptance is not met.

- The regression adversarial case detected the expected defect, but reported
  `S2`, `P0`, and `No-Go` where the post-closure sealed expectation requires
  `S3`, `P1`, and `Go with findings`.
- The security adversarial case was `Blocked` at smoke because its local
  fixture could not bind to loopback. It contributes neither a detection nor
  a miss, so the security pair is incomplete.
- The compatibility adversarial case detected the expected defect with the
  required screenshot and the allowed `No-Go` verdict, but reported `S1`
  where the post-closure sealed expectation requires `S2`.

All three completed control cases reported `Go` with no finding. The observed
control false-positive count is zero. The incomplete security pair's
pair-level control budget is not scored.

The regression and compatibility results expose a controlling-authority
conflict rather than a result that the orchestrator may silently normalize.
The public rules still support the classifications the lanes chose, while the
sealed expectations require different classifications. This record preserves
both facts and does not edit either authority.

## Frozen identities

| Boundary | Frozen identity |
|---|---|
| Controller and subject commit | `84817b700663e552badbb4424a668a19bc6c4dd0` |
| Repository tree | `ff08578993ae14aeae5e9e09b6957201faa98e11` |
| Subject `qa-suite/` tree | `6902b67449d0a97a19604549a59f09b46ffe54ae` |
| Suites | `regression-evaluation-v1`, `security-evaluation-v1`, `compatibility-evaluation-v1` |
| Orchestrator-recorded initial smoke driver after provider-config correction | SHA-256 `ac69bdea52a8f4104c9697fd1515de2c4f117f4f9e357cd5949d560c80c7f8cc` |
| Closed-smoke continuation driver for regression and security | SHA-256 `0ad2d816af8ba4d80e3b5289abaf59f1255477c28154a001cdc34bef99091cf2` |
| Two-phase compatibility driver | SHA-256 `254e23996b7481f4fe48781754ce0153f3ca11be9f6f3891f91e2077f8311211` |
| Runtime | Node `v26.5.0`; Codex CLI `0.145.0` |
| Codex executable | SHA-256 `1da3f4e0e96028b8a771814293c3033dafd1971f943f6c7e79b0897fe705f590` |

The two initial compatibility CLI processes failed while parsing the
controller's provider configuration. Their pre-correction driver digest was
not retained. Neither process emitted `thread.started`, a report, or semantic
output, so that missing digest does not identify a semantic evaluation
session.

## Execution accounting

| Metric | Count | Meaning |
|---|---:|---|
| CLI process attempts | 12 | Every controller-launched `codex exec`, including two configuration failures before provider startup |
| Established external sessions | 10 | Attempts with one valid non-null `thread.started` event |
| Pre-thread failures | 2 | No provider session, verdict, report, or semantic coverage |
| Regression sessions | 4 | Two smoke sessions and two specialist continuations |
| Security sessions | 3 | Two smoke sessions and one eligible specialist continuation |
| Compatibility sessions | 3 | Two corrected smoke sessions and one eligible specialist continuation |
| Owner-authorized N8 CLI ceiling | 12 | Fully consumed by 12 controller-launched CLI attempts; 10 established provider threads |

The controller ran same-port and browser-sharing cases serially. Every
established session was a fresh ephemeral CLI process. The orchestrator
reports that each prompt contained only the selected public fixture, public
lane authorities, frozen candidate, platform, and neutral discovery mission.
Prior reports, sibling cases, sealed roles or expectations, controller state,
credentials, private data, and owner HTML/PDF were not dispatched.

Two continuation records rejected an ineligible prior gate before
preparation: the security adversarial `Blocked` smoke and the compatibility
adversarial `No-Go` smoke. Those local validations created only empty case
scaffolds; they created no prepared run, lane root, state, closure, or CLI
attempt.

## Attempts and closures

Roles were not available to lanes. This table keeps opaque case order and
records controller/runtime facts from retained result metadata. Each
`closed/artifact` entry is the SHA-256 of `closed.json`, followed by its
captured artifact-tree SHA-256.

| Lane | Case | Phase | Run | `thread.started` | Terminal state | Captured report SHA-256 | `closed.json` / artifact tree |
|---|---|---|---|---|---|---|---|
| Compatibility | `fx_a4ba6e16f6d783cbbc0f0f22c9e9e51e` | Initial smoke configuration | `run_4c44ae4ae256fd7593db89051bf2a14d` | None | CLI configuration error before provider startup | None | `28cc75815d24d97efa84acb0c74600566b466847606ff35f7249e0830e9097cb` / `37517e5f3dc66819f61f5a7bb8ace1921282415f10551d2defa5c3eb0985b570` |
| Compatibility | `fx_f6d361b9ef532534b6f25796e528ef89` | Initial smoke configuration | `run_e22e3338cc5a69fe80983cc9e5c2134a` | None | CLI configuration error before provider startup | None | `b742b7f9ea4731e97871064c8f91c193f5eec2f6009656801349e647a056b326` / `37517e5f3dc66819f61f5a7bb8ace1921282415f10551d2defa5c3eb0985b570` |
| Regression | `fx_6dff1dee655eee46589473f6edcba754` | Smoke | `run_cfc62f3454ea71a271873821e996cde8` | `019fb3ba-c3d9-7573-906b-e0eab39d17b4` | `Go`; controller artifact-handoff error after report | `b798713ee50728e1d1272545616f52efea0888c71922b4339d45522c945016e5` | `2dc944377f8b82eee3f0db013253598ab7bd1f88ccd11345db135d083c36f453` / `bb255129ff45a0892f8ebd2463d1eeae7fa4c02f7469e1138e42984b36cdb6ef` |
| Regression | `fx_6dff1dee655eee46589473f6edcba754` | Specialist continuation | `run_11ec345b4fb285987d4ee683d8d57451` | `019fb3c4-aa32-7be0-8000-ff0e7d77a188` | `No-Go` | `35e1fbcda3bf0a9ef804d45adab57550211674302d302258ebc165b2f49f9ad2` | `f9631698e04e4b2d4a7c873df108ac4c50d73bf19d4f741b2f7b60f7d164874a` / `0f061269857bf78d879dd048d21b680ce646f0f9fadd3fc469086185005ab196` |
| Regression | `fx_11ac2bf374eb701b330c6316209892fc` | Smoke | `run_1ce447df3def1aabc3bdd1aff7da6745` | `019fb3bc-3e5b-72c0-a363-d90018ad6276` | `Go`; controller artifact-handoff error after report | `3bd77ce4db99cc15ffa7de5cb62adb625c0bb704c3b701ca428a1bea6a9f929c` | `6bcde9224240d3fc6fa7cd13942cc3711af517ed16e3a26c35684f16039a147f` / `52bcda7416abfa4f9630de0cf1a0d3190d496940ebe00d92bd4af0afd1c5f856` |
| Regression | `fx_11ac2bf374eb701b330c6316209892fc` | Specialist continuation | `run_08f8b5d4886a3f7acd8f829e64f9db66` | `019fb3c6-b716-7151-bc4b-4d25b960ff98` | `Go` | `5a97db4cc2383e935456e2955b82013d88e72a7e8c14858a690999bdf1d743c1` | `7e90cfc877cb4164cd810fea2522cf0a017c12489fbc33019c15214d0f6a948a` / `71464cb6462f847f85f3f7a70ffeef969617544b8fe4c8ca51421aa30fcbc3cc` |
| Security | `fx_2facb8d5785c096aca738b8bfdf363a6` | Smoke | `run_2301f840976dcb7d4b31e6b1fb08bf8c` | `019fb3ba-e504-77c2-82fa-670102637539` | `Blocked` — loopback bind returned `EPERM` | `7ac00ae9b01b3ee35ff0ed8c86adfc1665b93ee2a534527c0d05f3e5e2225d9c` | `935bb7f7dc4418dffd0de6093e6df9210aa1064162802499d7ccddd9919b9094` / `a83272804520d8cc486cd036da1561cfbb40ede5b7db9a6dc71d076a44a69a04` |
| Security | `fx_206252d8bb7391075597d8b52bdefdf1` | Smoke | `run_f0a5ca4e6f8e4ef4555ab50536648164` | `019fb3bf-0361-7a71-aa60-6b201370d94a` | `Go`; controller artifact-handoff error after report | `09cb0860b8c0d149673ec5e0776006c4a12848f17bfaba6b76f1faaff8b09007` | `218dcf53c5bd23501463a569eb2b75586551af6d83db661a10c7fb3a68ce0665` / `c03485ca6e0c0ff6c5b896176a4c3b2be223d7f945cff1878a859cdcb162ed7b` |
| Security | `fx_206252d8bb7391075597d8b52bdefdf1` | Specialist continuation | `run_7a73784ecb8b0383a99006e967034978` | `019fb3c9-4818-7b13-9349-3b0190abfd1f` | `Go` | `8b25f1438290d0ae5f160bf9ab303041cdcffae7a7187bffcaf5dd04c29f4236` | `3f88ba1f604b94a8aae282142c9d604b2a4371a08f9643dcf0219f0883d4dc3a` / `421083a313a4143b2a4bbd157b7e5e3523b3548f2dcf9f16d2c3ecddcba01a65` |
| Compatibility | `fx_a4ba6e16f6d783cbbc0f0f22c9e9e51e` | Corrected smoke-only run | `run_ab5d694bb358fe1e7582420edd5c451d` | `019fb3d9-b224-7ac3-9af9-822f26049d15` | Captured `No-Go`; controller parser rejected the report metadata | `542c801493103eb759995d4942d9c4cbffcc639aa87da54ac2615a68d0e611ec` | `4faca22bef67fa44458fb9fa6a17ae297b75d93af93de1dc3b7559738c675034` / `126416c52bdbe69e7e588fd4de9acf41b410720186cd896016f454e0b0dc8106` |
| Compatibility | `fx_f6d361b9ef532534b6f25796e528ef89` | Corrected smoke-only run | `run_e610e9a4556967894ef575306d60a1e1` | `019fb3dd-9035-70f1-aed9-804d38033630` | `Go`; closed reusable gate | `1bdd121bf23ee448ecdfe9a7fa9896567f26b4d3015f2386509f3104df04cfa8` | `6357d0ada2476da91febc54efbf6a55801427500d861584c82ff62e5f94a11a2` / `df36a83f00abcda8504917611491ee6a3c2cc1c97e5b057b0b3e89ecb6b84f03` |
| Compatibility | `fx_f6d361b9ef532534b6f25796e528ef89` | Specialist continuation | `run_83e0aa7af89322fbde5b7ad3ae515471` | `019fb3e1-9a30-79b2-bc36-703a686f0274` | `Go` | `908fd7ec202c7cd8ad848c6f555d0f3bcb27649e1de01f5ee37c669ee77ab7c3` | `18b9598e924211b855b97379a48a0ab1d7628cbc7518f14646782ce5a16a2b23` / `b067e437b438f1852fcc09614a6bce86b2e6f4fe9dc4c4b57b85eeedcf9a6f54` |

Every prepared run above reached terminal runner closure. Every post-session
runtime audit reported no matching process and no listener PID. The final
host audit found no N8 driver, fixture process, or listener on ports 4173 or
4322.

## Controller adjustments and continuations

The initial compatibility processes failed before provider startup with:

```text
Error loading config.toml: invalid transport in mcp_servers.figma
```

The immediate diagnosis corrected only the disabled-MCP configuration.
Later reviewed controller changes separated smoke closure from specialist
continuation so evidence paths stayed valid. No fixture, subject, public task,
provider prompt, or expected result changed.

Regression and the eligible security control reached `Go` smoke, then hit
the same controller-only `EACCES` while attempting to rename the prepared
`QA` directory through its read-only parent. The controller did not rerun
smoke. A reviewed continuation validated the exact closed smoke snapshot and
launched one specialist in a fresh lane. The retained continuation bindings
are:

| Case | Continuation binding SHA-256 |
|---|---|
| Regression `fx_6dff1dee655eee46589473f6edcba754` | `9cc7d4e390a0cd1ca1be133f70e36129197e51a7032246c804d6a2e6bd2e13dd` |
| Regression `fx_11ac2bf374eb701b330c6316209892fc` | `aa8e196b3b1c77a2283373e5801f288d2d33d1a9d3a6137f645726556f1e53c5` |
| Security `fx_206252d8bb7391075597d8b52bdefdf1` | `fde86317d33a3e503257d553a8893126210bb1b9b7a5a9d803b3387a726f9c76` |

Compatibility used separate closed smoke and specialist snapshots so report
evidence paths remained canonical. The control smoke gate binding is
`91907c40ba7c53cf44e400b0acae333805ff1c2ff796eedddeacfcb86b256bd5`;
its specialist continuation binding is
`b15fbb10b4cf1bb5c62b30fb556f0b30e597a9aac42957ee0daf5a60d9f83cc7`.
No prior report path, bytes, verdict, or controller binding entered any
specialist prompt.

The compatibility adversarial report was captured and closed, but the
controller parser rejected it because `check_page_render` passed while a
different exercised core-flow row failed. The public verdict contract allows
`No-Go` for a demonstrably incomplete core flow; it does not require the
suite's one named render check to fail. Maintainer-side post-closure
reconciliation therefore records the captured report and the parser defect
separately. The canonical `No-Go` smoke gate still prevented specialist
dispatch.

## Maintainer-side post-closure reconciliation

The controller opened the sealed role and classification mapping only after
all scheduled cases above closed. Paths below name immutable
controller-captured artifacts, not mutable lane files. No generic semantic
adapter ran.

| Lane and post-closure role | Case | Observed semantic result | Sealed expectation | Reconciliation |
|---|---|---|---|---|
| Regression adversarial | `fx_6dff1dee655eee46589473f6edcba754` | Detected the final-day cancellation failure as `REG-01`; `S2`, `P0`, `No-Go`; report reference retained | One regression finding at `S3`, `P1`; `Go with findings` | Detection: yes. Evidence/criterion: match. Severity, Priority, and verdict: mismatch. |
| Regression control | `fx_11ac2bf374eb701b330c6316209892fc` | `Go`; no finding | Zero-finding control budget; `Go` or `Go with findings` | Control completed; zero false positives; budget met. |
| Security adversarial | `fx_2facb8d5785c096aca738b8bfdf363a6` | Smoke `Blocked`; specialist not dispatched | One contextual forwarding-trust finding at `S3`, `P1`; `Go with findings` | Incomplete. Neither detection nor miss. Classification not assessed. |
| Security control | `fx_206252d8bb7391075597d8b52bdefdf1` | Smoke `Go`; specialist `Go`; no finding | Zero-finding control budget; `Go` or `Go with findings` | Control completed with zero observed false positives. Pair budget not scored because the adversarial case is incomplete. |
| Compatibility adversarial | `fx_a4ba6e16f6d783cbbc0f0f22c9e9e51e` | Detected the 375 px send failure as `SMOKE-001`; `S1`, `P0`, `No-Go`; screenshot retained | One `COMPAT-01` finding at `S2`, `P0`; `No-Go`; failed send flow with screenshot | Detection, Priority, verdict, flow, and evidence: match. Severity: mismatch. |
| Compatibility control | `fx_f6d361b9ef532534b6f25796e528ef89` | Smoke `Go`; specialist `Go`; no finding; both declared cells completed | Zero-finding control budget; successful send flow; `Go` or `Go with findings` | Control completed; zero false positives; budget met. |

The regression adversarial evidence is the captured report
`QA/2026-07-30-1605-regression-cancellation-window.md`, SHA-256
`35e1fbcda3bf0a9ef804d45adab57550211674302d302258ebc165b2f49f9ad2`.
It records three repeated candidate failures on the final configured day and
a passing baseline.

The security blocker is captured in
`QA/2026-07-30-1556-smoke-status-board.md`, SHA-256
`7ac00ae9b01b3ee35ff0ed8c86adfc1665b93ee2a534527c0d05f3e5e2225d9c`,
with blocker evidence SHA-256
`b29c2485ccbffdee56ad0f15b3d3fd53227dd846a8b29772eb61727821219264`.

The compatibility adversarial screenshot is
`QA/evidence/smoke-blocking-375.png`, SHA-256
`2b21fd1e48d922c8fe0a0d9c5ebca240adc09017446be339b757578fddfda1e3`
(17,886 bytes). The completed control specialist retained 1024 px and 375 px
screenshots with SHA-256
`f61dd8d00960dfb670d76aef369380ff2c835d52e77c07b115aac114207b6a76`
and
`864df69913deee60bff00d2ef15afa3e7e46540316f29cd6a21b79aed80eb261`.

## Classification-authority conflict

N2 was intended to make the three prior classification drifts unambiguous,
but the rerun demonstrates that the current authorities do not support the
sealed target consistently:

- The regression public context declares final-day eligibility as core flow
  2. `qa-suite/SKILL.md` and
  `qa-suite/references/severity-priority-matrix.md` require `No-Go` when a
  core flow demonstrably cannot be completed and permit `S2` for a major flow
  broken without a workaround. The lane applied that rule. The sealed
  expectation instead requires `S3`, `P1`, and `Go with findings`.
- The compatibility matrix says that an unusable core flow on a supported
  combination is `S1`. The public context declares the send action on every
  supported target as its only core flow. The lane applied `S1`; the sealed
  expectation requires `S2`.

The orchestrator may not select the sealed classification over the public
lane authority, weaken the oracle, or rewrite a lane report. A successor to
Issue #82 must reconcile this conflict before a future qualifying rerun.

## Evaluation outcome

| Measure | Result |
|---|---|
| Pairs planned | 3 |
| Complete pairs | 2 — regression and compatibility |
| Incomplete pairs | 1 — security |
| Adversarial expectations evaluated | 2 |
| Adversarial expectations detected | 2 |
| Exact expected classifications | 0 of 2 evaluated |
| Blocked adversarial cases | 1 |
| Completed controls | 3 |
| Observed control false positives | 0 |
| N8 acceptance | `Blocked` — not met |

The incomplete security pair contributes no detection, miss, classification,
or pair-level budget denominator. No aggregate detection or classification
rate is claimed across all three planned pairs.

## Limitations and residuals

- Each report states `Execution mode: single-session fallback;
  non-independent evidence`. Fresh CLI process identity is an
  orchestrator-reported fact and does not upgrade that caveat.
- Generic regression, security, and compatibility semantic adapters remain
  absent. The comparison above is maintainer-side post-closure
  reconciliation, not machine scoring or release certification.
- The compatibility evidence covers only emulated Chromium at the two
  declared widths. It does not resolve Issue #86's real-engine, device, or
  target-identity residual.
- The controller had three local defects: invalid disabled-MCP
  configuration, a forbidden prepared-directory rename, and an overly strict
  smoke `No-Go` parser. They are disclosed above and did not change subject
  bytes, public fixture bytes, or lane instructions.
- The controller opened sealed mappings after the scheduled cases closed. No
  additional N8 attempt ran afterward: the 12-attempt ceiling was already
  consumed, and a post-oracle retry would also violate the intended method
  order.
- Retained lane/state roots under
  `/Users/slinky/Documents/QA-Suite-worktrees/` remain recoverable local
  execution state. This record becomes durable campaign evidence only after
  commit and merge.

## Preserved non-claims and owner gate

Every closed run retains:

- `input_integrity: "verified"`
- `artifact_inventory: "closed"`
- `adapter_status: "not-run"`
- `method_order: "unverified_by_report"`
- `context_isolation: "not-attested"`
- `execution_isolation: "not-attested"`
- `fixture_opacity: "not-attested"`
- `network_isolation: "not-attested"`
- `state_authentication: "not-attested"`
- `verification_status: "unverified"`
- `qualification: "not-evidence"`
- `result: null`

This record does not claim classification alignment, a complete security pair,
qualifying evaluation evidence, authenticated provider/controller state,
sandbox qualification, semantic fixture opacity, or release certification.
External session IDs, prompt exclusions, process freshness, and the
post-closure role mapping come from orchestrator logs or maintainer
inspection; they do not upgrade the preserved non-claims.

Existing campaign authority permits intermediate commit, push, pull request,
CI, and merge operations. Remote-branch deletion, release publication, and
the final campaign gate remain human-gated.

## Verification

Focused contract and corpus checks:

```sh
node --test \
  tests/evaluation-seven-lane-corpus.test.mjs \
  tests/contract-fundamentals.test.mjs
```

Result: 8 tests passed, 0 failed.

The first full-suite run inside the restricted sandbox reached 299 passes,
4 intentional live skips, and 6 failures. Every failure was the same
sandbox-only `listen EPERM` while a disposable fixture attempted to bind
`127.0.0.1`. The one permitted unchanged retry ran with local-loopback
permission:

```sh
node --test
```

Result: 309 total, 305 passed, 4 intentional live skips, 0 failed.

Final candidate gates:

```sh
node scripts/release/check.mjs --ref HEAD
git diff --check origin/main...HEAD
```

Release integrity passed for version 1.3.0 and produced byte-identical
archives. The final diff check passed with no output.
