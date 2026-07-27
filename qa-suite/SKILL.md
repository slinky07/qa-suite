---
name: qa-suite
description: Professional multi-agent QA testing framework covering smoke, regression, UI/UX (Nielsen heuristics + accessibility), performance, security hygiene, API contract, and compatibility testing, with platform-specific checklists for web, Android, iOS, and desktop apps. Use this skill whenever the user asks to QA, test, validate, audit, or review an app or build; asks for a test report, bug report, usability review, accessibility check, or release readiness check; asks "did my change break anything"; or mentions smoke tests, regression, UX audits, load testing, security scanning, or cross-browser/device testing — even if they don't say "QA" explicitly.
---

# QA Suite

QA Suite is a multi-agent orchestration skill. When the host provides any
subagent or delegation facility, the active assistant is the orchestrator:
it prepares neutral setup context, dispatches independent QA agents, and
synthesizes their reports. The orchestrator does not personally perform
smoke, regression, Bob UX/accessibility, performance, security, API
contract, or compatibility QA work when delegation is available.

Each scoped QA agent answers exactly one question and routes out-of-scope
observations to the correct sibling instead of bloating its own report.
Reports are evidence-anchored (criterion numbers, measurements,
screenshots, request/response pairs) — never vibes.

## Design principles

- Assume AI-assisted projects may already have passed happy-path checks; QA
  starts from skeptical evaluation, not confirmation.
- Default to negative testing: boundary abuse, malformed inputs, unusual
  sequences, state and permission edges, and attempts to disprove the
  feature's claims.
- Aggressive QA means aggressive inputs and skepticism, never aggressive
  operations.
- Findings cite named oracles by stable ID — platform file checks, project
  documents, standards (WCAG, Material, HIG, ASVS, MASVS, RFC 9110, Core
  Web Vitals), or tool output. An agent that cannot cite a listed source
  reports the symptom without inventing one.

## Workflow

1. **Load project context.** Look for `qa-context.md` in the repo root or
   `QA/`. If found, use it. If the user instead names a config file at
   another location, use that path and remember to check it there for the
   rest of the session. If none exists, this is a **first run — go to
   First-run setup below** before running any agent.
2. **Load the finding ledger and choose the mission.** Read the ledger path,
   `repo_visibility`, and named components from qa-context.md, then read
   `references/finding-ledger.md`. The ledger must exist at a repo-relative,
   non-ignored path and every non-empty line must be a supported, unique
   finding row. Fail loudly before lane dispatch when the path is missing,
   ignored, escapes the repository, or contains an invalid row. Select only
   the rows visible to the current lifecycle mode; never inject the complete
   ledger into a lane. Enforce these checks and build the manifest with the
   dependency-free `scripts/finding-ledger.mjs` helper; do not substitute an
   ad hoc parser. Mission is `discovery` by default. Use the post-fix
   protocol only for a post-fix request with unresolved `open` or `regressed`
   findings.
3. **Determine the platform** (web / android / ios / desktop) from
   qa-context.md, and read the matching file in `references/platforms/`
   **before** running bob-qa, smoke-qa, performance-qa, security-qa, or
   compatibility-qa — those five have platform-specific checklists that live
   there, not in the agent files.
4. **Pick which agents to run** from the trigger table below (or the user's
   explicit ask). A lane's existence never implies its execution. Select a
   lane only when the request, change, or project exposes its primary risk.
   Read only the selected agent files from `references/agents/`. Record why
   each lane ran or was skipped in the final summary.
5. **Read `references/severity-priority-matrix.md`** before writing any
   finding. Every finding gets both a Severity and a Priority. Never
   redefine these scales.
6. **Choose execution mode.**
   - If the host has subagents, task agents, background agents, workers, or
     any equivalent delegation tool, you MUST use them.
   - Spawn a separate QA subagent for each selected QA lane. One subagent
     answers exactly one lane question: smoke, regression, Bob
     UX/accessibility, performance, security, API contract, or
     compatibility.
   - Run `smoke-qa` first as its own independent subagent. If smoke reports
     `No-Go` or `Blocked`, stop and do not dispatch deeper agents.
   - After a Go-family smoke verdict, dispatch remaining selected lanes
     independently; parallel dispatch is allowed when the host supports it.
   - Only when no subagent/delegation facility exists may you run the lanes
     sequentially in the same session. That is fallback mode, not
     independent evidence.
