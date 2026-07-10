# QA Context - project configuration

Every QA agent reads this file before doing anything. This project is a
distribution repository for the qa-suite agent skill/plugin, not a runtime app.
Fields that do not apply are marked N/A so agents report those lanes as not in
scope instead of inventing an app surface.

## Project

- **Project name:** qa-suite
- **Repository docs to read first:** README.md, qa-suite/SKILL.md, .claude-plugin/plugin.json, .codex-plugin/plugin.json
- **Report output folder:** QA/

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

- **Default run policy:** no runtime service; validate repository artifacts directly
- **How to start the app (dev path):** N/A
- **How to start the app (deployment path):** N/A
- **How to check it's running:** N/A
- **How to read logs:** N/A
- **App URL(s):** N/A
- **How to stop the app (non-destructive):** N/A
- **Services that may already be running:** N/A

## Test commands

- **Fast validation:** inspect repository artifacts and package metadata; no automated validation command is defined in this repository
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
6. Use plugin-shipped agent wrappers for smoke, regression, Bob UX/accessibility, performance, security, API, and compatibility lanes.
7. Package and distribute `qa-suite.skill`, `qa-suite-source.zip`, and the `qa-suite/` skill directory consistently.

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
- Never edit source code, tests, config, git history, issues, PRs, or
  releases to make a result pass. Report; don't fix.
- Never submit real credentials, tokens, personal files, or private
  identifiers into any page, form, or request.
- Never inspect files, browser data, or applications unrelated to the app
  under test.
- Never test against production or a public hostname unless the user
  explicitly scopes it and confirms authorization.
- If a service was already running before the agent started, identify it and
  prefer not to disturb it.
