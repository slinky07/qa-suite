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

`v1.0.1` is the current public package release. It includes the `qa-suite/` skill, the Claude.ai `qa-suite.skill` package, and repository metadata for Claude Code and Codex plugin installs.

## License

MIT