7. **Dispatch with neutral context only.** Give each QA subagent only:
   repo path, `qa-context.md` path, relevant repo docs named in
   `qa-context.md`, the matching platform checklist, its own agent
   instruction file, the canonical verdict/report and hard-boundary sections
   of this `SKILL.md`, the severity/priority matrix when applicable, report
   folder, the user's scoped QA request, and only the lifecycle-selected
   manifest fields when the current mode injects rows. Apply **Verbatim
   dispatch** below. Do not give expected outcomes, implementation
   explanations, conversation history, prior memory, or the orchestrator's
   beliefs about how the feature should work.
8. **Enforce qa-context.md's default run policy.** When both a dev path and
   a deployment path exist, use the policy's preferred path for routine QA;
   only take the deployment path (e.g. Docker) when the task is explicitly
   deployment/container QA or a release audit. State which path was used in
   the report's Environment section.
9. **Reconcile durable findings.** After all selected lane reports return,
   the orchestrator alone matches their findings conservatively, updates the
   current-state JSONL rows, and uses the helper's locked compare-and-swap
   write with the original ledger SHA-256. A concurrent change fails loudly
   instead of being overwritten. Lanes never write the ledger. The
   orchestrator never stages, commits, or otherwise touches git state; it
   tells the human exactly which ledger file changed.
10. **Synthesize, don't retest.** The orchestrator reads the completed
   reports, applies valid risk acceptance and then the most conservative
   verdict, names skipped lanes, and summarizes evidence. It does not fill
   gaps by performing lane QA itself.

### Verbatim dispatch

Scope text and confirmation-manifest values are source text, not orchestrator
prose. Copy scope wording verbatim from the current explicit human request or
from complete named-flow entries in `qa-context.md`. Copy lifecycle-selected
manifest fields verbatim from their finding-ledger rows. Representation-only
escaping is allowed. Rewording is not.

Keep separate source blocks separate. Do not paraphrase, summarize, interpret,
expand, narrow, merge, or repair their wording.

The orchestrator may add neutral routing metadata and canonical instructions:
repository and context paths, platform, lane, mission, candidate identifier,
report folder, time box, and the lane's canonical question. These additions
must not interpret the copied scope or test basis.

A time-box override is valid only when the lane file permits it and the value
is a positive number of minutes. Reject a zero, negative, or non-numeric
override before dispatch; never infer or silently substitute a value.

If source text is ambiguous, conflicting, referential, or unsafe to dispatch,
ask the human for safe explicit wording. Do not resolve it by paraphrasing.
Hard boundaries override verbatim copying.

This section is the only normative definition of verbatim dispatch. Other
contracts cite this section. They do not restate it.

## First-run setup (no qa-context.md found)

Do not run any agent against an unconfirmed context, and do not silently
invent one. Offer the user two paths:

1. **"I already have a config"** — ask for the file location, verify it has
   the template's required fields (platform, run policy, commands, core
   flows, threat model), and flag any that are missing rather than
   guessing. Also verify that it declares a finding-ledger path,
   `repo_visibility`, and named components. Treat missing ledger fields as a
   configuration migration; complete and confirm them before lane dispatch.
