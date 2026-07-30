# N7 Bob final rerun — terminal Blocked record

Date: 2026-07-30

This record closes the final Bob behavior-loop rerun authorized by the
[user integration campaign](../../docs/exec-plans/active/user-integration-campaign.md).
The normative contracts remain in `tests/evaluation/README.md` and
`scripts/evaluation/`. This record does not define another contract, change
the distributed `qa-suite/`, or maintain the frozen Tier-F controller.

## Decision

N7 is terminal `Blocked`.

The final permitted rerun stopped during `task_execution` in the first public
case. Three fresh Codex CLI phase invocations were attempted. The controller
accepted `interface_inventory` and `expected_use_model`; the task host did not
complete successfully and produced no accepted phase record, report,
completed live-session chain, or closed-result adaptation. The failure is
timeout-consistent, but its exact cause is not attested. It is not classified
as a proven timeout, provider failure, browser-gateway failure, or product
finding.

Cases two through four were not started. No Bob pair completed, so this
attempt supplies no detection, miss, or control-false-positive comparison.
The campaign's final stop rule and the owner's zero-retry budget prohibit
another unchanged run.

All retained preparation, phase, browser, and closure records remain:

```json
{
  "verification_status": "unverified",
  "qualification": "not-evidence",
  "result": null
}
```

## Frozen identities

| Identity | Value |
|---|---|
| Controller commit | `e917060c3a7aa7246f10480d5dcd78a0d17e72d2` |
| Controller repository tree | `bda5988fb9c052c0ba7e8dd39b786c638176e868` |
| Controller `qa-suite/` tree | `2df85dedb7d9916458ae78314e3b8989d8f37f28` |
| Controller-program SHA-256 | `6c23be8be2daa675922e181bbd8937232fd198f0193178cc60e0f9b973722b54` |
| Integrated subject commit | `d688460fab2dfda204d5c24e6a005e70f22899f6` |
| Integrated subject repository tree | `89248cae978cb5020cedba57994818fefae5074b` |
| Integrated subject `qa-suite/` tree | `6902b67449d0a97a19604549a59f09b46ffe54ae` |
| Suite | `bob-evaluation-v1` |
| Public suite SHA-256 | `bac7f4136e3e7dfcb236102ea34b7f81ef92558951b1bd190b96ae6f6c936180` |
| Codex CLI | `codex-cli 0.145.0`; executable SHA-256 `1da3f4e0e96028b8a771814293c3033dafd1971f943f6c7e79b0897fe705f590` |
| Chrome for Testing | `149.0.7827.55`; executable SHA-256 `b1b9e2dd063115031f08eadc10ed381ca0fa05b2284baff8f721d87f5f0f61b7` |

All 21 controller-program paths were byte-identical to the frozen controller
before the attempts.

## Authorization and external-session accounting

The owner explicitly authorized at most twelve fresh Codex CLI sessions to
send the bounded public Bob instructions, the selected public fixture
context/assets, and browser-derived observations to the OpenAI Codex
provider. The authorization continued to exclude sealed-oracle content and
commitments, sibling cases, prior reports, controller state, credentials or
private data, and the owner's PDF/HTML.

The final-rerun node consumed three sessions:

| Item | Sessions |
|---|---:|
| Campaign count before this node | 15 |
| Local attempt 1 | 0 |
| External attempt 2 | 3 |
| Cumulative campaign count after stop | 18 of 43 |

There was no automatic retry headroom. No resumed or reused Codex session was
requested.

## Attempt 1 — local manifest-source failure

The first ignored driver was SHA-256
`ab186ecfddb29c653c037fb2af672f8a076ba17345669e5c874251f3e1db0bff`
and used:

`/Users/slinky/Documents/QA-Suite-worktrees/issue-29-bob-final-rerun-runroot`

Preparation created
`run_fce94469bc128b8daa58fe58c243f48d`, but live-input construction tried to
read the fixture manifest from the lane root. The runner deliberately does
not materialize that controller-side manifest there. The driver therefore
failed before it created a dispatch or started an external session.

The case was still closed:

| Closure field | Value |
|---|---|
| Case | `fx_39e78c1246b2cf2952277010d5f5cedc` |
| `closed.json` SHA-256 | `c557c166ee30ea362748ed7b018ce8a28e508da7d5795106b5f5d5eb89a756` |
| Artifact tree SHA-256 | `37517e5f3dc66819f61f5a7bb8ace1921282415f10551d2defa5c3eb0985b570` |
| Workspace tree SHA-256 | `f2df09c8e23f8caacb23400550b385ed36d304a7a0991a72ae88c04ddee62d45` |
| Closed artifacts | 0 |

This was a local invocation defect, not Bob behavior or a Tier-F failure. The
driver was corrected to read the public manifest from the clean repository
checkout, after all four manifest hashes were verified byte-identical to the
controller commit, and pass it through `validateFixtureManifest()`. The
corrected ignored driver is SHA-256
`0bef212ca4a2ad83c4f3e3c45d6374cc25e29fa2aed3b1537a8a614e818b832f`.
Attempt 2 used a new empty root:

`/Users/slinky/Documents/QA-Suite-worktrees/issue-29-bob-final-rerun-runroot-attempt-2`

