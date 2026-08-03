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

function extractField(section, field) {
  const marker = `- **${field}:**`;
  const start = section.indexOf(marker);

  assert.notEqual(start, -1, `missing field: ${field}`);

  const remainder = section.slice(start + marker.length);
  const nextField = /^\s*-\s+\*\*[^*]+:\*\*/m.exec(remainder);
  const value = nextField ? remainder.slice(0, nextField.index) : remainder;

  return value.replace(/\s+/g, " ").trim();
}

test("data-integrity QA defines one bounded specialist contract", async () => {
  const markdown = await readRepositoryFile(
    "qa-suite/references/agents/data-integrity-qa.md",
  );
  const contract = extractSection(markdown, "## Specialist contract");

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
      `data-integrity-qa needs exactly one ${field} field`,
    );
  }

  assert.equal(
    extractField(contract, "Specialist perspective"),
    "Simulate a data integrity QA engineer.",
  );
  assert.equal(
    extractField(contract, "Primary question"),
    "Do writes, migrations, concurrency, backup, and recovery preserve the expected data state?",
  );
  assert.match(contract, /assumptions explicit and verdict-neutral/);
  assert.match(contract, /before\/after counts/);
  assert.match(contract, /digests/);
  assert.match(contract, /invariant-query results/);
  assert.match(contract, /synthetic data/);

  const selection = extractSection(markdown, "## Selection");
  for (const trigger of [
    /writes or multi-step transactions/,
    /concurrent operations/,
    /schema or data migrations/,
    /import or export/,
    /backup or restore/,
    /interruption and data recovery/,
  ]) {
    assert.match(selection, trigger);
  }
  assert.match(selection, /existence does not imply execution/);
  assert.match(selection, /after a\s+Go-family smoke verdict/);
  assert.match(selection, /smoke-qa owns startup and the critical-flow gate/);

  const timeBox = extractSection(markdown, "## Time box");
  assert.match(timeBox, /default wall-clock time box is 60 minutes/);
  assert.match(timeBox, /explicit recorded override from 15 through 240\s+minutes/);
  assert.doesNotMatch(timeBox, /different positive limit\s+for/);
});

test("data-integrity QA requires runtime proof on isolated synthetic state", async () => {
  const markdown = await readRepositoryFile(
    "qa-suite/references/agents/data-integrity-qa.md",
  );
  const contract = extractSection(markdown, "## Specialist contract");
  const safety = extractSection(markdown, "## Safety boundaries");
  const method = extractSection(markdown, "## Test method");

  assert.match(contract, /Static inspection.*cannot prove runtime/s);
  assert.match(method, /successful command.*is not\s+proof of data integrity/s);
  assert.match(method, /counts, digests, invariant-query results, or\s+equivalent proof/s);
  assert.match(method, /restore a copy into a fresh disposable\s+store/s);
  assert.match(method, /cannot establish.*preserved or corrupted\s+data/s);

  assert.match(safety, /Disposable test target/);
  assert.match(safety, /synthetic data created for the run/);
  assert.match(safety, /Never mutate production, a shared environment, owner data/);
  assert.match(safety, /Never alter an original backup/);
  assert.match(safety, /Never delete a volume, database, backup, or user data/);
  assert.match(safety, /Mark the affected flow `Observed only`/);
  assert.match(safety, /canonical `Blocked`\s+disposition/s);

  const isolation = extractSection(markdown, "## Isolation");
  assert.match(isolation, /Specialist dispatch envelope/);
  assert.match(isolation, /Mission modes/);
  assert.match(isolation, /Lane identity\s+never changes its visibility/);
});

test("data-integrity QA owns stored state without absorbing sibling lanes", async () => {
  const markdown = await readRepositoryFile(
    "qa-suite/references/agents/data-integrity-qa.md",
  );
  const boundaries = extractSection(markdown, "## Ownership boundaries");

  const ownership = new Map([
    ["api-qa", /owns request\/response shape, status semantics, and the API\s+contract/],
    ["deployment-qa", /owns configuration, artifact identity, rollout, health\s+verification, and rollback procedure/],
    ["security-qa", /owns unauthorized access, exposure, and malicious\s+modification/],
    ["reliability-qa", /owns service failure, degradation, recovery, and alerts/],
    ["regression-qa", /owns historical and change attribution/],
  ]);

  for (const [lane, pattern] of ownership) {
    assert.match(boundaries, new RegExp(`\\*\\*${lane}\\*\\*`));
    assert.match(boundaries, pattern);
  }

  assert.match(boundaries, /demonstrated stored-state consequence/);
  assert.match(boundaries, /data\s+remains correct/);
  assert.match(boundaries, /accidental corruption, atomicity, and\s+durability/);
  assert.match(boundaries, /state consistency after interruption or recovery/);
  assert.match(boundaries, /current data-integrity failure class and evidence/);
  assert.match(boundaries, /Do not duplicate a\s+finding or change its Severity/);
});

test("data-integrity reports use the canonical verdict and ledger lifecycle", async () => {
  const markdown = await readRepositoryFile(
    "qa-suite/references/agents/data-integrity-qa.md",
  );
  const reports = extractSection(markdown, "## Reports");
  const normalized = reports.replace(/\s+/g, " ");

  assert.match(reports, /YYYY-MM-DD-HHMM-data-integrity-/);
  assert.match(reports, /one report-level state from the canonical vocabulary/);
  assert.match(reports, /\*\*Environment\*\*/);
  assert.match(reports, /time box or explicit override/);
  assert.match(reports, /\*\*Assumptions\*\*/);
  assert.match(reports, /Assumptions are not findings/);
  assert.match(reports, /\*\*Not tested\*\*/);
  assert.doesNotMatch(reports, /confidence/i);
  assert.doesNotMatch(reports, /per-finding verdict/i);

  for (const field of [
    "report-local proposal ID",
    "component",
    "location",
    "oracle",
    "severity",
    "priority",
    "sanitized ordered repro steps",
    "expected result",
    "actual result",
    "environment",
    "safe evidence reference",
    "sensitivity classification proposal",
    "demonstrated data impact",
    "recommendation",
    "validation",
  ]) {
    assert.match(normalized, new RegExp(field));
  }

  assert.match(normalized, /supplied ledger ID/);
  assert.match(normalized, /confirmation missions.*Confirmation dispositions/);
  assert.match(normalized, /Apply `Blocked` as defined there, including its mutation-dependent rule/);
  assert.match(normalized, /recurrence.*finding proposal linked to the supplied ledger ID.*orchestrator matches it.*`regressed` transition/);
  assert.match(normalized, /Only newly observed different behavior is a separate finding proposal/);
  assert.match(normalized, /N\/A — discovery mission/);
  assert.match(normalized, /does not read or write the finding ledger/);
  assert.match(normalized, /orchestrator validates and matches proposals, assigns stable IDs and statuses, and reconciles the ledger/);
});
