import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

function readRepositoryFile(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

function extractSection(markdown, heading) {
  const marker = `${heading}\n`;
  const start = markdown.indexOf(marker);

  assert.notEqual(start, -1, `missing section: ${heading}`);

  const contentStart = start + marker.length;
  const level = heading.match(/^#+/)[0].length;
  const remainder = markdown.slice(contentStart);
  const nextHeading = new RegExp(`^#{1,${level}}[ \\t]+`, "m").exec(
    remainder,
  );

  return nextHeading ? remainder.slice(0, nextHeading.index) : remainder;
}

function normalizeWhitespace(text) {
  return text.replace(/\s+/g, " ").trim();
}

const proposalFields = [
  "Finding",
  "Proposed tracker",
  "Title",
  "Threshold",
  "Affected scope",
  "Environment",
  "Reproduction or observations",
  "Expected result",
  "Actual result",
  "Evidence",
  "Oracle",
  "Impact",
  "Suggested acceptance criteria",
  "Uncertainties",
  "Not tested",
  "Governance sources",
  "Duplicate check",
  "Authorization",
];

test("proposal eligibility is conservative, lifecycle-aware, and configurable", async () => {
  const [reference, skill, readme] = await Promise.all([
    readRepositoryFile("qa-suite/references/issue-proposals.md"),
    readRepositoryFile("qa-suite/SKILL.md"),
    readRepositoryFile("README.md"),
  ]);
  const eligibility = normalizeWhitespace(
    extractSection(reference, "## Eligibility"),
  );
  const skillContract = normalizeWhitespace(
    extractSection(skill, "### Governance-aware issue proposals"),
  );
  const publicContract = normalizeWhitespace(
    extractSection(readme, "### Governance-Aware Issue Proposals"),
  );

  assert.match(eligibility, /newly created finding/);
  assert.match(eligibility, /materially changed in the current run/);
  assert.match(eligibility, /transition to `regressed`/);
  assert.match(eligibility, /status is `open` or `regressed`/);
  assert.match(eligibility, /Severity is S1 or S2/);
  assert.match(eligibility, /Priority is P0/);
  assert.match(eligibility, /`accepted` or `wontfix` finding has `Acceptance void/);
  assert.match(eligibility, /may broaden the default/);
  assert.match(eligibility, /never suppresses the canonical default/);
  assert.match(eligibility, /existing `qa-context\.md`.*remains valid/);
  assert.match(eligibility, /not a configuration migration or a dispatch blocker/);
  assert.match(eligibility, /`fixed` finding or a currently valid `accepted` or `wontfix`/);
  assert.match(eligibility, /does not change the human-set ledger status/);
  assert.match(eligibility, /assumption, suggestion, or observed-only note/);
  assert.match(eligibility, /Do not emit the same unchanged proposal/);
  assert.match(
    eligibility,
    /Priority controls scheduling and Severity controls impact/,
  );

  for (const contract of [skillContract, publicContract]) {
    assert.match(contract, /(?:new|newly created) or materially changed/);
    assert.match(contract, /`open` or `regressed`/);
    assert.match(contract, /S1\/S2 or P0/);
    assert.match(contract, /broaden/);
    assert.match(contract, /never suppress|cannot suppress/);
    assert.match(contract, /do not require migration|need no migration/);
  }
});

test("proposal governance uses only visible sources and fails honestly on unavailable lookup", async () => {
  const reference = await readRepositoryFile(
    "qa-suite/references/issue-proposals.md",
  );
  const governance = normalizeWhitespace(
    extractSection(reference, "## Governance discovery"),
  );
  const duplicates = normalizeWhitespace(
    extractSection(reference, "## Duplicate control"),
  );

  for (const source of [
    "`AGENTS.md`",
    "`qa-context.md`",
    "README and contribution guidance",
    "architecture decisions, contracts, and acceptance criteria",
    "issue templates and tracker configuration",
    "read-only tracker metadata or search results",
  ]) {
    assert.match(governance, new RegExp(source));
  }

  assert.match(governance, /repository-visible governance/);
  assert.match(governance, /implementation conversation/);
  assert.match(governance, /agent memory/);
  assert.match(governance, /private assumptions/);
  assert.match(governance, /Do not assume GitHub, a CLI, credentials, or network/);
  assert.match(governance, /produce portable Markdown/);

  assert.match(duplicates, /stable ID/);
  assert.match(duplicates, /exact failed behavior, component, and named oracle/);
  assert.match(duplicates, /Do not match by title alone/);
  assert.match(duplicates, /`Existing tracked item`/);
  assert.match(duplicates, /preserve the draft and state the uncertainty/);
  assert.match(
    duplicates,
    /Tracker duplicate check: not verified — tracker unavailable/,
  );
  assert.match(duplicates, /never claim that no duplicate exists/);
});

test("proposal output is copyable, durable, redacted, and complete", async () => {
  const [reference, skill, readme] = await Promise.all([
    readRepositoryFile("qa-suite/references/issue-proposals.md"),
    readRepositoryFile("qa-suite/SKILL.md"),
    readRepositoryFile("README.md"),
  ]);
  const artifact = normalizeWhitespace(
    extractSection(reference, "## Proposal artifact"),
  );
  const skillContract = normalizeWhitespace(
    extractSection(skill, "### Governance-aware issue proposals"),
  );
  const publicContract = normalizeWhitespace(
    extractSection(readme, "### Governance-Aware Issue Proposals"),
  );

  assert.match(artifact, /final synthesis under `Issue proposals`/);
  assert.match(
    artifact,
    /QA\/YYYY-MM-DD-HHMM-issue-proposals-<short-scope>\.md/,
  );
  assert.match(artifact, /configured report folder/);
  assert.match(artifact, /Never append to or overwrite/);
  assert.match(artifact, /exclusive-create semantics/);
  assert.match(artifact, /first unused numeric suffix/);
  assert.match(artifact, /starting with `-2`/);
  assert.match(artifact, /Report the actual path used/);
  assert.match(artifact, /not a lane report/);
  assert.match(artifact, /never (?:edit|modify) a completed lane report/i);
  assert.match(artifact, /<priority>: <concise imperative outcome>/);
  assert.match(artifact, /never invent a repository\s+category/);

  for (const field of proposalFields) {
    assert.match(artifact, new RegExp(`\\\`${field}\\\``), field);
  }

  assert.match(artifact, /observable completion, not an invented implementation/);
  assert.match(artifact, /Apply the report redaction contract/);
  assert.match(artifact, /Never copy credentials, personal data/);
  assert.match(skillContract, /exclusive creation/);
  assert.match(skillContract, /numeric suffix on collision/);
  assert.match(publicContract, /Creation is exclusive/);
  assert.match(publicContract, /collision receives a numeric\s+suffix/);
});

