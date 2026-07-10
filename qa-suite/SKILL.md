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

## Workflow

1. **Load project context.** Look for `qa-context.md` in the repo root or
   `QA/`. If found, use it. If the user instead names a config file at
   another location, use that path and remember to check it there for the
   rest of the session. If none exists, this is a **first run — go to
   First-run setup below** before running any agent.
2. **Determine the platform** (web / android / ios / desktop) from
   qa-context.md, and read the matching file in `references/platforms/`
   **before** running bob-qa, smoke-qa, performance-qa, security-qa, or
   compatibility-qa — those five have platform-specific checklists that live
   there, not in the agent files.
3. **Pick which agents to run** from the trigger table below (or the user's
   explicit ask). Read only the agent files you're actually running, from
   `references/agents/`.
4. **Read `references/severity-priority-matrix.md`** before writing any
   finding. Every finding gets both a Severity and a Priority. Never
   redefine these scales.
5. **Choose execution mode.**
   - If the host has subagents, task agents, background agents, workers, or
     any equivalent delegation tool, you MUST use them.
   - Spawn a separate QA subagent for each selected QA lane. One subagent
     answers exactly one lane question: smoke, regression, Bob
     UX/accessibility, performance, security, API contract, or
     compatibility.
   - Run `smoke-qa` first as its own independent subagent. If smoke reports
     No-Go, stop and do not dispatch deeper agents.
   - After smoke is Go, dispatch remaining selected lanes independently;
     parallel dispatch is allowed when the host supports it.
   - Only when no subagent/delegation facility exists may you run the lanes
     sequentially in the same session. That is fallback mode, not
     independent evidence.
6. **Dispatch with neutral context only.** Give each QA subagent only:
   repo path, `qa-context.md` path, relevant repo docs named in
   `qa-context.md`, the matching platform checklist, its own agent
   instruction file, the severity/priority matrix when applicable, report
   folder, and the user's scoped QA request. Do not give expected outcomes,
   implementation explanations, conversation history, prior memory, or the
   orchestrator's beliefs about how the feature should work.
7. **Enforce qa-context.md's default run policy.** When both a dev path and
   a deployment path exist, use the policy's preferred path for routine QA;
   only take the deployment path (e.g. Docker) when the task is explicitly
   deployment/container QA or a release audit. State which path was used in
   the report's Environment section.
8. **Synthesize, don't retest.** The orchestrator reads the completed
   reports, applies the most conservative verdict, names skipped lanes, and
   summarizes evidence. It does not fill gaps by performing lane QA itself.

## First-run setup (no qa-context.md found)

Do not run any agent against an unconfirmed context, and do not silently
invent one. Offer the user two paths:

1. **"I already have a config"** — ask for the file location, verify it has
   the template's required fields (platform, run policy, commands, core
   flows, threat model), and flag any that are missing rather than
   guessing.
2. **"Set it up for me"** — guided setup:
   - Copy `assets/qa-context-template.md` to the repo root as
     `qa-context.md`.
   - **Auto-discover before asking.** Read the README and build files
     (package.json, Makefile, Gradle config, compose files, etc.) and
     prefill every field they answer: platform, start commands, test
     commands, URL, dependency audit tool. Never ask the user for
     something the repo already answers.
   - **Interview for the rest** — short, concrete questions, presenting
     discovered guesses as defaults to confirm rather than asking cold:
     default run policy (dev vs. deployment path for routine QA); core
     user-facing flows (offer a guessed list to edit); deployment model
     and threat model (who can reach this, over what network); expected
     realistic concurrency; out-of-scope infrastructure agents must never
     touch; any destructive API endpoints needing confirmation.
   - Write the completed file, show it for confirmation, and remind the
     user to commit it (config is shared with the team; the `QA/` reports
     folder stays gitignored).

Setup happens once per project. Every later run finds the file and skips
straight to the workflow.

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

| Event | Run | Skip |
|---|---|---|
| Every build / deploy | smoke-qa | everything else |
| Every PR / merge candidate | smoke-qa → regression-qa | full audits |
| UI-touching change | + bob-qa (quick mode) | full mode |
| Backend/API-touching change | + api-qa | UI agents |
| Before a release | bob-qa (full) + performance-qa + security-qa + compatibility-qa | — |
| Dependency updates | regression-qa + security-qa (dependency scan) | — |
| First run on a new project | smoke-qa → bob-qa (full) + performance-qa (baseline framing) | comparisons against baselines that don't exist |

**Run order matters: smoke first, always.** If smoke says No-Go, nothing
else runs — every other agent assumes a running app.

If the user's ask is ambiguous ("test my app"), don't run everything —
that's the overkill this framework exists to prevent. Ask whether this is a
routine pass (smoke + regression), a UI review (add bob-qa quick), or a
release audit (the full set).

## Verdict conflicts

When agents disagree, **the most conservative verdict wins.** Smoke says Go
but regression says No-Go → No-Go. A Go only ever means "nothing wrong in
my lane."

## Reports

One Markdown report per agent run, in the report folder from qa-context.md
(default `QA/`, gitignored — reports are local evidence, not committed
artifacts):

```text
QA/YYYY-MM-DD-<agent-name>-<short-scope>.md
```

Non-negotiable report rules, all agents:

- **Verdict on line one.** Go / No-Go / a one-line state, before anything
  else.
- **Execution mode is visible.** If a run used single-session fallback,
  every report and the final summary must state:
  `Execution mode: single-session fallback; non-independent evidence`.
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
- Never submit real credentials, tokens, personal files, or private
  identifiers into any page, form, or request.
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
- enforce smoke-first ordering and stop deeper agents on smoke No-Go;
- collect reports and synthesize the final result.

The orchestrator must not:

- personally perform a selected QA lane while subagents are available;
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
  applies the most-conservative-verdict rule across their reports. It never
  performs testing itself.
- **Dispatch is platform-explicit.** The orchestrator resolves the platform
  (web / android / ios / desktop) from qa-context.md and passes each
  subagent: which agent file to embody, which platform file to read, the
  qa-context.md path, and the task scope — never a summary of the
  development conversation. Every report's Environment section states the
  platform and which platform file was used.
- **Independent contexts allow parallel dispatch.** The release-audit path
  runs bob-qa (full) + performance-qa + security-qa + compatibility-qa in
  parallel where the host supports it. smoke-qa always completes first,
  alone — its No-Go gates everything.

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
