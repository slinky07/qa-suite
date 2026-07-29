# Lane evaluation contracts

This directory documents the maintainer meta-testing contracts for Issue #30.
It is not an eighth QA lane, does not ship in the QA-Suite archives, and does
not change the behavior of any distributed lane.

The machine authority for shared suite, case, lane, and closure contracts is
`scripts/evaluation/contracts.mjs`;
`scripts/evaluation/scoring.mjs` owns the explicitly non-qualifying preview
math. `scripts/evaluation/git-snapshot.mjs` and
`scripts/evaluation/runner.mjs` own the non-qualifying Git snapshot,
single-case disclosure, lane-root preparation, and artifact closure mechanics.
`scripts/evaluation/bob-host-protocol.mjs` owns the non-qualifying
controller sequence for Bob host adapters.
`scripts/evaluation/codex-host-policy.mjs` owns the pure non-qualifying Codex
host-configuration contract.
`scripts/evaluation/codex-bob-phase-target.mjs` is the measured one-phase live
target. `scripts/evaluation/codex-bob-live-controller.mjs` owns its
three-phase runtime composition and retained controller state.
`scripts/evaluation/bob-report-adapter.mjs` owns the non-qualifying closed Bob
report metadata binding. `scripts/evaluation/browser-gateway.mjs` owns the
non-qualifying rendered-page boundary and is the machine authority for its
gateway-local policy, tool, and closure contracts.
`scripts/evaluation/run-case.mjs` is the snapshot runner's strict CLI. This
README explains the trust boundary and intended delivery sequence; it is not a
second schema. The repository still exposes no qualifying evaluator, and no
preparation, protocol, browser closure, or report-binding output can be
treated as a passing evaluation.

Pure scoring functions may produce a deterministic preview for contract tests.
Every such preview must remain explicitly non-qualifying:

```json
{
  "verification_status": "unverified",
  "qualification": "not-evidence",
  "result": null
}
```

Preview objects are also marked `confidentiality: "controller-secret"`.
Detection and control shapes can imply sealed roles even though raw oracle
tokens are omitted, so previews never become lane or adapter input.

The preview can reveal schema or arithmetic defects. It cannot establish that
a lane saw the intended candidate, ran in isolation, produced the normalized
claims, or detected a practical defect.

## Question under test

The completed Issue #30 system will answer:

> Can an unchanged QA lane detect a known practical defect without being told
> the expected result, while staying within the paired control's false-positive
> budget?

The current contracts and runner mechanics are prerequisites for that answer.
They do not answer it yet.

## Authority and trust boundary

The evaluation uses two controller inputs with different disclosure rules:

- The **public suite** contains routing-safe case metadata. It can identify the
  lane, neutral QA context, public fixture manifest, opaque case IDs, and
  unique per-case oracle commitments. Bob cases also declare one neutral
  surface ID and their core-flow IDs. It contains no role, pair identity,
  expected defect, expected classification, or control budget.
- The **sealed oracle** assigns the opaque tokens to adversarial/control roles,
  pair identity, expected defects, classification bands, flow expectations,
  and the control budget. It is controller-only input and must never be
  dispatched to a lane or its adapter.

