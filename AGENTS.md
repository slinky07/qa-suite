# QA-Suite repository instructions

## Sources of authority

- `qa-suite/` is the distributed QA skill and the behavior source of truth.
- `VERSION` is the release version source of truth.
- `.codex-plugin/plugin.json`, `.claude-plugin/plugin.json`,
  `.claude-plugin/marketplace.json`, and the repository-version statement in
  `README.md` must match `VERSION`.
- Release automation and version-only PRs must not edit `qa-suite/`. Feature
  PRs update the skill first and mirror its public contract into wrapper files
  only where needed.

### Maintainer evaluation authority exception

Issue #30 meta-testing is maintainer-only infrastructure that evaluates the
distributed skill without changing it:

- `scripts/evaluation/*.mjs` is maintainer-only evaluation infrastructure;
  within it, `scripts/evaluation/contracts.mjs` is the machine authority for
  shared suite, case, lane, and closure contracts, while
  `scripts/evaluation/scoring.mjs` owns the explicitly non-qualifying preview
  math.
- `tests/evaluation/README.md` is the human-readable authority for the
  evaluation trust boundary and delivery sequence.
- `scripts/evaluation/bob-host-protocol.mjs` is the non-qualifying
  controller seam for Bob's interface-inventory, expected-use-model, then
  task-execution order. The controller snapshots the selected suite case's
  report IDs, withholds them from the first two phases, and supplies them only
  to task execution. It exposes the same prepared binding before dispatch and
  may notify a trusted observer only after a phase output passes its semantic
  authority and enters the controller event chain. It accepts only an injected
  host adapter and never launches an arbitrary executable.
- `scripts/evaluation/codex-0145-events.mjs` is the dormant transport parser
  for the deliberately narrower successful Bob-host subset of a Codex CLI
  0.145.0 JSONL turn. It accepts only one exact optional todo-list lifecycle,
  sequential MCP lifecycles, completed reasoning, one final agent message, and
  exact usage fields. It does not launch Codex, interpret browser tools,
  validate a Bob phase output, bind a gateway journal, or qualify evidence.
- `bindCodexBrowserGatewayJournal()` in
  `scripts/evaluation/browser-gateway.mjs` is the pure non-qualifying join
  between one raw Codex turn and one controller-supplied browser policy,
  closure, and captured journal. It consumes every gateway call and receipt
  once in order, including the screenshot byte/artifact join, but never
  interprets the final Bob phase output or authenticates either process.
- `adaptCodexBobPhaseTurn()` in
  `scripts/evaluation/codex-bob-phase-adapter.mjs` is the pure atomic join for
  one raw Codex turn, one validated Bob phase request, and that turn's compact
  gateway binding. It accepts only the phase-specific canonical output; task
  execution alone may yield an unwritten report candidate. Its fixed
  non-evidence receipt performs no writes or launches and proves no
  authentication, sandbox attestation, method order, multi-phase composition,
  qualification, or artifact existence.
- `composeCodexBobPhaseRecords()` joins exactly three validated atomic records
  into the Bob transcript accepted by the public transcript and request
  validators, one compact composition, and the task phase's unwritten report
  candidate. It binds the atomic receipts and digests and requires distinct
  recorded Codex thread IDs, but performs no writes or launches and proves no
  process chronology, method order, provider or state authentication, sandbox
  attestation, report or artifact existence, or qualification.
- `scripts/evaluation/codex-session-chain.mjs` signs exactly three accepted
  controller transitions with one ephemeral Ed25519 key and retains the public
  key, canonical transitions, signatures, and bound request, process, policy,
  context-diagnostic, transport, gateway, atomic-receipt, thread, and output
  digests. External signature verification proves continuity under that
  ephemeral key only. It does not authenticate who controlled the key, the
  provider, model, sandbox, same-user boundary, or retained record, and it
  never promotes the session beyond `unverified`, `not-evidence`, and
  `result: null`.
