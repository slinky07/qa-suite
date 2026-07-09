---
name: qa-suite
description: Professional multi-agent QA testing framework covering smoke, regression, UI/UX (Nielsen heuristics + accessibility), performance, security hygiene, API contract, and compatibility testing, with platform-specific checklists for web, Android, iOS, and desktop apps. Use this skill whenever the user asks to QA, test, validate, audit, or review an app or build; asks for a test report, bug report, usability review, accessibility check, or release readiness check; asks "did my change break anything"; or mentions smoke tests, regression, UX audits, load testing, security scanning, or cross-browser/device testing — even if they don't say "QA" explicitly.
---

# QA Suite

A set of scoped QA agents, one per testing type. Each agent answers exactly
one question and routes out-of-scope observations to the correct sibling
instead of bloating its own report. Reports are evidence-anchored (criterion
numbers, measurements, screenshots, request/response pairs) — never vibes.

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
5. **Run agents in order** (smoke always first), write one report per agent
   to the report folder defined in qa-context.md, verdict on line one.
6. **Start the app via qa-context.md's default run policy.** When both a
   dev path and a deployment path exist, use the policy's preferred path
   for routine QA; only take the deployment path (e.g. Docker) when the
   task is explicitly deployment/container QA or a release audit. State
   which path was used in the report's Environment section.

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
- If a service was already running before the agent started, identify it
  and prefer not to disturb it.
- security-qa only: no active exploitation, ever. Found something live and
  serious → stop and tell the user immediately, don't bury it in a report.

## Adapting to the host platform

This skill is agent-platform-neutral. On Claude Code, the agent files can
alternatively be installed as subagents (`.claude/agents/`) and dispatched
in parallel; on a single-session platform, run them sequentially in the
order above. The agent bodies don't change — only how they're invoked.