2. **"Set it up for me"** — guided setup:
   - Copy `assets/qa-context-template.md` to the repo root as
     `qa-context.md`.
   - **Auto-discover before asking.** Read the README and build files
     (package.json, Makefile, Gradle config, compose files, etc.) and
     prefill every field they answer: platform, start commands, test
     commands, URL, dependency audit tool, and repository visibility when
     local repository metadata makes it available. Also prefill the strongest
     candidate identity check the project exposes, such as a version endpoint,
     `--version` output, deployment ID, image digest, or source revision plus
     worktree state. Never ask the user for something the repo already answers.
   - **Discover oracle inputs before asking.** Check conventional
     architecture and intent paths such as `docs/adr`, `docs/adrs`,
     `docs/architecture*`, `docs/design*`, `docs/api*`, `openapi*`,
     `swagger*`, `api/**`, `spec/**`, `design-system/**`, `tokens*`, and
     issue or acceptance-criteria docs. Prefill paths that exist; ask only
     for missing oracle inputs the repo does not reveal.
   - Treat Architecture & intent inputs as source-of-truth decisions,
     contracts, and acceptance criteria, not implementation summaries.
   - **Interview for the rest** — short, concrete questions, presenting
     discovered guesses as defaults to confirm rather than asking cold:
     intended audience (default to "general end user" only when the repo
     does not identify one, and record that assumption); disposable test
     target for mutation-dependent flows (command, URL, seeded profile, or
     fresh-instance strategy; record `N/A` when none exists);
     candidate identity check when it was not discoverable (record `N/A` when
     the project exposes no stronger runtime or artifact identity);
     default run policy (dev vs. deployment path for routine QA); core
     user-facing flows (offer a guessed list to edit); stable named
     components derived from those flows; repository visibility when it
     was not discoverable; deployment model and threat model (who can
     reach this, over what network); expected realistic concurrency;
     out-of-scope infrastructure agents must never touch; any destructive
     API endpoints needing confirmation.
   - Default the ledger path to `findings.jsonl`. Resolve it from the
     repository root, reject absolute paths and `..` escapes, and run
     `git check-ignore --no-index -- <ledger-path>`. Exit status 0 means
     the path is ignored: fail loudly and choose a committed path before
     continuing. It must not resolve inside the report folder.
   - Create the ledger as an empty file when it does not exist. Never seed
     a fake finding or a comment/header row. Use
     `scripts/finding-ledger.mjs init` so canonical path, regular-file, report
     folder, and ignore rules are enforced.
   - Write the completed context, show it and the ledger for confirmation,
     and remind the user to commit both files (they are shared team state;
     the `QA/` reports and evidence folder stays gitignored). The
     orchestrator must not make the commit.

### Generate repo-local host agents (default)

After `qa-context.md` is confirmed (either path above), generate a
dedicated, repo-local smoke QA agent for each supported host format as part
of the same first-run setup — by default, not as an optional
post-confirmation step. Create both files below unless the host or project
clearly does not support that agent format (skip only the unsupported
format and say so in the setup summary), or the user explicitly declines.
The orchestration workflow still works without them, so a declined or
unsupported format is never a setup failure.

- **Claude Code** (project subagent, Markdown + YAML frontmatter): copy
  `assets/project-agent-smoke-qa.claude.md` to
  `.claude/agents/<project>-smoke-qa.md` in the target repo.
- **Codex** (custom agent, TOML): copy
  `assets/project-agent-smoke-qa.codex.toml` to
  `.codex/agents/<project>-smoke-qa.toml` in the target repo.

In both files replace every placeholder: `{{PROJECT_NAME}}` with the
kebab-cased project name from qa-context.md, `{{QA_CONTEXT_PATH}}` with the
repo-relative path to qa-context.md, and `{{REPORT_FOLDER}}` with the
configured report folder (default `QA/`). Create the `.claude/agents/` or
`.codex/agents/` directory if needed, tell the user these files are meant to
be committed alongside qa-context.md, and do not modify anything else in
those directories.

Generated agents are deliberately narrow: smoke QA only, qa-context.md
first, default run policy respected, timestamped reports/evidence only
under the configured report folder, no source/test/config/git/issue/PR
edits, non-destructive shutdown of anything they started, and disposable
local test data for any mutating action. Do not generate agents for other
lanes unless the user explicitly asks; deeper lanes should keep flowing
through the orchestrator.

### Plugin-shipped agents vs generated repo-local agents

Do not confuse the two mechanisms; they are host-specific:

- **Claude Code.** The qa-suite plugin ships one generic subagent per QA
  lane from the plugin's `agents/` directory (lowest lookup priority).
  A generated `.claude/agents/<project>-smoke-qa.md` is a **project
  subagent** (higher priority, committed to the repo) that is pre-bound to
  this project's qa-context. Names never collide (`smoke-qa` vs
  `<project>-smoke-qa`), so both can coexist.