- `scripts/evaluation/codex-bob-phase-target.mjs` is the one-phase live target.
  It rechecks the measured Node, Codex CLI 0.145.0, gateway, Chrome launcher,
  fixture server and assets, prompt inputs, and selected output schema. It
  records an exact ChatGPT client-login observation and a separate digest-only
  `prompt-input` diagnostic, starts the measured loopback fixture, launches
  one fresh Codex phase process under the fixed host policy, and retains its
  bounded raw artifacts below the phase's `QA/evidence/` directory. The
  diagnostic is not the dispatched process's context, and neither observation
  authenticates the provider, model, effective tool inventory, managed
  instructions, or sandbox.
- `scripts/evaluation/codex-bob-live-controller.mjs` accepts only the real
  measured Node executable, the exact phase target, and the complete hashed
  target support set: its transitive evaluation sources, three output schemas,
  fixture server and assets, and distributed prompt inputs. It dispatches
  three one-shot targets and therefore three distinct Codex phase processes.
  After each target group is proven empty and its phase output is semantically
  accepted, the controller rereads the retained bytes, independently rebinds
  the gateway journal and reruns the atomic adapter, then signs the accepted
  transition. It retains phase, chain, and session records with exclusive
  writes in a caller-supplied private state directory outside the lane and
  creates the report candidate exclusively only after three-phase composition.
  The live record remains `unverified`, `not-evidence`, and `result: null`.
- `scripts/evaluation/codex-host-policy.mjs` is the pure non-qualifying Darwin
  host-configuration contract. It rejects unsupported platforms before a
  conforming caller can dispatch and binds the measured Codex CLI 0.145.0
  executable, requested built-in OpenAI transport, three fresh ephemeral
  phases, disabled built-in shell, unified-exec, and web tools, the stable
  read-only command sandbox, and exactly one phase-scoped browser gateway.
  It also requests zero project-document bytes, no fallback project-document
  names, and empty configured developer instructions. Managed or application
  instruction layers may still remain. Provider transport is outside that
  command sandbox and is never presented as permitted command egress. The
  contract launches nothing and does not prove provider-signed identity,
  effective context removal, controller-state authentication, the runtime
  model/tool inventory, hostile same-user or root isolation, escaped-session
  containment, Chrome non-proxy isolation, semantic fixture opacity, or
  qualification.
- `scripts/evaluation/bob-host-executor.mjs` is the non-qualifying direct
  process boundary for that seam. It accepts only a controller-owned absolute
  executable with an expected SHA-256, fixed arguments, and a bounded list of
  independently hashed, single-link support files that are not group- or
  world-writable. On POSIX, each phase runs under a controller-owned detached,
  shell-free supervisor and process group. The supervisor reads a dedicated
  controller-liveness pipe on descriptor 4. Controller loss closes the pipe,
  so the supervisor sends `SIGKILL` to its inherited group and exits without a
  receipt. While the controller remains live, every success or failure path
  force-terminates the known-live group and proves it empty before settling.
  A trusted observer may receive defensive copies of a request, semantically
  accepted output, and successful receipt only after that cleanup and protocol
  acceptance. A successful receipt records only the narrow process claim of
  owned-group emptiness.
- `scripts/evaluation/bob-report-adapter.mjs` binds exactly one canonical Bob
  report in a closed artifact inventory and joins that metadata to the
  controller-hashed structured lane result. It does not read or parse report
  content, create a complete normalized case, open the sealed oracle, or
  score a result.
- `scripts/evaluation/browser-gateway.mjs` is the non-qualifying rendered-page
  boundary and the machine authority for its gateway-local policy, tool, and
  closure contracts. It exposes only phase-scoped observation and control-ID
  tools, drives a measured Chrome executable through its fixed CDP pipe,
  admits direct HTTP only to the declared numeric-loopback origin, enforces its
  GET/path allowlist through selected-page request interception, and routes
  other proxy-aware URL traffic to a deny-only loopback boundary. It retains
  bounded snapshots, screenshots, action receipts, proxy summaries, and a
  terminal hash-chained journal below `QA/evidence/`. A detached same-source
  Node supervisor owns the browser process group, launches Chrome in that
  group, passes the CDP descriptors directly, and watches a gateway-only
  liveness pipe. Gateway loss force-kills the group. Its temporary Chrome
  profile is never evidence. A normal closure requires the supervised browser
  group to be empty before removing the profile. Ambiguous or failed process
  cleanup retains the profile and makes the closure invalid. Platforms without
  POSIX process-group signaling fail before Chrome launch.