test("tracker mutation remains a separate user-authorized workflow", async () => {
  const [reference, skill, readme] = await Promise.all([
    readRepositoryFile("qa-suite/references/issue-proposals.md"),
    readRepositoryFile("qa-suite/SKILL.md"),
    readRepositoryFile("README.md"),
  ]);
  const authorization = normalizeWhitespace(
    extractSection(reference, "## Authorization boundary"),
  );
  const notice =
    "Draft only — no tracker mutation occurred. A separate explicit user request is required.";

  assert.ok(reference.includes(notice));
  assert.ok(skill.includes(notice));
  assert.match(authorization, /QA lanes only report findings and evidence/);
  assert.match(authorization, /never inspect a remote tracker/);
  assert.match(authorization, /read-only duplicate check/);
  assert.match(
    authorization,
    /must not create, edit, comment on, label, assign, close, move, or otherwise mutate/,
  );
  assert.match(authorization, /only after the user explicitly requests/);
  assert.match(
    readme,
    /QA lanes never inspect a remote tracker or draft issues/,
  );
  assert.match(readme, /requires a later explicit user request/);
});

test("qa-context covers GitHub and inaccessible non-GitHub governance", async () => {
  const [template, example, repositoryContext] = await Promise.all([
    readRepositoryFile("qa-suite/assets/qa-context-template.md"),
    readRepositoryFile("examples/qa-context.example.md"),
    readRepositoryFile("qa-context.md"),
  ]);

  for (const context of [template, example, repositoryContext]) {
    assert.match(context, /^## Issue proposal governance$/m);
    assert.match(context, /\*\*Tracker:\*\*/);
    assert.match(context, /\*\*Additional proposal threshold:\*\*/);
    assert.match(context, /\*\*Issue conventions:\*\*/);
    assert.match(context, /\*\*Read-only duplicate lookup:\*\*/);
    assert.match(context, /QA lanes never inspect a remote tracker/);
    assert.match(context, /later explicit user request/);
  }

  assert.match(repositoryContext, /\*\*Tracker:\*\* GitHub Issues/);
  assert.match(
    repositoryContext,
    /GitHub issue search for standard findings when it is already available/,
  );
  assert.match(example, /\*\*Tracker:\*\* self-hosted Forgejo Issues/);
  assert.match(example, /\*\*Additional proposal threshold:\*\* also include P1/);
  assert.match(example, /tracker is not accessible to QA sessions/);
});

test("examples cover GitHub conventions and a tracker without access", async () => {
  const reference = await readRepositoryFile(
    "qa-suite/references/issue-proposals.md",
  );
  const github = extractSection(
    reference,
    "### GitHub conventions are visible",
  );
  const inaccessible = extractSection(
    reference,
    "### Non-GitHub tracker is inaccessible",
  );

  for (const [name, example] of [
    ["GitHub", github],
    ["inaccessible tracker", inaccessible],
  ]) {
    for (const field of proposalFields) {
      assert.match(example, new RegExp(`^${field}:`, "m"), `${name}: ${field}`);
    }
  }

  assert.match(github, /GitHub Issues, private security advisory/);
  assert.match(github, /security\/P0:/);
  assert.match(github, /\.github\/ISSUE_TEMPLATE\/security\.yml/);
  assert.match(inaccessible, /Forgejo Issues \(inaccessible\)/);
  assert.match(inaccessible, /portable Markdown/);
  assert.match(
    inaccessible,
    /Tracker duplicate check: not verified — tracker unavailable/,
  );
});

test("sensitive proposals preserve the finding-ledger redaction boundary", async () => {
  const reference = await readRepositoryFile(
    "qa-suite/references/issue-proposals.md",
  );
  const sensitive = normalizeWhitespace(
    extractSection(reference, "## Sensitive findings"),
  );

  assert.match(sensitive, /sensitivity classification and storage decision/);
  assert.match(sensitive, /security S1\/S2 finding for a public repository/);
  assert.match(sensitive, /private security advisory/);
  assert.match(sensitive, /not a public issue/);
  assert.match(sensitive, /only a redacted handoff/);
  assert.match(sensitive, /never weakens the finding ledger's redaction rules/);
});

test("sensitive duplicate lookup never exposes search terms to a public tracker", async () => {
  const [reference, repositoryContext] = await Promise.all([
    readRepositoryFile("qa-suite/references/issue-proposals.md"),
    readRepositoryFile("qa-context.md"),
  ]);
  const duplicates = normalizeWhitespace(
    extractSection(reference, "## Duplicate control"),
  );

  assert.match(
    duplicates,
    /`security-s1-s2`, `uncertain`, `human-sensitive`/,
  );
  assert.match(
    duplicates,
    /never send the stable ID, failed behavior, component, oracle, or\s+evidence-derived search terms/,
  );
  assert.match(duplicates, /public or less-restricted tracker/);
  assert.match(duplicates, /approved private lookup/);
  assert.match(duplicates, /sanitized query keys approved for that destination/);
  assert.match(
    duplicates,
    /Sensitive tracker duplicate check: not performed — no approved private lookup/,
  );
  assert.match(repositoryContext, /GitHub issue search for standard findings/);
  assert.match(repositoryContext, /sensitive findings require an approved private lookup/);
  assert.match(repositoryContext, /otherwise skip remote search/);
});

test("voided risk acceptance remains proposal-eligible without changing status", async () => {
  const [reference, skill] = await Promise.all([
    readRepositoryFile("qa-suite/references/issue-proposals.md"),
    readRepositoryFile("qa-suite/SKILL.md"),
  ]);
  const eligibility = normalizeWhitespace(
    extractSection(reference, "## Eligibility"),
  );
  const riskAcceptance = normalizeWhitespace(
    extractSection(skill, "### Risk acceptance"),
  );
  const proposalContract = normalizeWhitespace(
    extractSection(skill, "### Governance-aware issue proposals"),
  );

  assert.match(riskAcceptance, /Acceptance void — human review required/);
  assert.match(riskAcceptance, /does not authorize an agent to change the human-set status/);
  assert.match(eligibility, /higher Severity, wider scope, or a non-equivalent test basis/);
  assert.match(eligibility, /Preserve that status and the recorded reason/);
  assert.match(proposalContract, /current evidence voids its acceptance/);
  assert.match(proposalContract, /Preserve the human-set status and reason/);
});

test("lane prohibition is scoped to trackers, not all external services", async () => {
  const [reference, skill] = await Promise.all([
    readRepositoryFile("qa-suite/references/issue-proposals.md"),
    readRepositoryFile("qa-suite/SKILL.md"),
  ]);
  const authorization = normalizeWhitespace(
    extractSection(reference, "## Authorization boundary"),
  );
  const hardBoundaries = normalizeWhitespace(
    extractSection(skill, "## Hard boundaries (all agents, all platforms)"),
  );

  assert.match(authorization, /external tracker service/);
  assert.match(hardBoundaries, /external tracker service/);
  assert.doesNotMatch(authorization, /contact an external service/);
  assert.doesNotMatch(hardBoundaries, /contact an external service/);
});