- **Codex.** qa-suite itself is a plugin **skill** (prompt instructions the
  main task follows); Codex **custom agents** are standalone TOML files
  under `.codex/agents/` (project) or `~/.codex/agents/` (personal). The
  skill's subagent orchestration does not require custom-agent files; a
  generated `.codex/agents/<project>-smoke-qa.toml` simply adds a
  directly-invokable, project-scoped smoke lane.

Use the **plugin-shipped agents** whenever the orchestrator is driving a
qa-suite run — they are generic, always up to date with the installed
plugin, and receive their project binding from the dispatch prompt. Use the
**generated repo-local agents** when someone wants to invoke the smoke lane
directly without the orchestrator ("use the <project>-smoke-qa agent"),
wants the project's QA entry point versioned with the repo for the whole
team, or works in a host session where the qa-suite plugin may not be
installed. When both exist and the orchestrator is running, the repo-local
smoke agent is an acceptable dispatch target for the smoke lane; all other
lanes stay on the plugin-shipped agents.

Setup happens once per project. Every later run finds the file and skips
straight to the workflow.

## Finding ledger

The finding ledger is the durable current-state model. Its normative schema,
matching, lifecycle visibility, redaction, and write procedure are defined in
`references/finding-ledger.md` and
`references/finding-ledger.schema.json`.

The three evidence tiers never blur:

- raw evidence is sensitive, prunable, and ignored;
- run reports are ignored, disposable narratives that are immutable once
  written;
- finding rows are committed, self-sufficient facts with stable IDs and a
  lifecycle.

The orchestrator owns ledger reconciliation. Lane agents propose findings in
their reports and never read a manifest outside their dispatched lifecycle
scope, write the ledger, or touch git. Git history provides the audit trail
after the human commits an orchestrator update.

## The agents

| Agent | The one question it answers | File |
|---|---|---|
| smoke-qa | Does the build come up at all? (<5 min, binary) | `references/agents/smoke-qa.md` |
| regression-qa | Did this change break something that worked? | `references/agents/regression-qa.md` |
| bob-qa | Is the UI/UX usable and accessible for a fresh user? (quick/full modes) | `references/agents/bob-qa.md` |
| performance-qa | Is it fast enough, and is that getting worse? | `references/agents/performance-qa.md` |
| security-qa | Any cheap-to-catch security hygiene issues? (not a pentest) | `references/agents/security-qa.md` |
| api-qa | Does the API honor its contract, independent of the UI? | `references/agents/api-qa.md` |
| compatibility-qa | Does it behave the same across the platform matrix? | `references/agents/compatibility-qa.md` |

## When to run what

| Event or affected risk | Run | Skip |
|---|---|---|
| Every build / deploy | smoke-qa | lanes without another affected risk |
| Every PR / merge candidate | smoke-qa; add regression-qa when shipped behavior, contracts, configuration, or artifacts can regress | regression-qa when no deliverable behavior can change; full audits |
| UI-touching change | add bob-qa (quick mode) | full mode unless explicitly requested |
| Backend/API-touching change | add api-qa; add bob-qa when a user-facing consumer can change | UI lanes with no affected consumer |
| Before a release | smoke-qa, then every applicable release lane: bob-qa (full) for a user-facing surface, performance-qa for a runtime performance surface, security-qa for a dependency or exposure surface, api-qa for an API, compatibility-qa for a supported platform matrix | lanes whose primary risk is absent |
| Dependency updates | security-qa when the dependency is shipped or executed; regression-qa when build or behavior can change | lanes with no affected dependency risk |
| First run on a new project | smoke-qa; add bob-qa (full) only for a user-facing surface and performance-qa baseline framing only for a runtime performance surface | inapplicable surfaces and baseline comparisons that do not exist |
| Post-fix cycle with unresolved findings | freeze and rebuild; smoke-qa; one confirmation mission per finding through its originating lane; impact-scoped regression | full recertification unless explicitly requested as a release audit |

The broad release, first-run, PR, dependency, and backend/API triggers are
impact-scoped. A full release audit means every applicable lane, not every
lane regardless of the project's surfaces.