No tracked source or Tier-F controller file changed.

## Attempt 2 — first case stopped in task execution

Attempt 2 prepared
`run_e3e376c55071d0a5caa047c3ec278742` and created dispatch
`dispatch_ff97327e91fe653eb211a4647431c366`.

| Phase | Fresh invocation | Controller disposition | Retained thread / turn |
|---|---|---|---|
| `interface_inventory` | New ephemeral process | Accepted | Thread `019fb129-886d-7ef3-8f06-e94109b63fef`; turn SHA-256 `f466993c2abe93db48d9c2ea554b27d930c59ec1b541bb1e77abbdb7460c4248` |
| `expected_use_model` | New ephemeral process | Accepted | Thread `019fb12a-54c9-79e2-b10d-c7ea5e958cb8`; turn SHA-256 `b5ec67a304628a3bae7e2ef7eb42fbbd3589556e7c474471d01c34540e196c6c` |
| `task_execution` | New ephemeral process | Host non-success | No retained thread, Codex JSONL, accepted atomic phase, or controller transition |

The exact host error was:

```text
Bob host process did not complete successfully
```

The captured task browser trail rules out an unclosed gateway or a recorded
gateway-policy violation:

- its gateway closure is `status: "closed"`;
- its 20-entry journal ends with `pending_cdp_requests: 0`;
- its terminal `violations` array is empty; and
- the closed artifact inventory retains the task host policy, authentication
  observation, prompt-input observation, gateway policy, journal, closure,
  screenshots, semantic snapshots, and action receipts.

Those facts do not exclude gateway/browser latency or another unrecorded
contribution to the host non-success.

An ordinary Codex nonzero result at the phase target's post-capture check is
also ruled out: that path writes `codex-turn.jsonl` and `codex-stderr.bin`
before rejecting the nonzero result, while neither file exists for this task
phase in the closed artifact inventory. Those exclusions do not prove what
did happen. The observed shape is timeout-consistent only; provider behavior,
transport, scheduling, and exact termination cause remain unattested.

The first case then reached runner closure:

| Closure field | Value |
|---|---|
| Case | `fx_39e78c1246b2cf2952277010d5f5cedc` |
| `closed.json` SHA-256 | `91c821cc4a44c931a83d93e99f185867cae4080ec7fa4606ab544e28467c991c` |
| Artifact tree SHA-256 | `5ace75690058f750c95e94e91c23431203757f283fe07d537ae4ff750052a183` |
| Workspace tree SHA-256 | `47d27126ef59dbfdc7c0816f18c551282b1a8aa932311b5c3e52db05c73de907` |
| Closure adapter status | `not-run` |

There is no task report, complete three-phase session chain, live-session
record, report binding, verdict, or closed Bob adaptation. The case is
neither a detection nor a miss.

## Unstarted suite remainder

The driver stopped before advancing, as required:

| Public order | Case | Status |
|---:|---|---|
| 1 | `fx_39e78c1246b2cf2952277010d5f5cedc` | Closed incomplete after task host non-success |
| 2 | `fx_ea9eb160a44e5e7f7acd520b92825800` | Not started |
| 3 | `fx_cc4b61fbde593f6e101984583e5e9f88` | Not started |
| 4 | `fx_87a49bf089d33e76d6115d4aef954c01` | Not started |

No pair has a current comparison denominator. No control result or false-
positive budget was evaluated.

## Stop rule, cleanup, and unblock condition

The owner authorized the final post-iteration run with zero automatic retry
headroom. The three attempted external invocations count against the cap even
though the third produced no retained thread or accepted phase transition.
The controller stopped before another case or session began. Each captured
browser gateway reached a clean terminal closure; no browser-gateway
violation is retained.

The final process audit reported:

```text
owned=0 driver=0 codex=0 browser=0 fixture=0
```

The N7 behavior loop is terminal `Blocked`. Another rerun would require new,
explicit owner authority for both the campaign graph and a new external-
session budget; it would be a new authorized node, not a retry of this one.
That theoretical authority does not reopen the current loop. Repair or
extension of the frozen Tier-F controller remains out of scope and would
require separate authority.

The two run roots and ignored driver remain local execution state. They are
not campaign memory and do not travel through commits, PRs, clones, or other
worktrees. This record becomes durable evidence only after review and merge.

## Preserved non-claims

This record does not claim:

- a Bob adversarial detection, miss, control result, or before/after
  improvement;
- that the task failure was a timeout or provider failure;
- provider- or model-authenticated identity;
- effective prompt, context, or tool isolation;
- hostile same-user, root, escaped-session, or non-proxy network containment;
- fixture semantic opacity or report semantic parity;
- authenticated controller state;
- that a browser closure, phase record, or runner closure is qualifying
  evidence; or
- that any Bob lane or the integrated subject passes evaluation.

Every retained output remains `unverified`, `not-evidence`, with `result:
null`.

## Verification commands

Before PR handoff, run:

```sh
node --test
node scripts/release/check.mjs --ref HEAD
git diff --no-index --check /dev/null \
  tests/evaluation/n7-bob-final-rerun.md
git diff --check origin/main...HEAD
```

For the `--no-index` command, exit 1 is expected because the new file differs
from `/dev/null`; any whitespace diagnostic is a failure.
