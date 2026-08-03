# qa-suite

Evidence-led QA for the built product, run through independent specialist
lanes.

## What it tests, how it tests, and why it helps

| What it tests | How it tests | Why it helps |
|---|---|---|
| The built app, declared user flows, supported interfaces, operational behavior, persistent data, deployment procedure, and release candidate | Independent lanes exercise the scoped target through rendered UI, requests, measurements, deterministic faults, disposable deployments and stores, logs, and screenshots | It finds integration, usability, resilience, rollout, data-integrity, safety, and compatibility failures that isolated code checks can miss |

QA-Suite complements unit and integration tests. Those tests verify code-level
contracts quickly and repeatably. QA-Suite exercises the assembled product
through scoped user and system boundaries, then reports evidence. It does not
edit the implementation to make a result pass.

### Fresh-user QA

Bob QA follows onboarding and the visible interface like a careful non-owner.
It starts without the development conversation or implementation explanation,
then asks whether the intended audience can understand, complete, and recover
from the declared flows. "Passive" means the tester does not compensate for
unclear product behavior with source knowledge or source changes; it can still
perform safe interactions on the scoped test target.

### Safe by default

QA lanes read, observe, and test only the scoped app. They write only their
reports and evidence under the configured QA folder. They do not edit source,
tests, configuration, the specialist registry, the finding ledger, or git
history; delete or reset data; alter an original backup; use real
credentials or private files; or test production or public endpoints without
explicit scope and confirmed authorization. Mutation-dependent flows run only
on a declared disposable target; otherwise they are marked `Observed only`. A
QA run never mutates an external tracker. Any later tracker action requires a
separate, explicit user request.

### Common workflows

| Need | Ask | What runs |
|---|---|---|
| Routine confidence after a build or change | `run smoke QA` or `did this change break anything` | Smoke first, then impact-scoped regression when shipped behavior can change |
| UI or fresh-user review | `run Bob QA quick mode on the changed UI` | Smoke first, then Bob on the primary user flow; request full mode for a broader audit |
| Release readiness | `full release audit` | Smoke first, then every lane applicable to the product's real surfaces |