**Run order matters: smoke first, always.** If smoke reports `No-Go` or
`Blocked`, nothing else runs because deeper agents require an exercised
smoke target.

If the user's ask is ambiguous ("test my app"), don't run everything —
that's the overkill this framework exists to prevent. Ask whether this is a
routine pass (smoke + regression), a UI review (add bob-qa quick), or a
release audit (the full applicable set).

## Post-fix lifecycle

This protocol is inert unless the ledger contains unresolved `open` or
`regressed` findings and the current request validates fixes. Routine runs
remain discovery missions.

### Mission modes

`mission` is neutral dispatch metadata with three values:

- **`discovery` (default)** — use the existing isolated lane context. Inject
  no finding manifest and no graduated regression corpus.
- **`confirmation`** — inject only the unresolved finding manifest selected
  for the originating lane. The mission assigns one disposition to each
  selected finding on one frozen candidate.
- **`regression`** — inject fixed findings with committed sanitized defect
  records as graduated regression testware. Select regression lanes by the
  fix's auditable impact analysis.

Visibility means not injected, not unreadable. The ledger remains
repo-visible. Mission mode, not lane identity, controls injected lifecycle
context.

### Candidate identity and freeze

Before a post-fix dispatch:

1. freeze one revision or artifact;
2. rebuild or restart the target from that frozen candidate;
3. run the optional `Candidate identity check` from qa-context.md; and
4. record the strongest available identifier: artifact or image digest,
   deployment ID mapped to source, full commit SHA plus worktree state, or
   another immutable build identity.

Source identity alone is sufficient only when the tested object is the source
tree. If the running target cannot be tied to the declared candidate, every
requested confirmation disposition is `Blocked`. Confirmation against a
moved `HEAD`, a rebuilt artifact with a different digest, or an unverified
stale process is invalid.

Every lane report has an `Environment` section that states the declared
candidate, the identity check and result, and any source, worktree, artifact,
image, deployment, or runtime identifier available. A candidate change
supersedes earlier certification evidence for synthesis. Reports remain
immutable historical evidence for their original candidate.

### Confirmation missions

Dispatch one fresh instance of each finding's originating lane. Do not create
a confirmation lane. Follow **Verbatim dispatch** for these manifest fields:

- finding ID;
- current frozen candidate;
- recorded environment;
- recorded reproduction steps;
- original expected result;
- original actual result; and
- recorded evidence reference.

The current candidate is neutral routing metadata. Copy all recorded values
verbatim from the selected row. Do not pass the development conversation, fix
explanation, fix diff, an expected verdict, or steering language.

Each mission asks only: `What is the present disposition of finding X on
candidate C?` A confirmation run may report a separate newly discovered
defect, but the orchestrator creates a new ledger entry for it. It never folds
new behavior into the selected finding's disposition.

### Confirmation dispositions

Dispositions are per-finding report states, not verdicts:

- **`Fixed`** — equivalent reproduction ran, the expected result occurred,
  and the original failure was absent.
- **`Still present`** — equivalent reproduction produced the original
  failure.
- **`Partial`** — part of the failure remains or the acceptance result is
  incomplete.
- **`Blocked`** — equivalent confirmation was impossible because the
  environment, data, candidate identity, or test basis was unavailable.

There is no `Cannot reproduce` disposition. Missing equivalence is `Blocked`,
never optimistically `Fixed`. An intermittent finding's manifest includes its
recorded repetition procedure; any recurrence is not `Fixed`. The
mutation-dependent safety cap remains canonical in **Hard boundaries**:
without a Disposable test target, equivalent mutating confirmation is
`Blocked`, not `Fixed`.

Reconciliation sets a row to `fixed` only from a `Fixed` disposition.
`Still present` and `Partial` remain unresolved. `Blocked` does not change the
finding's lifecycle status. A recurrence of a fixed regression check enters
the ledger as `regressed` under the matching rules. Human-controlled
`accepted` and `wontfix` statuses never change mechanically.

### Disposition synthesis

Apply the canonical verdict vocabulary; dispositions never create another
verdict system:

