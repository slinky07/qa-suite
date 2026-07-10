In real QA, testers are not always developers, and that is intentional. A good tester looks at what the software actually does, not what the person who built it expects it to do. QA-Suite follows the same principle for agent-based testing: each QA run is isolated from the development conversation. Independence of testing, as formal QA calls it (ISTQB).

# qa-suite

A structured multi-agent QA framework for AI coding assistants.

QA-Suite is a reusable, AI-powered, multi-agent QA framework built on established software quality assurance principles and modern AI workflows. It orchestrates specialized QA agents to deliver structured, evidence-based software validation, adapting from focused change verification to comprehensive release readiness assessments.

It gives Claude Code, Claude.ai, and Codex a shared QA workflow with:

* scoped agents
* one question per agent
* evidence-based findings
* Severity and Priority on every issue
* a verdict on the first line
* a required **Not tested** section
* platform checklists for web, Android, iOS, and desktop

## Install Once Per Agent Platform

Install qa-suite once in your agent platform. Do **not** copy it into every project you test.

| Platform | Install |
|---|---|
| Claude Code | Add this repo as a plugin marketplace with `/plugin marketplace add slinky07/qa-suite`, then install `qa-suite` with `/plugin install qa-suite@qa-suite`. For local-only use, copying `qa-suite/` into `~/.claude/skills/` also works. |
| Claude.ai | Download `qa-suite.skill` from this repository's Releases page and upload it as a skill. |
| Codex | Add the marketplace with `codex plugin marketplace add slinky07/qa-suite`, install the plugin with `codex plugin add qa-suite@qa-suite`, and verify the installation with `codex plugin list | rg qa-suite`. Once installed, the plugin is available in both Codex CLI and Codex Desktop. If command codex is not found, install codex-cli: https://learn.chatgpt.com/docs/codex/cli  |
| Codex local skill fallback | Copy `qa-suite/` into `$HOME/.agents/skills/qa-suite` if you want the skill without using the plugin marketplace. |

The Claude Code plugin also includes thin slash commands for smoke, regression, and release QA paths.

## Configure Once Per Project

qa-suite sets itself up the first time it sees a project.

It looks for `qa-context.md` in the project root or in `QA/`. If it does not find one, it will not make one up quietly.

On first run it:

1. Auto-discovers what it can from README files, build files, package manifests, Makefiles, compose files, Gradle config, and similar repository sources.
2. Asks for the missing pieces: default run policy, core user flows, deployment model, threat model, expected concurrency, out-of-scope infrastructure, and destructive endpoints.
3. Writes `qa-context.md` to the project root for confirmation.
4. Optionally generates dedicated, repo-local smoke QA agents for the host(s) you confirm — `.claude/agents/<project>-smoke-qa.md` for Claude Code and/or `.codex/agents/<project>-smoke-qa.toml` for Codex. These are project files meant to be committed alongside `qa-context.md`. Skipping this step is fine; qa-suite orchestration works without them.

Users can also copy `qa-suite/assets/qa-context-template.md` manually.

Commit `qa-context.md`; it is shared team configuration.

Keep the `QA/` reports folder gitignored. It is for local evidence, screenshots, logs, and run artifacts.

See `examples/qa-context.example.md` for a filled example for a small self-hosted web app.

## Usage

Trigger qa-suite in natural language:

```text
run smoke QA
did this change break anything
full release audit
run Bob QA quick mode on the changed UI
check API contract behavior
baseline performance for this project
```

When the request is unclear, qa-suite asks whether this is a routine pass, UI review, or release audit instead of running everything.

| Event                       | Run                                                                   | Skip                                   |
| --------------------------- | --------------------------------------------------------------------- | -------------------------------------- |
| Every build / deploy        | `smoke-qa`                                                            | everything else                        |
| Every PR / merge candidate  | `smoke-qa` -> `regression-qa`                                         | full audits                            |
| UI-touching change          | add `bob-qa` quick mode                                               | full mode                              |
| Backend/API-touching change | add `api-qa`                                                          | UI agents                              |
| Before a release            | `bob-qa` full + `performance-qa` + `security-qa` + `compatibility-qa` | nothing                                |
| Dependency updates          | `regression-qa` + `security-qa` dependency scan                       | unrelated agents                       |
| First run on a new project  | `smoke-qa` -> `bob-qa` full + `performance-qa` baseline framing       | baseline comparisons that do not exist |

