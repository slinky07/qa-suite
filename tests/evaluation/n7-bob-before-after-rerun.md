# N7 Bob before/after rerun record

Status date: 2026-07-29

This is the bounded maintainer-evaluation record for N7 in the
[user integration campaign](../../docs/exec-plans/active/user-integration-campaign.md).
The normative contracts remain in `tests/evaluation/README.md` and
`scripts/evaluation/`. This record does not define another contract and does
not change the distributed `qa-suite/`.

## Decision

N7 is `Blocked`.

One unchanged driver invocation attempted all four cases in suite order and
retained twelve fresh Codex phase turns. Three cases completed the full live
session, closure, and closed-result adaptation. The Project Finder adversarial
case reached terminal runner closure, but the controller rejected its
task-execution phase after one failed browser tool call. The suite therefore
terminated with exit code 1 and correctly remained:

```json
{
  "verification_status": "unverified",
  "qualification": "not-evidence",
  "result": null
}
```

No retry was run. The failure was a valid controller rejection of an invalid
browser action, not a demonstrably transient provider or runtime failure.
Both Bob pairs did not rerun successfully, and N7 acceptance is not met.

The tested subject is an integrated post-remediation campaign subject. This
record does not attribute its behavior solely to N1.

## Frozen identities

| Boundary | Frozen identity |
|---|---|
| Controller commit | `e917060c3a7aa7246f10480d5dcd78a0d17e72d2` |
| Controller repository tree | `bda5988fb9c052c0ba7e8dd39b786c638176e868` |
| Controller `qa-suite/` tree | `2df85dedb7d9916458ae78314e3b8989d8f37f28` |
| Controller-program SHA-256 | `6c23be8be2daa675922e181bbd8937232fd198f0193178cc60e0f9b973722b54` |
| Integrated subject commit | `a83866dada9f3c1d79d196da43ad233aaf02784e` |
| Integrated subject repository tree | `c8206f74076b96d081110ec3bf3dfea9d35e2f1a` |
| Integrated subject `qa-suite/` tree | `ee02714393f3b870189be67adf7a7d9180a15151` |
| Suite | `bob-evaluation-v1` |
| Ignored one-shot driver SHA-256 | `7f917a73ed73da92361b6cd007b73c1b10781ea741ef52c64f08001ab88575d8` |
| Suite run | `suite_0a2cc92af1f28a1599fb9edfaa4808f1` |
| Suite index SHA-256 | `8ff44ff3fefa9edb1b97369033783ce6a3169d66a11a2a9e3742b93ff2065247` |
| Codex CLI | `codex-cli 0.145.0`; executable SHA-256 `1da3f4e0e96028b8a771814293c3033dafd1971f943f6c7e79b0897fe705f590` |
| Chrome for Testing executable SHA-256 | `b1b9e2dd063115031f08eadc10ed381ca0fa05b2284baff8f721d87f5f0f61b7` |

Preflight found no relevant listener, process, or existing run root. The
subject checkout was clean at its frozen commit, the driver digest matched,
and the Tier-F controller paths were byte-identical between controller and
subject. The subject branch being behind later `origin/main` history does not
change the frozen subject binding.

## Historical before record

`tests/evaluation/issue-30-closure.md` is the historical source for the
before state. It records that Bob missed both adversarial assertions and
produced zero control findings. `tests/evaluation/README.md` binds those
historical outcomes to these pairs:

| Pair | Adversarial case | Control case | Historical outcome |
|---|---|---|---|
| Pocket Notes | `fx_39e78c1246b2cf2952277010d5f5cedc` | `fx_ea9eb160a44e5e7f7acd520b92825800` | Adversarial miss; zero control findings |
| Project Finder | `fx_cc4b61fbde593f6e101984583e5e9f88` | `fx_87a49bf089d33e76d6115d4aef954c01` | Adversarial miss; zero control findings |

That closure record does not retain historical per-case run, dispatch,
controller-state, session-chain, or artifact digests. Its aggregate result is
history only. It is not reused as fresh evidence and is not treated as an
immutable per-run comparison binding.

## Current attempts and closures

