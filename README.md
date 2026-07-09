# qa-suite

qa-suite is a distributable agent skill for running disciplined multi-agent QA across real software projects. It gives Claude Code, Claude.ai, and Codex a shared QA framework: scoped agents, one question each, evidence-anchored reports, Severity/Priority on every finding, a verdict on line one, a mandatory "Not tested" section, and platform checklists for web, Android, iOS, and desktop.

## Install Once Per Agent Platform

Install qa-suite into the agent platform. Do not copy it into every project repo you test.

| Platform | Install |
|---|---|
| Claude Code | Copy `qa-suite/` into `~/.claude/skills/`, or into `.claude/skills/` for one Claude Code project. |
| Claude.ai | Download `qa-suite.skill` from this repo's Releases page and upload it as a skill. |
| Codex | Copy `qa-suite/` into `$HOME/.agents/skills/qa-suite` for global use, or into `.agents/skills/qa-suite` for a repo-scoped team skill. Optionally mention `$qa-suite` in `AGENTS.md` when that repo should route QA requests to it. |

Claude Code users can also copy `.claude/commands/` for thin slash commands that invoke smoke, regression, and release QA paths.

## Configure Once Per Project

qa-suite self-onboards the first time it sees a project. It looks for `qa-context.md` in the project root or `QA/`. If none exists, it does not silently invent one.

On first run it:

1. Auto-discovers what it can from README files, build files, package manifests, Makefiles, compose files, Gradle config, and similar repo sources.
2. Interviews for the rest: default run policy, core user flows, deployment model, threat model, expected concurrency, out-of-scope infrastructure, and destructive endpoints.
3. Writes `qa-context.md` to the project root for confirmation.

Users can also copy `qa-suite/assets/qa-context-template.md` manually. Commit `qa-context.md`; it is shared team configuration. Keep the `QA/` reports folder gitignored; reports are local evidence, screenshots, logs, and run artifacts.

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

When the ask is ambiguous, qa-suite asks whether this is a routine pass, UI review, or release audit instead of running everything.

| Event | Run | Skip |
|---|---|---|
| Every build / deploy | `smoke-qa` | everything else |
| Every PR / merge candidate | `smoke-qa` -> `regression-qa` | full audits |
| UI-touching change | add `bob-qa` quick mode | full mode |
| Backend/API-touching change | add `api-qa` | UI agents |
| Before a release | `bob-qa` full + `performance-qa` + `security-qa` + `compatibility-qa` | nothing |
| Dependency updates | `regression-qa` + `security-qa` dependency scan | unrelated agents |
| First run on a new project | `smoke-qa` -> `bob-qa` full + `performance-qa` baseline framing | baseline comparisons that do not exist |

Run order matters: smoke first, always. If smoke is No-Go, deeper agents stop because they assume a running app.

## Agents

| Agent | One question it answers |
|---|---|
| `smoke-qa` | Does the build come up at all? |
| `regression-qa` | Did this change break something that worked? |
| `bob-qa` | Is the UI/UX usable and accessible for a fresh user? |
| `performance-qa` | Is it fast enough, and is that getting worse? |
| `security-qa` | Any cheap-to-catch security hygiene issues? Not a pentest. |
| `api-qa` | Does the API honor its contract, independent of the UI? |
| `compatibility-qa` | Does it behave the same across the platform matrix? |

## Platform Checklists

The platform files under `qa-suite/references/platforms/` define startup checks, accessibility criteria, performance metrics, security surface checks, and compatibility matrices.

| Platform | Compatibility matrix |
|---|---|
| Web | Chromium, WebKit, Firefox x project breakpoints or 320, 375, 768, 1024, 1440px viewports |
| Android | minSdk, targetSdk, one mid-range API level x supported form factors and orientation |
| iOS | minimum, latest, one intermediate OS version x supported iPhone/iPad sizes and orientation |
| Desktop | supported OSes x standard, high-DPI/scaled, and smallest supported window configurations |

Compatibility claims are only made for combinations actually run. Emulated or simulated coverage is labeled as such.

## Design Principles

- One agent, one question. Out-of-scope observations route to the correct sibling agent.
- Evidence over adjectives. Use criterion numbers, measurements, screenshots, logs, and literal request/response pairs.
- Never claim untested coverage. Every report names what was not tested.
- Most conservative verdict wins. A Go only means nothing failed in that agent's lane.

## License

MIT