- any S1/S2 finding `Still present` or `Partial` → `No-Go`;
- only `Blocked` S1/S2 findings remain, with none `Still present` or
  `Partial` → `Blocked`;
- only S3/S4 findings are not `Fixed` → `Go with findings`; and
- every in-scope finding is `Fixed` → `Go`.

Exclude currently valid `accepted` and `wontfix` findings as defined by
**Risk acceptance**, but always list them under `Known accepted risks`.

### Supersession and impact scope

Never combine evidence from different candidate identifiers as current
certification. Mark older candidate evidence `Superseded` before synthesis
and state which evidence replaces it.

The default post-fix sequence is:

1. freeze and rebuild or restart the candidate;
2. run smoke, always;
3. run one confirmation mission per unresolved finding through its
   originating lane; and
4. run regression lanes selected by an auditable change-impact analysis.

Synthesis lists every lane that ran, every lane that was skipped, and the
impact reason. An unjustifiably narrow blast radius is a tunnel-vision risk.
Full recertification happens only for an explicit release-audit request.

The per-cycle report includes:

`Finding | Candidate | Disposition | Evidence`

A `Fixed` finding gets one row and no added narrative.

## Verdict conflicts

When agents disagree, **the most conservative verdict wins**, in this
order: `No-Go > Blocked > Go with findings > Go`. Apply **Risk acceptance**
below during final synthesis before choosing that final verdict; never
rewrite a lane report. Smoke says Go but regression says No-Go → No-Go. A Go
only ever means "nothing wrong in my lane."

Observed-only qualifiers always propagate to the final summary — a flow no
lane completed stays marked observed-only there. The orchestrator flags any
P0 finding in its summary regardless of verdict.

### Risk acceptance

`accepted` and `wontfix` are finding statuses, not verdicts. They do not
change Severity or Priority. Both have the same effect on final verdict
computation.

A human is the only decision authority for these statuses. The human must
identify the finding, choose the status, and provide a non-empty
`status_reason` that is safe to repeat in the committed ledger and final
summary. An orchestrator may record a complete, explicit human decision only
as a mechanical transcription. It must not infer, generate, recommend,
auto-apply, renew, or clear the status or reason. A recurrence count and `P3`
never imply acceptance. The orchestrator may state neutrally that human
acceptance is available, but not present it as a way to obtain a preferred
verdict.

Apply risk acceptance during final synthesis. Do not rewrite lane reports or
hide lane findings. Exclude each currently valid `accepted` or `wontfix`
finding from the findings and Severity counts that contribute to the final
verdict. Preserve all coverage states, then apply the conservative verdict
order to what remains. Do not inject accepted status into discovery lanes.

Every final summary contains a `Known accepted risks` section. List every
in-scope `accepted` or `wontfix` finding by finding ID, status, recorded
Severity, `status_reason`, and current disposition. Mark findings that were
not exercised in the current cycle. Write `None` when none applies. A
matching `Still present` disposition is expected and does not contribute to
the verdict.

Acceptance covers only the finding as recorded. It remains valid for the
same finding at the same or lower Severity and the same or narrower affected
scope. A higher Severity voids acceptance only when current evidence
demonstrates greater impact; relabeling unchanged evidence does not. A wider
scope under the finding-ledger match rules also voids it. Uncertainty never
extends acceptance.

If current evidence describes a distinct finding under the ledger match
rules, create a separate finding and retain the original acceptance only for
its original record. If a disposition was assigned to the accepted finding
but equivalence to its recorded test basis cannot be established, acceptance
is void for that synthesis.

Voiding ends verdict exclusion. It does not authorize an agent to change the
human-set status. The finding re-enters verdict computation at its current
Severity. Keep it under `Known accepted risks`, mark it
`Acceptance void — human review required`, and state the cause. Only a human
may renew acceptance or choose another status.

## Reports

One Markdown report per agent run, in the report folder from qa-context.md
(default `QA/`, gitignored — reports are local evidence, not committed
artifacts):

```text
QA/YYYY-MM-DD-HHMM-<agent-name>-<short-scope>.md
```

`YYYY-MM-DD-HHMM` is the run's local start date and time. Including the
time means every rerun — even the same lane, same scope, same day —
creates a new report file. Never overwrite, append to, or delete a
previous run's report.