Run order matters: smoke first, always. If smoke is No-Go, deeper agents stop because they assume a running app.

## Orchestration Model

QA-Suite is orchestration-first. When Claude Code, Codex, Claude.ai, or another host provides subagents, task agents, background agents, workers, or any equivalent delegation tool, qa-suite dispatches a separate independent QA agent for each selected lane.

The orchestrator prepares neutral setup context, chooses the lanes, enforces smoke-first order, stops deeper QA when smoke is No-Go, and synthesizes the final result. It does not personally perform `smoke-qa`, `regression-qa`, `bob-qa`, `performance-qa`, `security-qa`, `api-qa`, or `compatibility-qa` work when subagents are available.

Each QA subagent receives only project-visible context: `qa-context.md`, relevant repo docs named there, the matching platform checklist, its own lane instructions, the severity/priority matrix when applicable, the report folder, and the user's scoped QA request. Subagents do not inherit the implementation agent's prior context, conversation history, memory, unstated assumptions, or explanation of how the feature should work. `bob-qa` is especially isolated so it can keep a fresh-user mindset; `smoke-qa` is independent evidence, not orchestrator self-certification.

Single-session sequential execution is fallback only for hosts with no subagent or delegation facility. Reports and final summaries from fallback runs must explicitly label themselves as `single-session fallback; non-independent evidence`.

### Codex Notes

In Codex Desktop, Codex CLI, and the Codex IDE extension, qa-suite should run as a root-orchestrated subagent workflow: the main task reads the skill, selects lanes, runs `smoke-qa` first as one child subagent, and then dispatches one direct child subagent for each remaining selected lane after smoke is Go.

Codex skill instructions can request delegation, so qa-suite does not need separate Codex custom-agent files to enforce this rule. If the active Codex tool offers a way to fork or inherit the current conversation context, leave it off for QA lanes. Each QA subagent should start from a fresh, self-contained prompt containing only project-visible context and its own lane instructions. This keeps Bob fresh, keeps smoke independent, and avoids turning the implementation agent's prior reasoning into QA evidence.

Codex subagents inherit the parent task's sandbox and permission mode. Choose the parent permission mode before dispatch and keep QA subagents read-only except for their own report and evidence files under the configured QA folder.

## Plugin-Shipped Agents vs Repo-Local Project Agents

qa-suite involves two different agent mechanisms per host. Don't confuse them.

| | Plugin-shipped (installed with qa-suite) | Repo-local (generated at project init) |
|---|---|---|
| Claude Code | Generic lane subagents from the plugin's `agents/` directory (`smoke-qa`, `regression-qa`, ...). Lowest lookup priority; project-agnostic; get their project binding from the orchestrator's dispatch prompt. | `.claude/agents/<project>-smoke-qa.md` — a project subagent (Markdown + YAML frontmatter, higher priority than plugin agents), pre-bound to this repo's `qa-context.md` and committed with the repo. |
| Codex | qa-suite is a plugin **skill** — prompt instructions the main task follows and delegates from. Skills are not agent definitions. | `.codex/agents/<project>-smoke-qa.toml` — a Codex **custom agent** (TOML with `name`, `description`, `developer_instructions`), directly spawnable and committed with the repo. |

Use plugin-shipped agents for orchestrated qa-suite runs — they update with the plugin and cover every lane. Use the generated repo-local agents when you want to invoke the smoke lane directly without orchestration, share the project's QA entry point with the team through git, or work in a session where the plugin isn't installed.

Invoking the generated agents later:

* Claude Code: `Use the <project>-smoke-qa agent to smoke-test this build` (or Claude delegates to it automatically for smoke-test requests in that repo).
* Codex: ask the task to spawn it, e.g. `Spawn the <project>-smoke-qa agent to check this build comes up`.

Generated agents are deliberately narrow: smoke only, `qa-context.md` first, default run policy respected, reports and evidence written only under the configured QA report folder with timestamped filenames (`YYYY-MM-DD-HHMM-...`, so every rerun is a new file), no source/test/config/git/issue/PR edits, non-destructive shutdown of anything they started, and disposable local test data for any mutating action.

## Agents

