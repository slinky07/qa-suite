# N10 API pair resolution record

Status date: 2026-07-30

This is the bounded maintainer-evaluation record for N10 in the
[user integration campaign](../../docs/exec-plans/active/user-integration-campaign.md).
The normative contracts remain in `tests/evaluation/README.md` and
`scripts/evaluation/`. This record does not define another contract and does
not change the distributed `qa-suite/`.

## Decision

The N10 semantic evaluation outcome is complete. The API pair completed and
was rerun; it was not retired. This record does not declare the delivery node
`Done`; required verification, CI, and merge remain workflow gates.

- The adversarial case detected the delivery-retry defect during smoke and
  reached a structured `No-Go`. The canonical smoke gate therefore ended that
  case without a fabricated deeper API dispatch.
- The control case reached `Go` smoke, then completed a fresh deeper API
  session at `Go` with no finding.
- Both case executions used the same frozen candidate. Maintainer-side
  post-closure reconciliation records one adversarial detection, no miss, and
  zero control false positives.
- The adversarial report's Severity and Priority differ from the sealed
  expectation. This is a classification-authority residual, not a detection
  miss. [Issue #106](https://github.com/slinky07/qa-suite/issues/106) owns that
  follow-up without widening N10 or the v1.4.0 release node.

The reports and this reconciliation remain non-qualifying maintainer
evidence. They do not certify the API lane, fixture opacity, provider or
controller state, sandboxing, or release readiness.

## Frozen identities

| Boundary | Frozen identity |
|---|---|
| Controller and subject commit | `7cda0ed32e3298edf064164838f01c702b0385da` |
| Repository tree | `af1d12f4f1ebf190fba0bba595c8ecde09955582` |
| Subject `qa-suite/` tree | `6902b67449d0a97a19604549a59f09b46ffe54ae` |
| Suite | `api-evaluation-v1` |
| Reviewed launch driver | SHA-256 `d4e5f8f3524e75229830463500051934bad1213ebb3e38e5af3cc5dbf5fdca0a` |
| Final attempt ledger | SHA-256 `0e043f8805d4d354ad9f1d02820b56d5139d700e914eaf4784efcffc71e4334a` |
| Runtime | Node `v26.5.0`; Codex CLI `0.145.0` |
| Codex executable | SHA-256 `1da3f4e0e96028b8a771814293c3033dafd1971f943f6c7e79b0897fe705f590` |

## Authorization and execution accounting

| Metric | Count | Meaning |
|---|---:|---|
| Owner-authorized N10 fresh CLI ceiling | 4 | Maximum allowed external sessions for this node |
| Controller-launched CLI attempts | 3 | Two smoke sessions and one eligible API session |
| Established external sessions | 3 | Every attempt emitted one unique `thread.started` identity |
| Pre-thread failures | 0 | No configuration or provider-startup attempt failed |
| Unused authorization | 1 | Not consumed because the adversarial `No-Go` correctly gated deeper API dispatch |

The controller ran all sessions serially because both fixtures use loopback
port 4311. Every session used a new ephemeral CLI process, a new selected-case
export, and an empty report history. The orchestrator reports that each prompt
contained only the selected public fixture, public lane authorities, frozen
candidate, platform, and neutral discovery mission. Sibling cases, prior
reports, sealed roles or expectations, controller state, credentials, private
data, and owner PDF/HTML did not enter a session.

Before dispatch, the controller verified that its managed tool-egress profile
allowed local binding and loopback requests while denying a named external
host and a raw external IP. This is a controller-observed preflight only. It
does not upgrade the runner's `network_isolation: "not-attested"` claim.

## Attempts and closures

Roles were unavailable to the lanes. This table keeps opaque public case
order and binds every semantic observation to controller-captured artifacts.
Each `closed/artifact` entry is the SHA-256 of `closed.json`, followed by its
captured artifact-tree SHA-256. The labels below are local record labels; they
do not publish the controller-side role mapping.

| Record label | Phase | Run | `thread.started` | Terminal state | Captured report SHA-256 | `closed.json` / artifact tree |
|---|---|---|---|---|---|---|
| Case A | Smoke | `run_894b08aea090640727d9ddb4dd636e29` | `019fb40a-2bde-7651-a3ff-dd77413427ea` | `No-Go`; deeper API gated | `3350c8ae202b8b782f3dd243022fb305ea91ccd0e15fa4a599a8be1fa237bdbd` | `8117a995ed002c08dddf1180ad76da0e3d527878e2964a253c7650fbd275191e` / `51cc68a7512e1fabd9785b28c7efcffeb2435a08fa8e26a3f0fbfd7f46cd7ed0` |
| Case B | Smoke | `run_2a2b2a5d1594dc5e2e50791c8da0977b` | `019fb40c-8e6b-7880-a4f0-5517fd5ae675` | `Go`; closed reusable gate | `82ae812b81cf1329cc8a276ff8852e0e66d05183b44adcbcad2afd0bad9e54fa` | `8d1500e97bbe276d29605f6d2829fee45f26947f477f7ff030ebc4a48d64b2bc` / `5f676b665158c1d7ac21394c77acbf18e08914212f07858cd1d77e934608e517` |
| Case B | API | `run_a6bb844a4366735849b5d2d401da3a86` | `019fb410-2d76-7943-beed-98dc08a0bb4f` | `Go`; no finding | `ecbb98940cebb4dff8407a0a8bd5def722e597debcbf1d5757e1ad636ed80dcf` | `e798494497ddfd5071bec0c1e98e3c8ef7fb7c3f635b840ed542bd6be186b022` / `ab1869cea3608bee5a2a3503e07e8a1a7f66f1ae2f880d4988d0e89604f417a1` |

The corresponding final result-record SHA-256 values are:

| Run | Result-record SHA-256 |
|---|---|
| `run_894b08aea090640727d9ddb4dd636e29` | `fb1b4849ec3abb1bed645e8f365cd9feb9d92678a9fc070153c8565dc7127a5d` |
| `run_2a2b2a5d1594dc5e2e50791c8da0977b` | `c81b4a6d0ab62cdb021d6e716c2b7071c295f2aab70ed5ac1716fa0c82c803b7` |
| `run_a6bb844a4366735849b5d2d401da3a86` | `3cb8d9f471c3442b347f4c4f2bed53e42a6260d652164328747e92819282eb50` |

Every session exited zero without timeout or blocker. Its bounded
process-group cleanup found no remaining owned process, and its before-close
and after-close port audits found no listener on port 4311. Every prepared
run reached one terminal runner closure.

## Controller smoke gate

The control API session was eligible only after controller review of the
closed smoke snapshot:

- the canonical verdict was exactly `Go`;
- `check_api_startup` was declared exactly once and passed;
- the smoke result, `closed.json`, and captured report matched their recorded
  hashes;
- the case and controller/subject commit identities matched; and
- the fixture port and owned process group were clear.

The immutable smoke-gate binding has SHA-256
`e132af136e728eaba460eb7bf9a12125ed8e9ced751bed8cc6b3c6d80ffc203b`.
It binds smoke result
`c81b4a6d0ab62cdb021d6e716c2b7071c295f2aab70ed5ac1716fa0c82c803b7`,
closed snapshot
`8d1500e97bbe276d29605f6d2829fee45f26947f477f7ff030ebc4a48d64b2bc`,
and report
`82ae812b81cf1329cc8a276ff8852e0e66d05183b44adcbcad2afd0bad9e54fa`.
No smoke report bytes, verdict, or controller gate entered the API prompt.

The other smoke report reached `No-Go` with a structured failed core-flow row
and captured request/response evidence. Under the canonical gate, that is a
terminal evaluated case, not `Blocked` or missing coverage. The controller
did not dispatch or fabricate a deeper API report for it.

## Role-neutral observed results

Across the two smoke closures, startup passed in both selected fixtures. One
closed smoke report contained a structured identical-retry core-flow failure,
request/response evidence, one classified finding, and `No-Go`; its deeper
lane was correctly not dispatched. The other smoke report reached `Go` with
no finding and became the only eligible deeper-lane gate.

That fresh API session exercised POST and GET contract behavior, valid and
invalid bodies, idempotency-header boundaries, state invariants, Unicode, and
the declared 1,024-character boundary. It reached `Go` with no finding.

## Maintainer-side post-closure reconciliation

The controller opened the sealed role and expectation mapping only after all
scheduled cases had closed. It launched no provider session afterward. No
generic semantic adapter ran.

| Post-closure role | Reconciliation |
|---|---|
| Adversarial | The structured API-01 retry failure, `No-Go`, failed flow, and request/response evidence match. Severity and Priority do not match the sealed classification. Detection: yes; miss: no. |
| Control | Smoke and API both completed at `Go` with no finding. The retry flow passed and the zero-finding control budget is met. |

The adversarial request/response artifacts record a first delivery, a
different delivery from the identical retry, and two deliveries in the final
list. The control smoke and API reports independently record the original
delivery identity on retry and one resulting queued delivery.

The classification mismatch is preserved rather than silently normalized.
This record does not adjudicate which authority requires correction.
Issue #106 must reconcile the public classification rules and the sealed
controller expectation before a future classification-scored run. It does not
retroactively change this detection.

## Evaluation outcome

| Measure | Result |
|---|---|
| Pairs planned | 1 |
| Complete pairs | 1 |
| Adversarial expectations evaluated | 1 |
| Adversarial expectations detected | 1 |
| Adversarial misses | 0 |
| Exact expected classifications | 0 of 1 |
| Blocked cases | 0 |
| Completed controls | 1 |
| Observed control false positives | 0 |
| N10 semantic acceptance | Met — pair completed under the canonical smoke gate and human reconciliation is recorded |

The adversarial `No-Go` contributes a detection because its structured failed
check and closed request/response artifacts satisfy the expected API-01 and
flow assertions. It is not counted as a deeper API session. The control
completed both smoke and deeper API phases. No `Blocked` result enters a
detection, miss, or control denominator.

## Limitations and residuals

- Each report states `Execution mode: single-session fallback;
  non-independent evidence`. Fresh CLI process identity is an
  orchestrator-reported fact and does not upgrade that caveat.
- A closed generic API semantic adapter remains absent. The comparison above
  is maintainer-side post-closure reconciliation, not machine scoring or
  release certification.
- Browser tooling was unavailable in the smoke sessions. The declared target
  is a JSON API, and request/response evidence covered the declared startup
  and retry checks; no browser observation is claimed.
- The controller's managed-proxy preflight and process/port audits are
  controller observations. They do not authenticate provider state, prove
  hostile same-user isolation, or upgrade the runner's isolation non-claims.
- The controller opened sealed mappings after all scheduled cases closed. No
  additional N10 attempt ran afterward, even though one authorized session
  remained unused.
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

This record does not claim qualifying evaluation evidence, authenticated
provider/controller state, sandbox qualification, semantic fixture opacity,
classification alignment, or release certification. External session IDs,
prompt exclusions, process freshness, managed-proxy behavior, and the
post-closure role mapping come from orchestrator logs or maintainer
inspection; they do not upgrade the preserved non-claims.

Existing campaign authority permits intermediate commit, push, pull request,
CI, and merge operations. Remote-branch deletion, release publication, and
the final campaign gate remain human-gated.

## Verification

Focused public contract and corpus checks:

```sh
node --test \
  tests/evaluation-api-compatibility-fixture-pairs.test.mjs \
  tests/evaluation-seven-lane-corpus.test.mjs \
  tests/contract-fundamentals.test.mjs
```

The restricted-sandbox run reached 10 passes and 2 failures. Both failures
were the same sandbox-only `listen EPERM` while disposable fixtures attempted
to bind `127.0.0.1`. The one permitted unchanged retry ran with local-loopback
permission: 12 tests passed, 0 failed.

Required repository suite:

```sh
node --test
```

Result: 309 total, 305 passed, 4 intentional live-browser skips, 0 failed.
Final release-integrity, diff, CI, and merge gates remain part of the delivery
workflow and are not promoted into this semantic evaluation result.