The
[Issue #30 scoring and opacity acceptance comment](https://github.com/slinky07/qa-suite/issues/30#issuecomment-4954141078)
is binding: Issue #31 owns canonical verdict scoring, `Blocked` is incomplete
coverage rather than detection, Bob uses the Issue #29 v2 public/sealed split,
and controls retain an explicit false-positive budget.

Omitting oracle text from a prompt is not isolation. A qualifying evaluation
will also need a standalone lane root that cannot read the controller checkout,
Git object database, oracle files, prior reports, inherited development
conversation, secret environment, or non-loopback network.

The completed evaluator must preserve this order:

1. Freeze the controller commit and QA-Suite subject commit.
2. Read the public suite and select one opaque case.
3. Export only that case's declared public fixture bytes and the exact subject
   `qa-suite/` tree into a fresh, isolated root.
4. Dispatch smoke in a fresh context.
5. Stop if smoke gates the deeper lane; otherwise dispatch the selected lane in
   a second fresh context with empty report history.
6. Close and hash every dispatch, report, evidence file, fixture byte, and
   subject byte.
7. Run the lane-specific adapter without oracle access.
8. Open the sealed oracle only inside the controller and score the closed,
  measured evidence.

The current runner implements steps 1–3 and the input/artifact measurement
parts of step 6. It deliberately does not launch a lane, attest operating
system or model-context isolation, run an adapter, open an oracle, or score.
Every preparation and closure retains the three top-level non-qualification
fields. A successful closure records:

```json
{
  "verification_status": "unverified",
  "qualification": "not-evidence",
  "result": null,
  "claims": {
    "input_integrity": "verified",
    "artifact_inventory": "closed",
    "execution_isolation": "not-attested",
    "network_isolation": "not-attested",
    "context_isolation": "not-attested",
    "fixture_opacity": "not-attested",
    "state_authentication": "not-attested",
    "adapter_status": "not-run",
    "method_order": "unverified_by_report"
  }
}
```

Preparation uses the same claims except
`artifact_inventory: "not-closed"`.

No verified byte or closed artifact can compensate for an unattested
execution boundary.

“Public” distinguishes this suite from the sealed oracle; it does not mean the
whole suite is a lane prompt. The runner writes only
`evaluation-case.json`, a strict neutral single-case disclosure. Oracle
commitments, smoke assertions, other cases, the suite, the fixture manifest,
controller paths, and controller state remain outside the lane root.
Bob report identifiers remain with the controller; neither the disclosure,
the selected fixture bytes, nor the first two host phases expose them. The
controller supplies only the selected case's IDs to task execution.
The runner rejects exact controller-confidential tokens and non-selected case
IDs, but it cannot prove that a selected public fixture contains no semantic
hint about its role or expected defect. That is why `fixture_opacity` remains
`not-attested`; reviewed fixture construction and a later sealed-controller
check are still required.

## Preparation and closure

`prepare` resolves the controller and subject refs once, verifies that the
running controller files equal the frozen controller commit, reads fixture
and subject bytes from Git objects instead of the working tree, and creates
fresh exclusive lane and state directories under separate parent paths. The
lane root contains only:

- the selected case's manifest-declared fixture files;
- the exact subject commit's `qa-suite/` tree;
- `evaluation-case.json`; and
- the declared writable artifact roots.

Regular input modes are frozen to `0444` or `0555`. Immutable directories use
`0555`. The single writable root must exactly match the QA context's report
folder and uses `0700`; callers cannot add fixture or convenience roots.
Git object counts, sizes, path depth, and unique parent-node shape are checked
before subject or fixture blobs are read. Tree walks enforce running node,
file, byte, depth, and path limits.
Symlinks, hardlinks, submodules, special files, path escapes, unsupported Git
modes, manifest drift, duplicate paths, and limit violations fail closed.

Controller state and the hash-chained JSONL journal live outside the lane.
`close` accepts new regular files only below the disclosed writable roots,
rechecks immutable bytes and modes, closes a deterministic SHA-256 inventory,
and rejects every controller-confidential commitment or non-selected case ID
found in a path or file. Accepted artifacts are copied through no-follow file
descriptors into the private controller state at `artifacts/`; source metadata
is checked before and after capture. Snapshot files use `0400`, directories
use `0500`, and `artifacts[].path` in `closed.json` is resolved only beneath
that captured root. Later adapters must never consume the mutable lane copy.

Closure first writes a non-authoritative `closed.pending.json`, then appends
the hash-bound terminal `closed` journal event, and only then atomically
publishes `closed.json`. A terminal event without the published record is
incomplete and fails closed; `closed.json` is never visible before its
terminal event. After `close_started` succeeds, a validation failure before
the terminal event appends `invalid`; an unreadable or invalid state or
journal fails before any transition.

The journal chain detects partial writes and accidental corruption. It is
unkeyed and stored in the same user boundary, so it does not resist a hostile
same-user process that rewrites the state and recomputes the chain. Likewise,
read-only snapshot modes are not host-enforced immutability against that
process. Host-protected state, executor quiescence, or external authentication
remains mandatory before any result can qualify.

The CLI does not overwrite or remove a run:

```sh
node scripts/evaluation/run-case.mjs prepare \
  --repository /absolute/path/to/qa-suite \
  --controller-ref <controller-commit> \
  --subject-ref <subject-commit> \
  --suite tests/evaluation/suites/<suite>.json \
  --case <opaque-case-id> \
  --state-parent /absolute/private/state-parent \
  --lane-parent /absolute/lane-parent \
  --writable-root QA

node scripts/evaluation/run-case.mjs close \
  --state /absolute/private/state-parent/<run-id>/state.json
```

The two parent directories must be separate, non-nested directories outside
the controller repository. Preparation does not authorize a person or
automation to dispatch an agent into the lane root.

## Closed Bob report binding

`bindClosedBobReport()` accepts the exact closure metadata returned by
`closeCaseRun()` and selects exactly one artifact named
`QA/YYYY-MM-DD-HHMM-bob-qa-<short-scope>.md`. It validates the current closed
envelope, its fixed non-qualification claims, the complete ordered artifact
metadata, and the artifact-tree digest. Its output binds the run, case,
controller and subject commits, workspace and artifact trees, closure digest,
and selected report metadata without retaining an absolute snapshot path.

This seam does not read the captured report bytes. It does not parse a verdict,
findings, observations, surfaces, or flows; produce a normalized case; open the
sealed oracle; score; or attest method order. The binding therefore remains
`verification_status: "unverified"`, `qualification: "not-evidence"`, and
`result: null`, with report content and structure explicitly unconsumed.
Callers must pass the returned closure directly; a metadata object supplied by
an untrusted same-user process is not authenticated merely because it passes
the schema.

`adaptClosedBobHostResult()` snapshots and validates the closure, suite, and
host transcript, then joins the selected report metadata to the
controller-hashed structured lane result. The join requires exact run, case,
commit, suite, report-ID, report-path, and report-digest bindings. Every
lane-result evidence path must also exist in the closed artifact inventory.

The adaptation does not read Markdown or claim that its prose matches the
structured output. It is a partial Bob lane adaptation, not a complete
normalized case: report content remains `not-read`, semantic parity,
method-order, and state authentication remain `not-attested`, and the envelope
remains `unverified`, `not-evidence`, with `result: null`.

## Bob method-order gate

The
[Issue #30 owner comment](https://github.com/slinky07/qa-suite/issues/30#issuecomment-5062017129)
requires Bob to inventory the visible interface, form an expected-use model,
and only then exercise tasks in a logical hierarchy. Current Bob Markdown can
record IA and task rows, but report order, filenames, and filesystem times do
not prove execution chronology. The runner therefore records
`method_order: "unverified_by_report"` and cannot promote a closed Bob report.

The controller now exposes a narrow, injected-adapter protocol with three
ordered calls:

1. `interface_inventory`, with observation capability only;
2. `expected_use_model`, with the accepted inventory and observation
   capability only; and
3. `task_execution`, with accepted inventory/model output and task-action
   capability, the selected report IDs, and an exact structured lane result
   plus canonical report path and SHA-256.

The protocol rejects unknown fields, non-inventoried controls, invalid task
parents, incomplete task coverage, and task results outside the modeled
order. Each task result names exactly one selected core flow and hashes that
flow's ordered evidence-pointer set. Pass/Fail flows require exercised tasks;
Observed-only and Not-tested flows require matching task dispositions. The
protocol also rejects a Go-family result when every selected core flow is Not
tested. The adapter asserts the finalized report SHA-256. The controller
hashes the accepted output into the transcript; only
`adaptClosedBobHostResult()` later compares the report assertion and evidence
paths with the closed artifact inventory. These adapter assertions are not
proof by themselves.

A controller-executed transcript remains `unverified`, `not-evidence`, and
`result: null`; every isolation and method-order claim remains `not-attested`.
Its completion proves only the controller call sequence. A composer-built
transcript proves only validated structural dependencies and digest/event
ordering, not process chronology or method order. Neither kind proves that an
unreviewed adapter withheld other tools, that the inventory or model is
semantically correct, or that a real host obeyed the requests.
Report sections, filenames, timestamps, and lane-authored event files remain
unacceptable chronology evidence.

### Pinned Codex transport parser

`scripts/evaluation/codex-0145-events.mjs` parses the deliberately narrower
successful Bob-host subset of one JSONL turn from Codex CLI 0.145.0. It
requires the exact thread/turn lifecycle, exact five-field usage object,
successful non-overlapping MCP start/completion pairs, optional completed
reasoning, and one final completed agent message. The returned record
preserves invocation order and decoded MCP argument/result values; it
deliberately does not interpret browser-gateway semantics or the final Bob
phase output.

The wire contract is pinned to the upstream
[0.145.0 event types](https://github.com/openai/codex/blob/rust-v0.145.0/codex-rs/exec/src/exec_events.rs)
and
[JSONL event mapper](https://github.com/openai/codex/blob/rust-v0.145.0/codex-rs/exec/src/event_processor_with_jsonl_output.rs).
`tests/evaluation/fixtures/codex-0.145.0/success.jsonl` is a retained,
sanitized capture from the matching CLI. A Codex upgrade requires deliberate
source review and a fresh captured fixture.

The parser is synchronous and has no process, credential, filesystem, network,
or CLI entrypoint. Its record and unkeyed SHA-256 source digest are transport
data, not evidence: this constituent does not authenticate the provider,
model, MCP server, tool result, sandbox, or qualifying execution.

### Codex-to-gateway journal binding

`bindCodexBrowserGatewayJournal()` accepts raw controller-captured bytes for
one Codex JSONL turn, browser policy, browser closure, and gateway journal,
plus the controller-selected MCP alias and expected gateway source digest. It
reuses the pinned Codex parser and the gateway's policy, tool, invocation,
closure, MCP-response, and journal contracts. The join requires one closed,
violation-free gateway lifecycle, its canonical policy and closure, an exact
zero-rooted journal chain, one measured browser start, one terminal proxy
summary, no failed tool calls, and zero pending CDP requests.

Every parsed Codex gateway call consumes exactly one ordered
`tool_completed` record. The join binds the configured MCP alias, phase tool,
validated arguments, canonical decoded JSON result, Codex item sequences, and
gateway journal sequence. A screenshot's returned PNG bytes must match the
byte count and SHA-256 in its decoded artifact result. Missing, extra,
duplicated, reordered, or substituted calls and receipts fail closed.
Non-call page, console, and proxy payloads remain hash-chained gateway records;
the join does not restate or reinterpret their gateway-owned schemas.

The returned binding contains only identities, sequences, and digests. It
remains `verification_status: "unverified"`, `qualification: "not-evidence"`,
and `result: null`. It does not inspect the final agent message, validate a Bob
phase output, launch Codex, follow a mutable journal path, authenticate the
unkeyed records or provider, attest the sandbox, or qualify execution.

### Atomic Codex Bob phase adaptation

`adaptCodexBobPhaseTurn()` in
`scripts/evaluation/codex-bob-phase-adapter.mjs` joins exactly one raw Codex
turn, one validated Bob phase request, and that turn's compact gateway binding.
It accepts only the phase-specific canonical output. Inventory and modeling
return their canonical outputs directly; task execution alone converts its
exact `report_markdown` UTF-8 bytes into an unwritten
`{ bytes, path, sha256 }` report candidate.

The adapter returns a fixed `unverified`, `not-evidence`, `result: null`
receipt. It writes and launches nothing, and it does not authenticate the
inputs, attest a sandbox or method order, compose multiple phases, qualify an
execution, or prove that any report or evidence artifact exists.

### Three-phase Codex Bob composition

`composeCodexBobPhaseRecords()` joins exactly one validated atomic record for
each Bob phase. It delegates Bob request and transcript semantics to the
public validators in `bob-host-protocol.mjs`, binds each atomic receipt and
its digests, and requires the three recorded Codex thread IDs to be distinct.
It returns the authoritative Bob transcript, one compact composition, and the
task phase's unwritten report candidate without restating either authority's
schema.

The composition remains `unverified`, `not-evidence`, and `result: null`.
It writes and launches nothing. Digest linkage and distinct recorded thread
IDs do not prove actual process chronology or method order, authenticate the
provider or controller state, attest a sandbox, prove that a report or
artifact exists, or qualify an execution.

### Signed controller session chain

`scripts/evaluation/codex-session-chain.mjs` creates one ephemeral Ed25519
keypair and signs exactly three accepted controller transitions in Bob's fixed
phase order. Each transition binds the request, emptied-process receipt, host
policy, authentication observation, prompt-input diagnostic, raw Codex JSONL,
gateway binding, atomic receipt, thread, and output digests to the preceding
transition. The private key remains inside the signer and is discarded when
the complete chain closes; retained readers receive the canonical
transitions, signatures, and public key.

Signature verification proves only that the same ephemeral key signed the
three supplied transition digests. It does not authenticate the controller or
provider, rederive the supplied observations, resist hostile same-user or root
memory and record replacement, attest a sandbox, or qualify evidence. The
chain therefore remains `unverified`, `not-evidence`, and `result: null`.

### Pure Codex host policy

`scripts/evaluation/codex-host-policy.mjs` validates and canonically binds the
configuration for a future Codex Bob host. It accepts Darwin only and rejects
every other platform before a conforming caller has a policy to dispatch. The
policy pins a measured Codex CLI 0.145.0 executable, requests the built-in
OpenAI transport, and requires one new ephemeral invocation for each Bob
phase. No phase resumes or reuses another phase's client context.

Each invocation disables Codex's built-in shell, unified-exec, and web tools,
uses the stable read-only command sandbox, and admits exactly one trusted MCP
server: the measured browser gateway with only that phase's canonical tools.
It requests zero project-document bytes, no fallback project-document names,
and empty configured developer instructions. Those are launch requests, not
proof that a managed application supplied no additional instruction layers.
The command sandbox governs model-initiated local commands; the Codex
process's provider transport is a separate client channel outside that sandbox
and is not reclassified as command egress. The gateway and controller, not the
model, retain browser receipts and QA artifacts.

The canonical policy and its digest prove only that this closed configuration
was accepted. They do not launch Codex or authenticate controller state,
provider-signed model identity, the actual runtime model/tool inventory, or a
fresh provider context. They also do not resist hostile same-user or root
interference, contain `setsid` or detached-session escape, attest Chrome
non-proxy isolation, establish semantic fixture opacity, or qualify an
execution.

Bounded P1 follow-ups remain: authenticate the applied controller policy and
observed provider/model/tool inventory at runtime; close or explicitly govern
the hostile same-user, root, and escaped-session boundary; and obtain
independent evidence for Chrome non-proxy isolation and fixture semantic
opacity. These are evidence gaps, not claims supplied by the pure policy.

### Non-qualifying direct-process boundary

`scripts/evaluation/bob-host-executor.mjs` can supply the protocol with three
one-shot supervised targets, one per phase. Its program path and expected
SHA-256, fixed arguments, bounded support-file declarations, lane root,
limits, and confidential values are controller-only inputs; no public fixture
may select or alter them. Each support file has an absolute non-symbolic path
and expected SHA-256 and must be a bounded, single-link regular file with no
group or world write permission. Owner-writable controller files are allowed.
The list is dense, ordered, unique, capped at 32 files and 64 MiB
total, and mandatory even when empty. Each launch uses the sealed lane root as
its working directory, a newly constructed `LANG`/`LC_ALL`/`TZ` environment,
`shell: false`, bounded stdin/stdout/stderr, and a controller-enforced
deadline. On POSIX, each phase runs under a controller-owned detached
supervisor and process group. The executor creates the dispatch identity; the
supervised target reads one complete canonical request to EOF and returns one
canonical response bound to the phase and request digest.

The supervisor reads a dedicated controller-liveness pipe on descriptor 4.
The controller keeps its writable end open for the invocation. Pipe EOF or
error, including controller loss, makes the supervisor send `SIGKILL` to its
own inherited process group and exit. This loss path performs cleanup but
cannot issue an emptiness receipt after the controller is gone. During normal
settlement, the controller first terminates and probes the known-live group,
then ends and drains the liveness pipe.

The controller records the fixed-policy digest, program/argument digests, and
aggregate support-file declaration digest, plus one receipt per successful
supervised target. It scans every support file and complete bounded stdout and
stderr for the evaluation contract's opaque confidential tokens. It rejects
primary-executable, support-file, or lane-root drift, malformed framing,
cross-execution response reuse, timeout, oversized output, or nonzero exit.
After the group is known live, every success or failure path force-terminates
it and proves it empty before settling. A successful receipt records only the
narrow process claim that the controller-owned group was observed empty. The
resulting record is still `unverified`, `not-evidence`, and `result: null`, and
the protocol's claims remain `not-attested`.

An optional trusted observer receives defensive copies only after the target
group is empty and the protocol has semantically accepted that phase output
and appended its controller event. Observer rejection stops before the next
phase. Framing-valid but semantically invalid output never reaches the
observer.

This bounded cleanup covers only ordinary descendants that remain in the
inherited process group; it is not general process-tree proof or a sandbox. It
does not contain hostile `setsid`, `setpgid`, or detached-session escape,
resist hostile same-user or PID interference, support Windows, authenticate
controller state or the provider, attest a fresh model context or network
isolation, distinguish provider transport from tool egress, restrict absolute
tools, prove that a rendered interface was exercised or that any report or
artifact exists, or produce qualifying evidence. The descriptor-4 loss path
cannot reach a process that has left the inherited group. A real host adapter
must fail before dispatch unless its separately reviewed platform prerequisites
prove the required properties.
The executor does not infer which arguments name files. A real host adapter
must declare every interpreter payload, MCP server, output schema, and static
configuration it consumes in `support_files`. Identity and content checks
detect ordinary drift before and after each phase, but cannot eliminate a
hostile same-user race between those checks and a file read.

### Non-qualifying browser gateway

`scripts/evaluation/browser-gateway.mjs` exposes a small MCP server for the
three Bob phases. Interface inventory and expected-use modeling receive only
`observe_page` and `capture_screenshot`; task execution additionally receives
`set_control` and `activate_control`. Tool arguments cannot supply a selector,
URL, script, CDP method, executable, or filesystem path. Actions resolve a
visible `data-control-id` immediately before input and retain one before
snapshot, one after snapshot, and an action receipt.

The controller supplies one canonical policy that binds the phase, request,
numeric-loopback target and allowed paths, fresh evidence directory, viewport,
Chrome path and SHA-256, and artifact, journal, tool, and transport limits. The
gateway launches a detached same-source Node supervisor as the owned process
group leader. The supervisor launches measured Chrome in that group with a
fresh temporary profile, passes the NUL-framed remote-debugging descriptors
directly, and watches a gateway-only liveness pipe. Pipe loss force-kills the
owned group, covering abrupt gateway or outer-controller loss for ordinary
Chrome descendants. For proxy-aware URL traffic, Chrome bypasses
the proxy only for the exact declared HTTP origin; selected-page interception
enforces the GET/path allowlist before those requests reach the fixture. Other
proxy-aware URL traffic is routed to a deny-only loopback proxy, with QUIC
disabled. The proxy never opens an upstream connection, and retains only
bounded aggregate counts and a rolling digest because Chrome can issue
unrelated background requests. The gateway creates one fresh browser context,
denies downloads, synthesizes an empty favicon response, pauses and closes
observed extra page/worker targets, detects WebSocket, WebTransport, and direct
TCP attempts plus top-frame URL drift, and removes its temporary profile at
close. While the supervisor leader is still live, close sends the supervised
group `SIGTERM` and polls it until empty. If the group survives while the
leader remains live, close sends `SIGKILL` and polls once more. It never
signals a stale group ID after leader exit; either ambiguity or a surviving
group makes the closure invalid. Hostile session escape, same-user or root
interference, and supervisor suspension remain outside this narrow claim. MCP
framing accepts the protocol's
parameter-optional messages, bounds every message and response, and honors
output backpressure. The profile is removed only after the group is proven
empty; an invalid ambiguous cleanup retains it for safe diagnosis. The profile
is disposable process state; all retained evidence lives below the declared
`QA/evidence/` path. Platforms without POSIX process-group signaling fail
before Chrome launch.

Every successful tool call writes bounded artifacts before returning. The
gateway closes a compact hash-chained JSONL journal and an exact
`gateway-close.json` binding the policy, request, entrypoint, tool schemas,
Chrome identity, browser stderr, and terminal violations. Files are created
without overwrite; the journal is frozen read-only before the terminal closure
is atomically published. The runner's controller program binding separately
freezes the gateway and its imported evaluation contracts at the controller
commit.

This boundary proves neither browser truth nor Bob correctness. The deny proxy
constrains proxy-aware URL traffic in the measured Chrome run; it is not
OS-level network isolation and does not attest non-proxy UDP, Direct Sockets,
a hostile Chrome, or hostile same-user processes. Node and the operating
system remain outside its confinement; the journal is unkeyed; fixture opacity
and report semantics remain unattested. The live phase target can connect this
gateway to a model host, but that does not expand the gateway's claim. The
measured Chrome launcher does not authenticate the rest of the application
bundle. Every closure therefore remains `verification_status: "unverified"`,
`qualification: "not-evidence"`, and `result: null`. The opt-in live tests
require `QA_SUITE_LIVE_BROWSER=1` and retain their receipts below
`QA/evidence/`.

## Live Codex Bob target and controller

`scripts/evaluation/codex-bob-phase-target.mjs` is one measured Node target
for one Bob protocol phase. The live controller accepts it only when the
direct-process program names the real resolved Node executable, the exact
target source, and the complete hashed support set. That set contains the
target's transitive evaluation sources, the three phase-output schemas, the
measured fixture server and fixture assets, and every distributed prompt
input. The executor checks those files before and after each launch. The
target separately rechecks its Node, Codex CLI 0.145.0, gateway, Chrome
launcher, fixture, prompt, and selected-schema identities.

Each target invocation runs two bounded client diagnostics before its phase.
`codex login status` must report the exact ChatGPT login method; this observes
only the local client's status. `codex debug prompt-input` receives the exact
phase prompt, but runs as a separate process and retains only message count,
roles, byte counts, and digests. It does not attest the context supplied to
the later `codex exec` process. Configured project-document and developer
instruction suppression does not remove managed or application context.

The target starts the measured numeric-loopback fixture, creates the fixed
host and gateway policies, and launches one fresh Codex 0.145.0 phase process.
It never resumes another phase. Every phase must call both `observe_page` and
`capture_screenshot`; task execution may also use its phase-scoped control
tools. The target retains the raw JSONL, bounded stderr, policies, client
observations, browser journal and closure, gateway binding, and atomic phase
record below:

```text
QA/evidence/<run-id>/<dispatch-id>/<phase>/
```

The target-side binding and adapter check are preliminary. They run before
the outer target group settles and do not authorize the retained output.

`executeCodexBobLiveSession()` dispatches exactly three one-shot targets in
Bob's fixed order, which yields three distinct Codex phase processes. A
controller observer runs only after the direct-process executor has proven
the target group empty and the protocol has semantically accepted the phase.
The observer then rereads bounded retained files, independently rebuilds the
Codex-to-gateway binding and atomic adaptation, and compares those authorities
with the target record, executor output, request, process receipt, and host
policy. Only that accepted transition enters the ephemeral Ed25519 chain.

The caller supplies a persistent `0700` controller-state parent outside and
non-nested with the lane. The controller creates a new private session
directory and exclusively retains each phase record, the completed session
chain, and the live-session record there. After all three accepted phase
records independently compose to the executor transcript, it writes the task
report candidate once with exclusive creation under the lane and makes it
read-only. It never overwrites a report.

The live result is strictly non-qualifying. Its only positive identity claims
are the controller-observed ChatGPT client status and continuity under the
ephemeral Ed25519 key. It does not authenticate the provider, model, effective
tool inventory, managed prompt context, report semantics, or sandbox. It also
does not contain hostile same-user or root interference, `setsid`/`setpgid`
escape, or a hostile Chrome launcher, and the launcher digest does not
authenticate the complete Chrome application bundle. The report remains a
candidate, not a QA finding or release result. Every retained atomic target,
controller phase, chain, and live-session record stays
`verification_status: "unverified"`, `qualification: "not-evidence"`, and
`result: null`.

## Public suite

Serialized inputs must pass `parseContractJson` before validation so duplicate
JSON keys fail closed. Unknown fields, unsafe paths, duplicate case IDs, and
invalid opaque identifiers also fail under the machine contract. A valid suite
contains complete adversarial/control capacity without revealing which case
has which role. This illustrative pair contains two cases; placeholder hashes
and tokens retain the contract's full required shape:

```json
{
  "schema_version": 1,
  "id": "bob-evaluation-v1",
  "lane": "bob-qa",
  "cases": [
    {
      "id": "fx_0123456789abcdef0123456789abcdef",
      "qa_context": "tests/evaluation/fixtures/fx_0123456789abcdef0123456789abcdef/qa-context.md",
      "fixture_manifest": "tests/evaluation/fixtures/fx_0123456789abcdef0123456789abcdef/fixture-manifest.json",
      "oracle_commitments": [
        "seal_1111111111111111111111111111111111111111111111111111111111111111",
        "seal_3333333333333333333333333333333333333333333333333333333333333333"
      ],
      "report_identifiers": {
        "core_flow_ids": ["flow_00112233445566778899aabbccddeeff_01"],
        "surface_id": "surface_00112233445566778899aabbccddeeff"
      },
      "smoke_checks": ["check_primary"]
    },
    {
      "id": "fx_fedcba9876543210fedcba9876543210",
      "qa_context": "tests/evaluation/fixtures/fx_fedcba9876543210fedcba9876543210/qa-context.md",
      "fixture_manifest": "tests/evaluation/fixtures/fx_fedcba9876543210fedcba9876543210/fixture-manifest.json",
      "oracle_commitments": [
        "seal_4444444444444444444444444444444444444444444444444444444444444444",
        "seal_5555555555555555555555555555555555555555555555555555555555555555"
      ],
      "report_identifiers": {
        "core_flow_ids": ["flow_ffeeddccbbaa99887766554433221100_01"],
        "surface_id": "surface_ffeeddccbbaa99887766554433221100"
      },
      "smoke_checks": ["check_primary"]
    }
  ]
}
```

Every public commitment is globally unique. The sealed oracle assigns each
case's commitments to its canary and expected-defect or budget ID. Only the
sealed oracle maps a case to its role and sealed pair identifier. Similar
public products may make pair membership inferable; this boundary hides role
and controller tokens, not semantic similarity.

Bob `report_identifiers` are strict, role-neutral, and globally unique per
case, so they cannot act as a public pair join. They stay outside fixture
bytes, lane disclosure, interface inventory, and expected-use modeling; only
task execution receives the selected case's IDs. Each case uses an independent
opaque report token rather than its disclosed case token, so the identifiers
cannot be derived during the first two phases. The declaration does not
enumerate controls, observations, expected findings, criteria, severity,
priority, or outcomes. It therefore preserves Bob's obligation to inventory
the interface and form its own expected-use hierarchy.

Each referenced manifest lists only the exact neutral QA context and public
regular files. Paths are ordered and unique; modes are `100644` or `100755`;
every file has a SHA-256 declaration. For example:

```json
{
  "schema_version": 1,
  "case_id": "fx_0123456789abcdef0123456789abcdef",
  "files": [
    {
      "path": "tests/evaluation/fixtures/fx_0123456789abcdef0123456789abcdef/public/run.sh",
      "mode": "100755",
      "sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    },
    {
      "path": "tests/evaluation/fixtures/fx_0123456789abcdef0123456789abcdef/qa-context.md",
      "mode": "100644",
      "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    }
  ]
}
```

The pure helper can derive a deterministic identity for this declaration, but
that identity is not proof of fixture bytes. `prepare` separately verifies
the declared modes and hashes against the frozen controller commit, exports
the actual bytes, and measures the complete standalone input tree. That
measurement proves input integrity only; it does not attest execution
isolation or lane behavior.

## Sealed oracle

Schema version 1 permits one known practical defect in an adversarial case and
no expected defect in its paired control. The following abbreviated objects
show one complete pair; `contracts.mjs` remains authoritative for exact keys
and validation:

```json
[
  {
    "schema_version": 1,
    "case_id": "fx_0123456789abcdef0123456789abcdef",
    "pair_id": "seal_2222222222222222222222222222222222222222222222222222222222222222",
    "role": "adversarial",
    "canary_token": "seal_1111111111111111111111111111111111111111111111111111111111111111",
    "assertions": {
      "allowed_verdicts": ["Go with findings"],
      "expected_defects": [
        {
          "id": "seal_3333333333333333333333333333333333333333333333333333333333333333",
          "surface_id": "surface_configuration",
          "criteria_any_of": ["IA-01", "IA-06", "H8"],
          "allowed_severities": ["S3", "S4"],
          "allowed_priorities": ["P1", "P2"],
          "required_evidence_kinds": ["screenshot"]
        }
      ],
      "flows": [],
      "control_budget": null
    }
  },
  {
    "schema_version": 1,
    "case_id": "fx_fedcba9876543210fedcba9876543210",
    "pair_id": "seal_2222222222222222222222222222222222222222222222222222222222222222",
    "role": "control",
    "canary_token": "seal_4444444444444444444444444444444444444444444444444444444444444444",
    "assertions": {
      "allowed_verdicts": ["Go", "Go with findings"],
      "expected_defects": [],
      "control_budget": {
        "id": "seal_5555555555555555555555555555555555555555555555555555555555555555",
        "surface_ids": ["surface_configuration"],
        "criteria_any_of": [
          "IA-01",
          "IA-02",
          "IA-03",
          "IA-04",
          "IA-05",
          "IA-06",
          "IA-07",
          "H1",
          "H2",
          "H3",
          "H4",
          "H5",
          "H6",
          "H7",
          "H8",
          "H9",
          "H10"
        ],
        "max_total": null,
        "max_by_severity": {
          "S1": 0,
          "S2": 0,
          "S3": 0,
          "S4": null
        },
        "observations": "record-only"
      },
      "flows": []
    }
  }
]
```

Each Bob control budget covers IA-01 through IA-07 and H1 through H10 on its
selected surface, so an S1-S3 IA finding cannot evade false-positive scoring.
The control budget is independent of statistical precision. `null` means an
unbounded count; it is not risk acceptance and does not remove a finding from
the canonical verdict. For example, an allowed Bob S4 control finding can stay
within budget while still reducing finding precision. Severity-free
observations are recorded separately and never enter verdict, detection, or
precision arithmetic.

## Committed Bob corpus

`tests/evaluation/suites/bob-evaluation-v1.json` now declares two Bob
adversarial/control pairs with opaque identifiers. Their controller-only
oracle is
`tests/evaluation/oracles/bob-evaluation-v1.json`; that path is intentionally
absent from the public suite and all four fixture manifests.

The Pocket Notes pair has the same visible controls, copy, styles, and
successful note/preference behavior. One layout places display preferences
between note details and the primary action; the other keeps the same
preferences after the completed note-creation task.

The Project Finder pair has the same project data, search and status controls,
copy, styles, and successful filtering and recovery behavior. One layout puts
the exact `Edit filters` action inside a closed `Advanced search` disclosure;
the other exposes that action directly in the results workspace. The sealed
assertions permit only S4 information-architecture findings and require every
declared user flow to pass. Both pairs therefore isolate a discoverability
variable without turning a usable fixture into a fabricated `No-Go`.

`tests/evaluation-fixture-corpus.test.mjs` validates the committed suite,
oracle set, exact manifest inventory, raw file hashes and modes, token
non-disclosure, pair equivalence, pure application behavior, and loopback
serving. `tests/evaluation-bob-search-fixture-pair.test.mjs` proves the Project
Finder pair's sole placement variable and filtering/recovery flows. These
checks prove deterministic fixture bytes and behavior only. They do not attest
semantic opacity, host isolation, a Bob baseline, or any qualifying evaluation
result.

## Smoke gating and incomplete coverage

Smoke always runs first. Its canonical outcome controls whether a deeper lane
may run:

- `Go` permits the deeper lane dispatch only after every smoke check declared
  by the public case is present exactly once and passed.
- `No-Go` gates the deeper lane only when the closed smoke evidence contains
  the structured failed-check signal required by the smoke contract.
- `Blocked` gates the deeper lane because environment or tooling prevented
  exercising scope. It is incomplete coverage, not a defect detection.

A gated observation must not fabricate a deeper-lane dispatch, report,
candidate measurement, finding, or denominator. `Blocked` contributes neither
a detection success nor a detection miss. `No-Go` by itself is also
insufficient evidence: the future adapter and runner must bind it to the
structured failed check and its closed evidence.

## Canonical verdict consistency

Evaluation consumes the existing QA-Suite verdict contract; it does not define
a competing one:

- any confirmed S1/S2 finding, or a demonstrably failed core flow, requires
  `No-Go`;
- only S3/S4 findings require `Go with findings`, including canonical counts;
- no findings requires `Go`;
- `Blocked` is reserved for an environment or tooling blocker and is never
  derived from missing coverage alone; and
- Priority controls scheduling, not the verdict.

A normalized claim that contradicts the closed report or this mapping is
invalid. A blocked core flow requires the lane's `Blocked` verdict and
incomplete coverage unless stronger evidence requires `No-Go`. `Observed only`
remains a coverage qualifier and cannot be promoted to a pass or an effective
flow. A scored `Pass`, `Fail`, or `Blocked` flow requires evidence, and each
oracle flow assertion names the evidence kinds it accepts.

## Pure scoring preview

Detection and classification are separate assertions:

```text
detected =
  finding.surface_id == expected.surface_id
  AND finding.criteria intersects expected.criteria_any_of

classified =
  the same finding satisfies allowed Severity and Priority
  AND carries every required evidence kind
```

One finding must satisfy the complete assertion; fields cannot be assembled
from multiple findings. For a complete adversarial/control pair, pure scoring
may preview:

```text
detection = matched expected defects / expected defects
finding precision = matched expected defects /
                    (matched expected defects + scoped control findings)
control budget = independent comparison with max_total and Severity limits
```

Budget scope controls only false-positive accounting. It never narrows the
canonical verdict: an out-of-scope S3/S4 finding still requires
`Go with findings`, even though it does not consume the scoped control budget.

Zero denominators remain `null`. Aggregate ratios use summed counts instead of
averaging percentages. Regardless of the arithmetic, foundation output retains
`verification_status: "unverified"`, `qualification: "not-evidence"`, and
`result: null`.

## Deferred Issue #30 delivery

The following remain deliberately outside the current non-qualifying
constituents:

- the other lane corpora required for campaign acceptance;
- a qualifying runtime boundary that authenticates controller state, the
  provider/model/tool inventory, fresh model context, hostile process-tree
  completion, and command-network isolation without conflating provider
  transport with tool egress;
- smoke-first dispatch and deeper-lane gating;
- composition of the partial Bob lane adaptation with the smoke gate into a
  complete normalized case;
- host-bound, authenticated evidence that a real Bob execution obeyed the
  controller's inventory/model-before-task protocol;
- runner-controlled oracle opening and scanning of every closed output byte
  against its complete confidential token set;
- baseline runs and retained baseline evidence;
- remediation, before/after comparison, and retained remediation evidence; and
- CI scheduling for recurring or release-gated evaluation.

Those capabilities must land through later Issue #30 branches and PRs. Until
they do, contracts, fixtures, previews, preparations, protocol transcripts,
and closures are maintainer verification aids, not QA findings, release
certification, issue proposals, or proof that a lane passes its evaluation.