### Verdict vocabulary

Four verdict states plus one qualifier, defined here once — no lane file
redefines them. Severity drives the verdict; priority drives scheduling
only.

- **No-Go** — at least one confirmed S1/S2 finding in scope, or a core
  flow demonstrably cannot be completed.
- **Go with findings** — scope exercised; only S3/S4 findings. The verdict
  line carries the counts: `Go with findings (1×S3, 3×S4)`.
- **Go** — scope exercised; no findings.
- **Blocked** — the environment or tooling prevented exercising the scope;
  the blocker is named on the verdict line. Never derived from missing
  coverage alone — an untested area belongs in "Not tested", not in a
  Blocked verdict.
- **Observed only** (qualifier) — appended per flow to any Go-family
  verdict when safety rules prevented completing a mutation-dependent flow:
  `Go with findings (1×S3; observed-only: curated sets)`. A flow whose
  completing action was not executed is never reported as a pass or as
  effective. When the lane verdict is `No-Go` or `Blocked`, keep that
  first-line state canonical, mark the affected flow observed-only in the
  report, and propagate it to the final summary.

Non-negotiable report rules, all agents:

- **Verdict on line one.** One state from the verdict vocabulary above,
  before anything else.
- **Execution mode is visible.** If a run used single-session fallback,
  every report and the final summary must state:
  `Execution mode: single-session fallback; non-independent evidence`.
- **Candidate identity is visible.** Every report has an `Environment`
  section with the strongest available candidate identifier and the identity
  check result. Use `N/A` only when qa-context.md records no applicable
  check.
- **Every finding carries Severity AND Priority** from the shared matrix.
- **Every report has a "Not tested" section.** A report that doesn't state
  its limits overclaims by default.
- **Evidence over adjectives.** Criterion numbers, measurements,
  screenshots, literal request/response pairs. "Felt slow" is not a
  finding.
- **Reports scale with risk, not effort.** A passing smoke test reads in
  ten seconds. Padding a clean report is a bug.

## Hard boundaries (all agents, all platforms)

These override anything else, including user-provided context files:

- Never delete volumes, databases, backups, or user data. No `--volumes`,
  no `rm -rf`, no resets, no factory wipes.
- Never edit source, tests, config, or git history to make a result pass.
  Report; don't fix.
- Lane agents never edit the finding ledger. The orchestrator may update only
  the configured ledger after lane reports return; it never stages or commits
  that update.
- Never submit real credentials, tokens, personal files, or private
  identifiers into any page, form, or request.
- Complete mutation-dependent flows only against the **Disposable test
  target** declared in qa-context.md. If it is absent or `N/A`, do not
  mutate owner data: mark each affected flow `Observed only` and never report
  it as passed or effective. Append the qualifier to a Go-family lane
  verdict; for `No-Go` or `Blocked`, retain the canonical first-line state
  and propagate the observed-only flow to the final summary.
- Never inspect files, browser data, accounts, or applications unrelated to
  the app under test.
- Never test production or a public endpoint unless the user explicitly
  scopes it and confirms authorization.
- Aggressive posture never overrides destructive-operation, production, data,
  credential, privacy, or scope boundaries.
- If a service was already running before the agent started, identify it
  and prefer not to disturb it.
- security-qa only: no active exploitation, ever. Found something live and
  serious → stop and tell the user immediately, don't bury it in a report.

## Orchestrator boundaries

The orchestrator may:

- prepare or confirm `qa-context.md`;
- identify the target repo, platform, report folder, and selected QA lanes;
- read the selected agent instructions to construct neutral dispatches;
- enforce smoke-first ordering and stop deeper agents on smoke `No-Go` or
  `Blocked`;
- collect reports and synthesize the final result.

