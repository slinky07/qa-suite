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

test("Security QA pilots the complete specialist contract", async () => {
  const security = await readRepositoryFile(
    "qa-suite/references/agents/security-qa.md",
  );
  const contract = extractSection(security, "## Specialist contract");

  for (const field of [
    "Specialist perspective",
    "Primary question",
    "Specialist mission",
    "Priorities",
    "Decision rules",
    "Evidence requirements",
    "Scope exclusions and escalation",
  ]) {
    assert.equal(
      contract.split(`**${field}:**`).length - 1,
      1,
      `Security QA needs exactly one ${field} field`,
    );
  }

  assert.match(contract, /application security QA engineer/);
  assert.match(
    contract,
    /Are there any cheap-to-catch security hygiene issues\?/,
  );
  assert.match(contract, /assumptions explicit and verdict-neutral/);
  assert.match(contract, /platform check ID, named project oracle/);
  assert.match(contract, /Never exploit, claim compliance/);
  assert.match(contract, /Stop and alert the user immediately/);

  const isolation = extractSection(security, "## Isolation");
  assert.match(isolation, /Specialist dispatch envelope/);
  assert.match(isolation, /Mission modes/);
  assert.match(isolation, /Lane\s+identity never changes its visibility/);

  const reports = extractSection(security, "## Reports");
  assert.match(reports, /\*\*Assumptions\*\*/);
  assert.match(reports, /Assumptions are not findings/);
});

test("specialist dispatch keeps lifecycle mission separate and neutral", async () => {
  const skill = await readRepositoryFile("qa-suite/SKILL.md");
  const envelope = extractSection(
    skill,
    "### Specialist dispatch envelope",
  );

  assert.match(envelope, /specialist mission.*stable purpose/s);
  assert.match(envelope, /dispatch field `mission`.*separate lifecycle/s);
  assert.match(envelope, /`discovery`, `confirmation`, or `regression`/);
  assert.match(envelope, /canonical primary question/);
  assert.match(envelope, /Verbatim dispatch/);
  assert.match(envelope, /Post-fix lifecycle — Mission modes/);
  assert.match(envelope, /Mission mode, never lane identity/);
  assert.match(envelope, /keeps lane-selection reasons in\s+its own record/);
  assert.match(envelope, /does not add a biography, fictional credentials/);
});

test("specialist synthesis validates, deduplicates, and exposes conflicts", async () => {
  const skill = await readRepositoryFile("qa-suite/SKILL.md");
  const synthesis = extractSection(skill, "### Specialist synthesis");

  assert.match(synthesis, /validates every proposed finding/);
  assert.match(synthesis, /keeps unsupported premises under `Assumptions`/);
  assert.match(synthesis, /conservative finding-ledger matching contract/);
  assert.match(synthesis, /duplicate findings/);
  assert.match(synthesis, /confirmation disposition.*not as a second new finding/s);
  assert.match(synthesis, /genuinely new finding/);
  assert.match(synthesis, /conflicting factual conclusions or recommendations/);
  assert.match(synthesis, /Final release assessment/);
  assert.match(synthesis, /Assumptions never count as findings/);
});

test("specialist roles do not inflate confidence or claim qualifications", async () => {
  const skill = await readRepositoryFile("qa-suite/SKILL.md");
  const principles = extractSection(skill, "## Design principles");

  assert.match(principles, /semantic steering, not credentials/);
  assert.match(principles, /certification, guaranteed expertise/);
  assert.match(principles, /title never raises confidence/);
});