See [Usage](#usage) for the full trigger matrix and
[Orchestration Model](#orchestration-model) for dispatch mechanics.

## What every run gives you

QA-Suite gives Claude Code, Claude.ai, and Codex a shared QA workflow with:

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
| Claude Code | Add this repo as a plugin marketplace with `/plugin marketplace add slinky07/qa-suite`, then install `qa-suite` with `/plugin install qa-suite@qa-suite`. For local-only use, copy the repository's `qa-suite/` directory so its `SKILL.md` is at `$HOME/.claude/skills/qa-suite/SKILL.md`. |
| Claude.ai | Download `qa-suite.skill` from this repository's Releases page and upload it as a skill. |
| Codex | Add the marketplace with `codex plugin marketplace add slinky07/qa-suite`, install the plugin with `codex plugin add qa-suite@qa-suite`, and verify the installation with `codex plugin list --marketplace qa-suite --json`; the `qa-suite` entry must appear under `installed` with `"installed": true`. Once installed, the plugin is available in both Codex CLI and Codex Desktop. If command codex is not found, install codex-cli: https://learn.chatgpt.com/docs/codex/cli  |
| Codex local skill fallback | Copy the repository's `qa-suite/` directory so its `SKILL.md` is at `$HOME/.agents/skills/qa-suite/SKILL.md` if you want the skill without using the plugin marketplace. |

The Claude Code plugin also includes thin slash commands: `/qa-smoke` (smoke pass), `/qa-regression` (smoke then regression), and `/qa-release` (full release audit).

### Updating an Installed Plugin

| Platform | Update |
|---|---|
| Claude Code | Refresh the marketplace with `/plugin marketplace update qa-suite`, then update the plugin with `/plugin update qa-suite@qa-suite` (restart required to apply). |
| Codex | Run `codex plugin marketplace upgrade` to refresh marketplaces and upgrade installed plugins. |

## Configure Once Per Project

qa-suite sets itself up the first time it sees a project.

It looks for `qa-context.md` in the project root or in `QA/`. If it does not find one, it will not make one up quietly.

On first run it:

1. Auto-discovers what it can from README files, build files, package manifests, Makefiles, compose files, Gradle config, and similar repository sources.
2. Asks for the missing pieces: default run policy, core user flows, deployment model, threat model, expected concurrency, out-of-scope infrastructure, and destructive endpoints.
3. Writes `qa-context.md` to the project root for confirmation.
4. Generates dedicated, repo-local smoke QA agents by default — `.claude/agents/<project>-smoke-qa.md` for Claude Code and `.codex/agents/<project>-smoke-qa.toml` for Codex — skipping a format only when the host/project clearly does not support it or you decline. These are project files meant to be committed alongside `qa-context.md`; qa-suite orchestration still works without them.

**Repository exception.** This repository distributes qa-suite rather than
consuming it. It owns the two source templates under `qa-suite/assets/`, ten
persistent Claude lane wrappers, and one generic temporary-specialist adapter
(eleven Claude adapters total), but does not commit project-bound generated
smoke agents for itself. Consuming repositories own their generated copies and
must regenerate or refresh them whenever template behavior changes.

Users can also copy `qa-suite/assets/qa-context-template.md` manually.

`Temporary specialist registry` is optional. Leave it `N/A` unless a material
project risk is unowned by all ten persistent lanes. Existing contexts without
the field remain valid. When used, it names one tracked repository-relative
JSON file whose content-addressed identities are resolved exactly; see
`qa-suite/references/temporary-specialist-registry.md`.

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
test deterministic failure and recovery behavior
verify rollout identity and rollback on the disposable target
check stored-data invariants across this migration
```

When the request is unclear, qa-suite asks whether this is a routine pass, UI review, or release audit instead of running everything.

| Event or affected risk | Run | Skip |
|---|---|---|
| Every build / deploy | `smoke-qa` | lanes without another affected risk |
| Every PR / merge candidate | `smoke-qa`; add `regression-qa` when shipped behavior, contracts, configuration, or artifacts can regress | `regression-qa` when no deliverable behavior can change; full audits |
| UI-touching change | add `bob-qa` (quick mode) | full mode unless explicitly requested |
| Backend/API-touching change | add `api-qa`; add `bob-qa` when a user-facing consumer can change | UI lanes with no affected consumer |
| Reliability-risk change | add `reliability-qa` for material retry, degraded-mode, external-dependency, failover, recovery-objective, resilience, or alerting risk | when no post-start continuity or recovery risk is affected |
| Deployment-risk change | add `deployment-qa` for material packaging, environment-configuration, deployment-automation, install/upgrade, health-verification, migration-execution, or rollback risk | when no deployment procedure or artifact/configuration identity risk is affected |
| Persistent-data change | add `data-integrity-qa` for material write, transaction, concurrency, schema, import/export, backup, restore, or recovery risk | when no stored-state invariant or durability risk is affected |
| Before a release | `smoke-qa`, then every applicable release lane: `bob-qa` (full) for a user-facing surface, `performance-qa` for a runtime performance surface, `reliability-qa` for a post-start continuity or recovery surface, `deployment-qa` for a delivery or rollback surface, `data-integrity-qa` for a persistent-data surface, `security-qa` for a dependency or exposure surface, `api-qa` for an API, `compatibility-qa` for a supported platform matrix | lanes whose primary risk is absent |
| Dependency updates | `security-qa` when the dependency is shipped or executed; `reliability-qa` when an external runtime dependency creates material failure or recovery risk; `regression-qa` when build or behavior can change | lanes with no affected dependency risk |
| First run on a new project | `smoke-qa`; add `bob-qa` (full) only for a user-facing surface and `performance-qa` baseline framing only for a runtime performance surface | inapplicable surfaces and baseline comparisons that do not exist |
| Post-fix cycle with unresolved findings | freeze and rebuild; `smoke-qa`; one confirmation mission per finding through its originating lane; impact-scoped regression | full recertification unless explicitly requested as a release audit |

The broad release, first-run, PR, dependency, and backend/API triggers are impact-scoped. A full release audit means every applicable lane, not every lane regardless of the project's surfaces.

Reliability, deployment, and data-integrity QA are smoke-gated, selected only
for material matching risk, and default to 60 minutes with an explicit recorded
15–240-minute override. Smoke owns startup; reliability owns post-start
failure, degradation, recovery, and alerts. Performance owns speed and resource
use. Deployment owns artifact/configuration identity and procedure; data
integrity owns state correctness across it. API owns wire behavior, security
owns unauthorized modification, and regression owns history; data integrity
owns stored invariants, accidental corruption, transaction safety, and
recoverability.

A temporary specialist is selected only when a material risk remains unowned
by all ten lanes. It uses one exact immutable registry identity and remains
outside the persistent roster.

Finding-ledger schema v2 is canonical for empty ledgers and accepts all ten
persistent identities plus exact registry-resolved temporary identities. A
non-empty v1 ledger remains valid and writable by its original seven lanes.
Selecting a new persistent or temporary identity against v1 stops before
dispatch and prints the exact compare-and-swap migration command. Temporary
findings default to `uncertain` sensitivity and redacted or sidecar-only
storage until explicit human clearance permits publication.

Run order matters: smoke first, always. If smoke is `No-Go` or `Blocked`, deeper agents stop because they require an exercised smoke target.

Post-fix runs bind every report to one frozen candidate. They confirm each unresolved finding through its originating lane, mark older-candidate evidence as superseded, and run only the regression lanes justified by the fix's impact. Routine discovery runs receive no finding manifest.

A temporary finding always confirms through the same exact historical
identity. If that definition is missing, confirmation is named `Blocked`, the
lifecycle row stays unchanged, and another entry with the same slug is never
substituted.

## Orchestration Model

QA-Suite is orchestration-first. When Claude Code, Codex, Claude.ai, or another host provides subagents, task agents, background agents, workers, or any equivalent delegation tool, qa-suite dispatches a separate independent QA agent for each selected lane.

Each lane has a compact specialist contract: a simulated professional
perspective, one primary question, a specialist mission, priorities, decision
rules, evidence requirements, and scope boundaries. These perspectives are
semantic steering. They are not credentials, certification, guaranteed
expertise, or a substitute for qualified human assessment. Operational rules
and evidence outrank the role title.

The orchestrator prepares neutral setup context, chooses the lanes, enforces smoke-first order, stops deeper QA when smoke is `No-Go` or `Blocked`, and synthesizes the final result. It does not personally perform `smoke-qa`, `regression-qa`, `bob-qa`, `performance-qa`, `reliability-qa`, `deployment-qa`, `data-integrity-qa`, `security-qa`, `api-qa`, or `compatibility-qa` work when subagents are available.

Lane selection follows the affected risks or the user's explicit request. The
orchestrator records a brief reason for every selected lane and any expected
lane it skips, but keeps those reasons out of the specialist prompt so they do
not steer the result.

For a temporary specialist, the root validates the tracked registry, selects
one exact content-addressed identity, and records a run-specific rationale. The
specialist receives only the rationale-free dispatch projection; it never
receives `selection_criteria`, `definition_rationale`, sibling definitions, or
the run-specific rationale. Direct generic invocation, an incomplete envelope,
failed exact resolution, identity digest drift, or unconstrained scope is
refused before project inspection.

Each QA subagent receives only project-visible context: `qa-context.md`, relevant repo docs named there, the matching platform checklist, its own lane instructions, the severity/priority matrix when applicable, the report folder, and the user's scoped QA request. Subagents do not inherit the implementation agent's prior context, conversation history, memory, unstated assumptions, or explanation of how the feature should work. `bob-qa` is especially isolated so it can keep a fresh-user mindset; `smoke-qa` is independent evidence, not orchestrator self-certification.

Every dispatch names the canonical primary question and lifecycle
`mission: discovery | confirmation | regression`. Mission mode, not the
specialist identity, controls whether a confirmation manifest or graduated
regression corpus is allowed. Scope and manifest values remain subject to the
single canonical verbatim-dispatch rule in `qa-suite/SKILL.md`.

During synthesis, the orchestrator validates evidence, keeps assumptions
separate and verdict-neutral, deduplicates demonstrated defects through the
finding-ledger matching contract, retains the first owning identity, attaches
later reports as provenance, and names unresolved factual or recommendation
conflicts. Lane
results remain visible separately from the orchestrator-owned final assessment
or final release assessment. Reports and summaries preserve useful evidence
shape while redacting credentials, sessions, personal data, private
user identifiers, and sensitive URLs.

Single-session sequential execution is fallback only for hosts with no subagent or delegation facility. Reports and final summaries from fallback runs must explicitly label themselves as `single-session fallback; non-independent evidence`.

### Governance-Aware Issue Proposals

After synthesis and finding-ledger reconciliation, the orchestrator prepares a
copyable issue proposal for each new or materially changed `open` or
`regressed` S1/S2 or P0 finding. Project-visible `qa-context.md` configuration
may broaden that threshold. It cannot suppress the default. Fixed, unchanged,
observation-only, and currently valid `accepted` or `wontfix` items do not
generate tracker noise. An accepted or `wontfix` finding becomes eligible only
when current evidence voids its acceptance under the canonical risk-acceptance
contract; the human-set status and reason remain unchanged.
Existing project contexts need no migration; missing proposal fields use the
default threshold and portable Markdown.

The orchestrator reads applicable `AGENTS.md`, `qa-context.md`, README and
contribution guidance, named contracts, issue templates, and already-accessible
read-only tracker results. It does not infer tracker rules from the development
conversation, agent memory, credentials, or unavailable services. A clear
existing match is reported instead of producing a duplicate. An unavailable
tracker is disclosed as an unverified duplicate check.

The redacted proposal appears in the final synthesis and in a new immutable
`YYYY-MM-DD-HHMM-issue-proposals-<short-scope>.md` file under the configured
QA report folder. Creation is exclusive; a collision receives a numeric
suffix. QA lanes never inspect a remote tracker or draft issues.
Neither the lanes nor the orchestrator mutate a tracker during QA. Creating,
editing, commenting on, labeling, assigning, closing, or moving a tracker item
requires a later explicit user request.

### Codex Notes

In Codex Desktop, Codex CLI, and the Codex IDE extension, qa-suite should run as a root-orchestrated subagent workflow: the main task reads the skill, selects lanes, runs `smoke-qa` first as one child subagent, and then dispatches one direct child subagent for each remaining selected lane only after a Go-family smoke verdict.

Codex skill instructions can request delegation, so qa-suite does not need separate Codex custom-agent files to enforce this rule. If the active Codex tool offers a way to fork or inherit the current conversation context, leave it off for QA lanes. Each QA subagent should start from a fresh, self-contained prompt containing only project-visible context and its own lane instructions. This keeps Bob fresh, keeps smoke independent, and avoids turning the implementation agent's prior reasoning into QA evidence.

Codex subagents inherit the parent task's sandbox and permission mode. Choose the parent permission mode before dispatch and keep QA subagents read-only except for their own report and evidence files under the configured QA folder.

Codex remains wrapperless for temporary specialists. The root resolves the
same exact registry projection and dispatches a fresh constrained child with
no inherited conversation. The resolved `temporary-qa-...` identity—not a
generic adapter name—appears in its report and ledger proposals.

## Plugin-Shipped Agents vs Repo-Local Project Agents

qa-suite involves two different agent mechanisms per host. Don't confuse them.

| | Plugin-shipped (installed with qa-suite) | Repo-local (generated at project init) |
|---|---|---|
| Claude Code | Ten persistent lane wrappers plus one generic temporary-specialist adapter from the plugin's `.claude/agents/` directory. Eleven adapters total; the generic adapter is not a lane and refuses a missing exact-identity envelope. Lowest lookup priority; project-agnostic; get their project binding from the orchestrator's dispatch prompt. | `.claude/agents/<project>-smoke-qa.md` — a project subagent (Markdown + YAML frontmatter, higher priority than plugin agents), pre-bound to this repo's `qa-context.md` and committed with the repo. |
| Codex | qa-suite is a plugin **skill** — prompt instructions the main task follows and delegates from. Skills are not agent definitions. | `.codex/agents/<project>-smoke-qa.toml` — a Codex **custom agent** (TOML with `name`, `description`, `developer_instructions`), directly spawnable and committed with the repo. |

Use plugin-shipped agents for orchestrated qa-suite runs — they update with the plugin and cover every persistent lane plus exact registered temporary specialists. Use the generated repo-local agents when you want to invoke the smoke lane directly without orchestration, share the project's QA entry point with the team through git, or work in a session where the plugin isn't installed.

Invoking the generated agents later:

* Claude Code: `Use the <project>-smoke-qa agent to smoke-test this build` (or Claude delegates to it automatically for smoke-test requests in that repo).
* Codex: ask the task to spawn it, e.g. `Spawn the <project>-smoke-qa agent to check this build comes up`.

Generated agents are deliberately narrow: smoke only, `qa-context.md` first, default run policy respected, reports and evidence written only under the configured QA report folder with timestamped filenames (`YYYY-MM-DD-HHMM-...`, so every rerun is a new file), no source/test/config/git/issue/PR edits, non-destructive shutdown of anything they started, and disposable local test data for any mutating action.

## Agents

| Agent | Specialist perspective | One question it answers |
|---|---|---|
| `smoke-qa` | Release verification engineer | Does this build come up and do the declared critical paths respond? |
| `regression-qa` | Regression and change-impact QA engineer | Did this change break something that worked? |
| `bob-qa` | End-user behavior, usability, and accessibility reviewer | Is the UI/UX usable and accessible for a fresh user? |
| `performance-qa` | Performance QA engineer | Is it fast enough, and is that getting worse? |
| `reliability-qa` | Reliability QA engineer | Does the system fail, degrade, recover, and alert safely under its documented operating conditions? |
| `deployment-qa` | Deployment QA engineer | Can the system be configured, deployed, verified, and rolled back safely and repeatedly? |
| `data-integrity-qa` | Data integrity QA engineer | Do writes, migrations, concurrency, backup, and recovery preserve the expected data state? |
| `security-qa` | Application security QA engineer performing a hygiene review | Are there any cheap-to-catch security hygiene issues? |
| `api-qa` | API contract and integration QA engineer | Does the API honor its contract, independent of the UI? |
| `compatibility-qa` | Platform compatibility QA engineer | Does it behave the same across the platform matrix? |

These are exactly ten persistent lanes. Temporary specialists are dynamic,
project-local identities and never appear in this roster or the closed
maintainer evaluation corpus.

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
* Specialist titles steer attention; they never increase confidence without evidence.
* Never claim untested coverage. Every report names what was not tested.
* Controlled report prose uses selected ASD-STE100 Issue 9 principles. This is not formal ASD-STE100 conformance. Routine passes use compact tables or lists. Findings and blockers retain their supporting evidence. Exact technical text is not rewritten.
* Valid human-accepted risks are excluded during final synthesis; then the most conservative verdict wins. A Go only means nothing failed in that agent’s lane.

## Release Notes

`v1.4.0`:

* Strengthens Bob's passive fresh-user review, clarifies cross-lane verdict classification, and binds smoke claims to screenshot evidence.
* Extends orchestrator-reconcilable finding proposals to all seven lanes while preserving each lane's blindness to the finding ledger.
* Corrects install and agent paths, defines Codex catalog and manifest ownership, keeps local runtime state out of Git, documents generated-agent ownership, and adds fail-closed controlled-reference validation to exact-ref releases.

Repository package version: `v1.4.0`. The GitHub Releases page is the
authority for whether that version has been published.

`v1.3.0`:

* Adds a committed finding ledger with stable defect identity, lifecycle state, conservative cross-lane matching, and a documented three-tier evidence model.
* Adds strict schema, path, visibility, redaction, and compare-and-swap protections so ledger validation and concurrent writes fail loudly.
* Repairs draft-release discovery and lets reviewed release automation resume a frozen tag without moving the tag or changing its package payload.

`v1.2.0`:

* Adds canonical cross-lane verdict, observed-only, disposable-target, risk-acceptance, and verbatim-dispatch contracts.
* Adds evidence-backed Bob IA and trust guidance, smoke `No-Go`/`Blocked` gating, impact-scoped triggers, and explicit lane time boxes.
* Adds durable contract tests for `qa-context.md` parity and shared QA workflow invariants.
* Builds both release assets deterministically from the exact Git commit, verifies archive/tree parity and remote digests, and retains release evidence before publication.

`v1.1.3`:

* Project initialization now generates the repo-local smoke QA agents by default — `.claude/agents/<project>-smoke-qa.md` and `.codex/agents/<project>-smoke-qa.toml` — instead of offering them as an optional post-confirmation step. A format is skipped only when the host/project clearly does not support it or the user declines.
* README now names the Claude Code slash commands (`/qa-smoke`, `/qa-regression`, `/qa-release`) and documents plugin update commands for Claude Code and Codex.
* `qa-suite.skill` and `qa-suite-source.zip` are regenerated from the current `qa-suite/` tree and verified byte-identical to the checkout, fixing the stale-artifact QA findings (BOB-001, COMPAT-001/002, security finding 1).

`v1.1.2`:

* The visual weirdness sweep checklists now carry the full VW-* check set (VW-WEB-01…11, VW-AND-01…12, VW-IOS-01…12, VW-DSK-01…10), and each sweep section opens with its named platform design oracle (Material Design 3, Apple HIG, WCAG 2.2 AA + Nielsen H4/H8, or the OS convention) and a screenshot-evidence rule.
* Restores the concrete WCAG 2.2 2.5.8 target-size numbers in the web accessibility checklist.
* Restores Bob's strict implementation-source reading ban for visual findings and the enumerated named-standards list in the skill's design principles.

`v1.1.1`:

* Project initialization can now optionally generate dedicated repo-local smoke QA agents alongside `qa-context.md`: `.claude/agents/<project>-smoke-qa.md` (Claude Code project subagent, Markdown + YAML frontmatter) and `.codex/agents/<project>-smoke-qa.toml` (Codex custom agent, TOML). Templates ship in `qa-suite/assets/`.
* Documents when to use plugin-shipped agents vs generated repo-local agents, and keeps the two mechanisms distinct per host.
* Report filenames now include the run's start time: `YYYY-MM-DD-HHMM-<agent>-<short-scope>.md`. Every rerun creates a new report file instead of overwriting the day's earlier run.
* Adds an explicit orchestrator patience rule: a dispatched QA subagent that hasn't returned is not a hang; the orchestrator must never scrap a running lane on elapsed time alone and take it over itself.

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