The following are orchestrator/runtime facts from the single driver invocation
and its frozen suite index:

| Pair and role | Case | Run | Dispatch | Terminal state |
|---|---|---|---|---|
| Pocket Notes adversarial | `fx_39e78c1246b2cf2952277010d5f5cedc` | `run_1cd88e4e5b3b444e63685f0fbe62f5db` | `dispatch_3cff9a3830c7608addef83523105366f` | Completed |
| Pocket Notes control | `fx_ea9eb160a44e5e7f7acd520b92825800` | `run_8559009e39678a3f1e6294cf5127a209` | `dispatch_f578571bd8fe36eece613b3b3014ca30` | Completed |
| Project Finder adversarial | `fx_cc4b61fbde593f6e101984583e5e9f88` | `run_17adfe0acd9129d3873acfb21e90c0c5` | `dispatch_573b2e97534ecb83914355e3368bd092` | Runner closed; live session failed |
| Project Finder control | `fx_87a49bf089d33e76d6115d4aef954c01` | `run_20e8f026a78b78d74de85555005fb9d4` | `dispatch_5f08d8748d5df6d06584a0133b9c3fd3` | Completed |

All twelve external phase processes ran sequentially in the required
interface-inventory, expected-use-model, task-execution order within each
case. Eleven phase records were accepted by the controller. The rejected
ninth turn is retained in the closed Project Finder adversarial snapshot; it
is not an accepted phase record and did not produce a live-session or
session-chain record.

The following facts are recorded in each terminal `closed.json` and its
controller-captured artifact snapshot:

| Case | `closed.json` SHA-256 | Artifact tree SHA-256 | Workspace tree SHA-256 |
|---|---|---|---|
| Pocket Notes adversarial | `5379a21530f546b1699db4f73f9368c5caf09493c650bbe28bb7ec1fb2834b74` | `672d30a1f44860921fa736e7e1751f46b674c4911b0205fa5ca3a7b3db7e6a8f` | `6a2879f43ac8f0982d874b31935599115d4a553ba2f0954796f4159aabafe818` |
| Pocket Notes control | `a3213bc5e7d68b7913c813ecdf89635667d4e35eb077dc8d3dcff9250f6d6f6b` | `1aa5428740a8b0b5ace8a2a6350e679c8873a1212faa9c106433f4c2976d1ecb` | `aae5cd47403fa839d8eba4e697a66f52e0727f2b790d97fff742c140afdc572b` |
| Project Finder adversarial | `e4a9caab1b20eeb65d7ddc1fbf5606d2de1b4bfbdd7f9ecfc4296d7b8b7c6515` | `9805e583ef84c09deb2498161fe23ead804e91b9b3c7ee932873f36a60dded7b` | `597f2f6f5194729c4e1cd04110de792c8e7bae351875ab100a293f901e00bebf` |
| Project Finder control | `5af8ac0e1bee21204eaa04d975cf2b0d74d3714277889857aa20b87d315adb8a` | `565d58b5c2d89c93788a60a718fc8212f1bca1912b4713ec512216edd02ef8de` | `51c80eb2f8e221bf3cf7412cdfb8557501242019af6017f75847c1e8a64766c4` |

Each closure retains `artifact_inventory: "closed"` and
`input_integrity: "verified"` while preserving every other non-claim,
including `method_order: "unverified_by_report"` and the unattested context,
execution, fixture-opacity, network, and state-authentication boundaries.

## Closed failure evidence

The Project Finder adversarial task-execution turn is bound into the closed
artifact tree above:

- Codex turn SHA-256:
  `d7b09bbb5048010fc351218aa7e5268fa6c5b2d20d284984ef39de35da04d096`
  (`876255` bytes).
- Browser gateway journal SHA-256:
  `c0ca59e7fccad022d68129f99958f6e8910403ae5b838699d3049f847cac071a`.
- Browser gateway closure SHA-256:
  `7d1a89171f7a3e46349f5fc28bdd82258290760d694281f1db99f489108233c4`.
- Codex stderr: zero bytes.
- Gateway journal: 25 completed tool calls and one failed tool call.
- Exact failure: sequence `14`, tool `set_control`, error
  `control is not currently visible and actionable`.