- Bob suite cases declare globally unique, role-neutral report surface and
  core-flow IDs from independent opaque tokens that cannot be derived from the
  earlier case disclosure. They remain controller-only until task execution,
  whose structured output must use exactly the selected IDs and bind every
  modeled task to its core flow, evidence pointers, and canonical report
  path/SHA-256 without prose inference.
- `scripts/evaluation/run-case.mjs` may prepare an exact single-case lane
  root and close its declared artifacts. Controller state must remain outside
  the lane root. Preparation and closure are always non-qualifying:
  `verification_status: "unverified"`, `qualification: "not-evidence"`, and
  `result: null`.

This narrow exception does not make these paths a source of distributed lane
behavior. Evaluation infrastructure must not redefine a contract owned by
`qa-suite/`, and it must not be mirrored into that tree. The release archives
contain only `qa-suite/`, so the maintainer-only paths are deliberately
excluded from `qa-suite.skill` and `qa-suite-source.zip`.

A closed input, artifact inventory, or structured lane-result adaptation does
not attest model-context,
filesystem, environment, or network isolation; does not attest a qualifying
lane execution or semantic fixture opacity; and does not prove that a real
host obeyed Bob's controller sequence. A controller-executed Bob protocol
transcript proves only that an injected adapter returned structurally valid
outputs across the required controller call order. A composer-built transcript
proves only validated structural dependencies and digest/event ordering, not
process chronology or method order. A completed host execution additionally
records supervised-target launch, bounded I/O, exit, request/response binding,
and controller-owned group emptiness. No such record proves filesystem,
provider, network, tool, model-context, escaped or hostile process-tree, or
hostile same-user isolation, report semantic parity, or state authentication.
Do not promote any record until a reviewed host and sandbox adapter proves
every missing claim.

The browser gateway proves only its narrow controller-owned browser actions
and retained receipts. It is not a sandbox or a Bob host, and it does not
attest model context, provider transport, same-user isolation, fixture
opacity, non-proxy UDP or direct-socket isolation, lane correctness, or report
semantics. Its closure must remain `unverified`, `not-evidence`, with
`result: null`. The measured Chrome launcher does not authenticate the rest of
the application bundle.

The host executor's support-file list is mandatory even when empty. Every
interpreter source, MCP server, schema, or static configuration consumed by a
real host must be declared there. Owner-writable controller files are allowed;
file hashing and identity checks detect ordinary drift but do not remove the
executor's explicit same-user and time-of-check/time-of-use limitations.
Its process-group check and controller-loss cleanup cover only ordinary
descendants that remain in the inherited group. They do not contain hostile
`setsid`, `setpgid`, or detached-session escape, resist hostile same-user or
PID interference, support Windows, attest a sandbox or
provider/state/model-context/network isolation, prove artifact existence, or
produce qualifying evidence.

Closed-artifact consumers must read the controller-owned captured snapshot,
never the mutable lane tree. Captured hashes and the unkeyed journal chain can
detect partial or accidental mutation, but read-only modes do not resist a
hostile same-user process; that protection belongs to a later qualifying
sandbox and provider adapter.

## Change workflow

Use one issue, one isolated branch, and one PR. Start from refreshed `main`.
Preserve unrelated work. Run `node --test` and the checks relevant to the
changed surface before pushing. Human review remains the merge gate unless the
owner explicitly says otherwise.

## Release artifact contract

The only published binary assets are:

- `qa-suite.skill`
- `qa-suite-source.zip`

Both names contain the same ZIP bytes. Each archive contains only the
`qa-suite/` tree from the exact release commit. Packaging must read the Git
object database, not the working tree. This excludes dirty and untracked files
by construction.

Supported channels intentionally differ:

| Channel | Delivered tree |
|---|---|
| Claude.ai | `qa-suite.skill`, containing only `qa-suite/` |
| Source download / local skill | `qa-suite-source.zip`, byte-identical to the `.skill` package |
| Claude Code | Tagged repository with `qa-suite/`, `.claude-plugin/`, `.claude/agents/`, and `.claude/commands/` |
| Codex | Tagged repository with `qa-suite/`, `.codex-plugin/`, and `.agents/plugins/marketplace.json` |