| Agent              | One question it answers                                    |
| ------------------ | ---------------------------------------------------------- |
| `smoke-qa`         | Does the build come up at all?                             |
| `regression-qa`    | Did this change break something that worked?               |
| `bob-qa`           | Is the UI/UX usable and accessible for a fresh user?       |
| `performance-qa`   | Is it fast enough, and is it getting worse?                |
| `security-qa`      | Any cheap-to-catch security hygiene issues? Not a pentest. |
| `api-qa`           | Does the API honor its contract, independent of the UI?    |
| `compatibility-qa` | Does it behave the same across the platform matrix?        |

## Platform Checklists

The files under `qa-suite/references/platforms/` define startup checks, accessibility criteria, performance metrics, security surface checks, and compatibility matrices.

| Platform | Compatibility matrix                                                                       |
| -------- | ------------------------------------------------------------------------------------------ |
| Web      | Chromium, WebKit, Firefox x project breakpoints or 320, 375, 768, 1024, 1440px viewports   |
| Android  | minSdk, targetSdk, one mid-range API level x supported form factors and orientation        |
| iOS      | minimum, latest, one intermediate OS version x supported iPhone/iPad sizes and orientation |
| Desktop  | supported OSes x standard, high-DPI/scaled, and smallest supported window configurations   |

Compatibility claims are made only for combinations that were actually run. Emulated or simulated coverage is labeled as such.

## Design Principles

* One agent, one question. Out-of-scope observations go to the right sibling agent.
* Evidence over adjectives. Use criterion numbers, measurements, screenshots, logs, and literal request/response pairs.
* Never claim untested coverage. Every report names what was not tested.
* Most conservative verdict wins. A Go only means nothing failed in that agent’s lane.

## Release Notes

`v1.1.1`:

* Project initialization can now optionally generate dedicated repo-local smoke QA agents alongside `qa-context.md`: `.claude/agents/<project>-smoke-qa.md` (Claude Code project subagent, Markdown + YAML frontmatter) and `.codex/agents/<project>-smoke-qa.toml` (Codex custom agent, TOML). Templates ship in `qa-suite/assets/`.
* Documents when to use plugin-shipped agents vs generated repo-local agents, and keeps the two mechanisms distinct per host.
* Report filenames now include the run's start time: `YYYY-MM-DD-HHMM-<agent>-<short-scope>.md`. Every rerun creates a new report file instead of overwriting the day's earlier run.
* Adds an explicit orchestrator patience rule: a dispatched QA subagent that hasn't returned is not a hang; the orchestrator must never scrap a running lane on elapsed time alone and take it over itself.

`v1.1.1` is the current public package release.

`v1.1.0`:

* Makes subagent/delegation orchestration mandatory whenever the host supports it.
* Labels single-session runs as fallback/non-independent evidence.
* Enforces context isolation architecturally: every QA agent runs isolated from the development conversation, with shared-context runs disclosed as a validity caveat.
* Ships Claude Code subagent definitions in `.claude/agents/` — thin wrappers over the reference agent files — installed automatically with the plugin.
* Defaults QA posture to aggressive negative testing for AI-assisted projects that may already pass happy paths.
* Adds a `Testing posture` field to `qa-context.md`; `standard` requires a stated reason.
* Clarifies that aggressive skepticism never overrides destructive-operation, production, data, or scope boundaries.
* Adds Architecture & intent inputs for ADRs, API contracts/specs, design docs, design tokens, and acceptance criteria.
* Treats those inputs as source-of-truth oracles, so Bob and API QA can report contradictions even when code is self-consistent.
* Adds Bob's visual weirdness sweep for agent-built apps with no designer in the loop.
* Targets UI weirdness only human review usually catches, with screenshot-verified findings against platform or project design oracles.
* Adds evidence-governance rules for security, API, and performance findings so reports cite named oracles or measured tool output.
* Re-keys security checks with stable IDs mapped to ASVS 5.0.0 topic areas or MASVS v2.1.0 control groups, without claiming compliance.
* Adds no-baseline performance defaults for web, Android, iOS, and desktop while preserving project baselines as the override.
* Runs AgentShield before packaging; shipped Claude agent wrappers now declare explicit tool restrictions. Post-fix scan: A, 94/100; remaining high finding is local-only `settings.local.json`, not a tracked release artifact.

Each release includes the `qa-suite/` skill, the Claude.ai `qa-suite.skill` package, and repository metadata for Claude Code and Codex plugin installs.

## License

MIT