- Post-closure replay of the frozen binding validator rejected those captured
  bytes with `browser gateway journal contains a failed tool call`.

The phase therefore produced no gateway binding, atomic phase record,
three-phase live-session record, session chain, report, or closed-result
adaptation. Runner closure still succeeded and preserved the partial evidence.

## Before/after reconciliation

Reconciliation read the controller-captured snapshots only after closure. It
does not read the mutable lane trees or reproduce confidential oracle values.

| Pair | Historical before | Current integrated subject | Reconciliation |
|---|---|---|---|
| Pocket Notes | Adversarial miss; zero control findings | Both cases completed. The closed adversarial report contains no findings; the closed control report contains no findings. | Adversarial miss; zero control findings. No improvement is evidenced for this complete pair. |
| Project Finder | Adversarial miss; zero control findings | The adversarial case failed at live-session controller validation after terminal runner closure; it has no accepted lane result. The control case completed with no findings. | Incomplete pair. The adversarial case is neither a detection nor a miss; the pair has no detection denominator or before/after disposition. The completed control alone does not make the pair complete. |

For the one complete current pair only, the human-reconciled count is zero of
one adversarial expectations detected, one miss, and zero control findings.
The incomplete Project Finder pair contributes no detection, miss, or
denominator. Its historical outcome is not carried forward. Because the
historical and current denominators differ, no aggregate improvement rate or
causal N1 claim is made.

## Cleanup and retry decision

After the driver terminated, an escalated process-table audit reported:

```text
driver=0 owned_run_root=0 codex=0 browser=0 fixture=0
```

No owned listener-capable fixture or gateway process remained. Temporary
browser and phase lifecycles were closed before the retry decision.

The one allowed retry was not used because the captured failure is not
demonstrably transient. Under the existing campaign stop rule and owner
campaign authority, the orchestrator may promote one final N1-style behavior
iteration as a new graph node. Any subsequent external four-case rerun must
receive its separately budgeted safety gate, start from a new empty run root,
and bind an explicitly frozen controller and subject. Re-running this suite as
a retry, or patching the frozen Tier-F controller, is not the unblock path;
Tier-F maintenance would require separate owner authority and scope.

## Preserved non-claims and owner gate

This record does not claim:

- two successful post-remediation pair reruns;
- qualifying evaluation evidence or a release certification;
- a Project Finder adversarial detection or miss;
- historical run-level bindings that the historical record did not retain;
- N1-only causality for the integrated subject;
- authenticated provider/controller state, hostile same-user isolation,
  sandbox qualification, semantic fixture opacity, or report semantic parity;
  or
- that any Bob lane or the integrated subject passes its evaluation.

Every suite index, closure, live record, session-chain record, adaptation, and
reconciliation output remains `unverified`, `not-evidence`, with `result:
null`. Existing campaign authority permits intermediate commit, push, pull
request, and merge operations. Issue closure, remote-branch deletion, release
publication, and the final campaign gate remain human-gated.

The retained run roots remain local execution state. This record becomes
durable campaign evidence only through commit and merge.

## Verification

The focused closure/snapshot and contract command passed:

```sh
node --test \
  tests/evaluation-runner.test.mjs \
  tests/evaluation-browser-gateway.test.mjs \
  tests/evaluation-codex-bob-live-controller.test.mjs \
  tests/evaluation-bob-qualification-composer.test.mjs \
  tests/evaluation-seven-lane-corpus.test.mjs
```

Result: 69 tests, 69 passed, 0 failed, 0 skipped.

Final scope checks:

- `git diff --check`: exit 0.
- `git diff --no-index --check /dev/null
  tests/evaluation/n7-bob-before-after-rerun.md`: expected exit 1 because
  the new file differs from `/dev/null`; no whitespace error was emitted.
- `git diff --exit-code -- qa-suite scripts/evaluation`: exit 0.
- Before candidate freeze, the branch base was refreshed to merged `main` at
  `01a549334630b73ec84951fe258fc93882322e51`; the frozen evaluated subject
  remains the separately identified commit above.
- The rerun record was the sole version-control-visible worktree change.