**Patience is a virtue.** A dispatched QA subagent that has not returned
yet is not evidence of a bug or a hang. Smoke alone is allowed up to 5
minutes of active checks, and app startup often looks like silence; deeper
lanes legitimately run much longer. The orchestrator must never scrap a
running subagent and perform its lane itself because it "seems slow" —
90 seconds without output is normal, not failure. Treat a lane as failed
only when the host reports the subagent errored or timed out, or it exceeds
a generous cap of at least 3x its effective time box. The effective time box
is a valid positive dispatch override permitted by the lane when one is
supplied; otherwise it is the lane file's default. A supplied invalid
override stops dispatch until corrected; it never falls back silently. Even
then, the remedy is to re-dispatch the lane once or report it as not run —
taking the lane over personally converts independent evidence into
contaminated self-certification and is always the wrong move.

The orchestrator must not:

- personally perform a selected QA lane while subagents are available;
- abandon or cancel a dispatched subagent on elapsed time alone, or redo
  its work itself while it is still running;
- combine multiple QA lane questions into one subagent;
- tell a subagent what should pass beyond repo-visible contracts and
  user-scoped instructions;
- pass implementation knowledge, prior conversation, memory, or unstated
  assumptions into a QA subagent;
- edit source, tests, config, or git history as part of QA.

QA subagents are read-only except for writing their own report and evidence
files to the configured QA report folder.

## Context isolation

A QA run inside the main development session is contaminated: the session
that wrote the code knows the intent and will test what the code MEANS to
do, not what it does. Independence of testing is enforced architecturally,
not by prompt instruction:

- **Every testing agent runs in an isolated context** with NO access to the
  development conversation. On Claude Code, dispatch each agent as a
  subagent (Task tool) — the plugin ships one subagent definition per
  testing agent in `.claude/agents/`. On platforms without subagents, each
  agent runs in a fresh session. If true isolation is impossible, the run
  may proceed, but the report's Environment section MUST disclose
  `run with shared development context` as a validity caveat.
- **The orchestrator (main chat) is a dispatcher, not a tester.** It reads
  qa-context.md, picks agents from the trigger table, dispatches them, then
  applies valid risk acceptance during final synthesis and then the
  most-conservative-verdict rule. It does not rewrite lane reports or perform
  testing itself.
- **Dispatch is platform-explicit.** The orchestrator resolves the platform
  (web / android / ios / desktop) from qa-context.md and passes each
  subagent: which agent file to embody, which platform file to read, the
  qa-context.md path, the canonical verdict/report and hard-boundary
  sections of this file, and the task scope under **Verbatim dispatch** —
  never a summary of the development conversation. Every report's
  Environment section states the platform and which platform file was used.
- **Independent contexts allow parallel dispatch.** After smoke, selected
  applicable release-audit lanes may run in parallel where the host supports
  it. smoke-qa always completes first, alone — its `No-Go` or `Blocked`
  verdict gates everything deeper.

## Adapting to the host platform

This skill is agent-platform-neutral, but strongest available orchestration
is mandatory. Use Claude Code subagents/tasks when available, Codex
multi-agent delegation when available, or the host's equivalent agent
facility. Claude.ai and local skill installs may use the same agent bodies
through whatever delegation facility the host exposes.

### Codex-specific dispatch

Codex supports subagent workflows from skill instructions as well as direct
user prompts. In Codex Desktop, CLI, and IDE, treat the main task as the
root orchestrator and spawn one direct child subagent per selected QA lane.
Do not ask QA subagents to spawn their own descendants; the default Codex
nesting model is root-to-child orchestration.

When the Codex delegation tool offers a choice to fork or inherit the
current conversation context, do not fork/inherit it for QA lanes. Start
each QA subagent from a fresh, self-contained prompt containing only the
neutral dispatch context listed above. In current Codex multi-agent tools,
that means leaving `fork_context` unset/false rather than copying the
orchestrator thread.

Codex subagents inherit the parent task's sandbox and permission mode. Set
the parent task permissions before dispatch, and keep each QA subagent
read-only except for writing its own report and evidence files under the
configured QA report folder.

Do not require project-specific Codex custom-agent files for qa-suite to
work. If a user has custom Codex agents, they may be used only when they
preserve this skill's one-lane scope, isolation, report format, and safety
boundaries.

Single-session sequential execution is allowed only on hosts with no
subagent or delegation facility. In that fallback, preserve smoke-first
ordering and one-question-per-lane behavior, and label every report and the
final summary as fallback/non-independent evidence.