The release check validates every manifest-referenced path and the complete
shipped Claude agent/command sets. A channel path may not disappear or drift
without failing CI.

Run the local release integrity check with:

```sh
node scripts/release/check.mjs --ref HEAD
```

The check must:

1. validate version parity;
2. build twice in separate temporary directories;
3. require byte-identical results across both builds and both asset names;
4. extract both assets and compare them with `qa-suite/` at the same Git ref;
5. fail on missing, extra, stale, or renamed content.

Generated archives and evidence are ignored. Never commit them.

## Release procedure

Prepare a release PR that changes `VERSION`, all versioned plugin manifests,
and the README release notes. Do not edit `qa-suite/` in that PR.

Merging a `VERSION` change to `main` runs
`.github/workflows/draft-release.yml`. Separate least-privilege jobs:

1. validates the exact merged commit;
2. creates the matching annotated `v<version>` tag if it does not exist;
3. builds and attests both artifacts;
4. creates a draft GitHub Release with `gh release create --draft
   --verify-tag`;
5. checks the authenticated, paginated Releases API with `gh api` and selects
   the exact tag (the release-by-tag endpoint does not expose draft releases);
6. downloads the assets into a fresh directory with `gh release download`;
7. rechecks names, media types, digests, bytes, and archive/tree parity;
8. retains machine-readable evidence as a workflow artifact.

The workflow never uses `--clobber` and never publishes the draft. A retry may
upload a missing asset only after every existing asset matches the exact local
build. A mismatch or extra asset fails closed.

GitHub exposes draft releases only to tokens with write access to repository
contents. The draft-verification and pre-publication validation jobs therefore
declare `contents: write` even though those steps only query metadata and
download assets. Verification after publication remains read-only.

Immutable releases are required before publication. Enabling and confirming
this one-time repository setting is an owner-admin gate:

```sh
gh api --method PUT repos/slinky07/qa-suite/immutable-releases
gh api repos/slinky07/qa-suite/immutable-releases --jq .enabled
```

The authenticated owner must see `true` before dispatching the publication
workflow. A workflow `GITHUB_TOKEN` cannot read this administration endpoint,
so the workflow deliberately does not substitute a weaker or broader secret
for the owner-admin check.

After the draft workflow succeeds, inspect its logs and retained evidence:

```sh
gh run list --workflow draft-release.yml --limit 5
gh run view <run-id> --log
gh run download <run-id> \
  --name release-evidence-vX.Y.Z \
  --dir /tmp/qa-suite-release-evidence-vX.Y.Z
jq . /tmp/qa-suite-release-evidence-vX.Y.Z/release-evidence.json
```

Normally the draft workflow must succeed before publication. If it created the
exact draft and then failed only because of a release-automation defect, repair
the automation through a PR. The publication workflow must then run from the
repaired `main`, repeat all candidate checks, and retain replacement validation
evidence before it may publish.

Publish only through the verification workflow:

```sh
gh workflow run publish-release.yml -f tag=vX.Y.Z
gh run list --workflow publish-release.yml --limit 5
gh run watch <run-id>
gh release view vX.Y.Z
gh release verify vX.Y.Z
```

Then verify a fresh Codex installation:

```sh
codex plugin marketplace upgrade qa-suite
codex plugin remove qa-suite@qa-suite
codex plugin add qa-suite@qa-suite
codex plugin list --marketplace qa-suite
```

The publication workflow runs reviewed release automation from the dispatched
`main` commit while rebuilding the package only from the requested tag. This
allows a verifier defect to be repaired without moving a frozen release tag or
changing its payload. It rechecks the mutable draft immediately before
publication, publishes it, then rechecks the immutable release and provenance.
If a workflow run fails after GitHub has already published the release, rerun
it with the same tag. The recovery path accepts only the exact immutable
release, skips republication, and regenerates the retained evidence. If a tag
or release points at the wrong commit, stop. Do not move the tag, overwrite
assets, or publish. Fix the process through a new PR and obtain explicit owner
approval before deleting any remote release or tag.
