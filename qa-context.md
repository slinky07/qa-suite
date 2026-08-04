# QA Context - project configuration

Every QA agent reads this file before doing anything. This project is a
distribution repository for the qa-suite agent skill/plugin, not a runtime app.
Fields that do not apply are marked N/A so agents report those lanes as not in
scope instead of inventing an app surface.

## Project

- **Project name:** qa-suite
- **Intended audience:** Developers and release operators who install QA-Suite in Claude Code, Claude.ai, or Codex and use it to evaluate software projects
- **Repository docs to read first:** README.md, qa-suite/SKILL.md, .claude-plugin/plugin.json, .codex-plugin/plugin.json
- **Report output folder:** QA/
- **Temporary specialist registry:** qa-specialists.json

## Finding ledger

- **Path:** findings.jsonl
- **Repository visibility (`repo_visibility`):** public
- **Named components:** codex-install, claude-code-install, plugin-installation, project-initialization, qa-orchestration, command-wrappers, agent-wrappers, release-artifacts

## Issue proposal governance

Optional orchestrator-only configuration. Missing or `N/A` values use the
portable defaults in `qa-suite/references/issue-proposals.md`.

- **Tracker:** GitHub Issues
- **Additional proposal threshold:** N/A
- **Issue conventions:** AGENTS.md and README.md; no repository-visible issue template or title convention
- **Read-only duplicate lookup:** GitHub issue search for standard findings when it is already available; sensitive findings require an approved private lookup, otherwise skip remote search; report unavailable checks as not verified

## Testing posture

- **Posture:** aggressive
- **Reason for standard posture:** N/A

## Architecture & intent inputs

Optional source-of-truth documents. Use `N/A` when a project has none.

- **ADRs:** N/A
- **API contracts/specs:** N/A
- **Design docs:** qa-suite/SKILL.md, README.md
- **Design tokens/design system files:** N/A
- **Acceptance criteria:** README.md release notes; qa-suite/SKILL.md workflow, report, and hard-boundary requirements

## Runtime

- **Default run policy:** no runtime service; routine QA validates tracked
  source and plugin metadata with the declared commands. Release preparation
  generates ignored archives outside QA. An explicitly scoped release audit
  validates the prebuilt archives.
- **How to start the app (dev path):** N/A
- **How to start the app (deployment path):** N/A
- **How to check it's running:** N/A
- **How to read logs:** N/A
- **App URL(s):** N/A
- **How to stop the app (non-destructive):** N/A
- **Services that may already be running:** N/A
- **Disposable test target:** A fresh ephemeral CI runner or OS account with run-unique Claude and Codex configuration roots and downloaded artifacts; it may install, replace, restart, and roll back only its own QA-Suite plugins and is discarded after evidence is retained
- **Candidate identity check:** Source checks use `git rev-parse HEAD` plus `git status --short`. Release and installed-plugin audits also require the exact tag, full commit SHA, and archive SHA-256. A pre-publication draft binds those values through the successful draft workflow's retained artifact and `release-evidence.json`; a published release requires successful `gh release verify`. Wherever the host exposes installed bytes, the audit also requires a successful `qa-suite/scripts/verify-installed-payload.mjs` comparison with the active installed `qa-suite/` tree.

## Test commands

- **Fast validation:** `node --test "tests/**/*.test.mjs"`
- **Browser/E2E suite:** N/A
- **Container validation:** N/A
- **Dependency install (if needed):** N/A
- **Dependency audit tool:** N/A

## Core flows

List the user-facing flows agents should exercise. bob-qa tests all of them;
regression-qa tests the ones touched by a diff; compatibility-qa reuses this
list for its matrix.

1. Install qa-suite as a Codex plugin from the repository marketplace metadata.
2. Install qa-suite as a Claude Code plugin from the repository marketplace metadata.
3. Use the qa-suite skill to initialize a project with `qa-context.md`.
4. Use the qa-suite orchestrator to run smoke-first QA lanes and write timestamped reports.
5. Use Claude Code command wrappers for smoke, regression, and release QA paths.
6. Use ten plugin-shipped persistent wrappers for smoke, regression, Bob UX/accessibility, performance, reliability, deployment, data integrity, security, API, and compatibility lanes.
7. Use the generic Claude adapter or wrapperless Codex dispatch for one exact registered temporary-specialist identity without adding it to the persistent roster.
8. During an explicitly scoped release audit, validate the prebuilt `qa-suite.skill`, `qa-suite-source.zip`, and the `qa-suite/` skill directory consistently.

## API surface

- **Has a backend API?** no
- **Contract source:** N/A
- **Destructive endpoints requiring confirmation before testing:** N/A

## Platform

- **Platform:** desktop

## Deployment & threat model

- **Deployment model:** local developer-installed agent skill/plugin distributed through GitHub repository metadata and packaged release artifacts
- **Who can reach it, over what network:** users with access to the public repository or local checkout; no hosted service is in scope
- **Expected concurrency (realistic peak):** N/A for runtime load; multiple independent agent sessions may read repository artifacts concurrently
- **Out-of-scope infrastructure:** GitHub repository settings, published releases, package registries, local agent credentials, user browser profiles, production/public endpoints

## Hard boundaries (all agents, all projects)

These apply regardless of the fields above:

- Never delete volumes, databases, backups, or user data. No `--volumes`, no
  `rm -rf`, no resets.
- Never edit source code, tests, config, the temporary-specialist registry,
  the finding ledger, git history, issues, PRs, or releases to make a result
  pass. Report; don't fix.
- QA lanes never inspect a remote tracker or draft issues. Only the
  orchestrator may prepare a local proposal after synthesis. Any tracker
  mutation requires a later explicit user request.
- Never submit real credentials, tokens, personal files, or private
  identifiers into any page, form, or request.
- Never inject faults, deploy, roll back, or mutate data against shared
  infrastructure, owner data, or an original backup. Use only the declared
  isolated disposable target, synthetic data, and a backup copy.
- Never inspect files, browser data, or applications unrelated to the app
  under test.
- Never test against production or a public hostname unless the user
  explicitly scopes it and confirms authorization.
- If a service was already running before the agent started, identify it and
  prefer not to disturb it.
