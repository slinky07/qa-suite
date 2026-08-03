import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const recordPath = "evaluation/issue-86-real-engine-coverage.md";

function readRecord() {
  return readFile(new URL(recordPath, import.meta.url), "utf8");
}

function extractSection(markdown, heading) {
  const marker = `${heading}\n`;
  const start = markdown.indexOf(marker);

  assert.notEqual(start, -1, `missing section: ${heading}`);

  const contentStart = start + marker.length;
  const level = heading.match(/^#+/u)[0].length;
  const remainder = markdown.slice(contentStart);
  const nextHeading = new RegExp(`^#{1,${level}}[ \\t]+`, "mu").exec(
    remainder,
  );

  return nextHeading ? remainder.slice(0, nextHeading.index) : remainder;
}

function normalizeCell(cell) {
  return cell.trim().replace(/^`|`$/gu, "");
}

function parseTable(section) {
  const lines = section
    .split("\n")
    .filter((line) => line.startsWith("|"))
    .map((line) => line.split("|").slice(1, -1).map(normalizeCell));

  assert.ok(lines.length >= 3, "expected a Markdown table with data rows");

  const [headers, separator, ...rows] = lines;
  assert.ok(
    separator.every((cell) => /^:?-{3,}:?$/u.test(cell)),
    "expected a Markdown table separator",
  );

  return rows.map((cells) =>
    Object.fromEntries(headers.map((header, index) => [header, cells[index]])),
  );
}

function frozenCandidate(record) {
  const identities = extractSection(record, "## Frozen identities");
  const match = identities.match(
    /Controller and subject commit \| `([0-9a-f]{40})`/u,
  );

  assert.ok(match, "missing frozen controller and subject commit");
  return match[1];
}

test("Issue 86 separates engine, viewport, and device evidence", async () => {
  const record = await readRecord();
  const method = extractSection(record, "## Evidence-class method");

  assert.match(method, /\*\*Engine evidence\*\*.*actual browser-engine process/su);
  assert.match(method, /\*\*Viewport evidence\*\*.*CSS viewport/su);
  assert.match(method, /\*\*Device evidence\*\*.*physical-device/su);
  assert.match(
    method,
    /does not establish physical-device\s+coverage/su,
  );
  assert.match(
    method,
    /Playwright WebKit.*not be\s+Safari-product, iOS-simulator, or physical-iOS-device evidence/su,
  );
  assert.match(method, /simulator.*not establish physical-device/su);
});

test("Issue 86 reviewed matrix is complete and candidate-bound", async () => {
  const record = await readRecord();
  const candidate = frozenCandidate(record);
  const matrix = parseTable(extractSection(record, "## Declared matrix"));
  const results = parseTable(
    extractSection(record, "## Reviewed target results"),
  );
  const matrixIds = matrix.map((row) => row["Target ID"]);
  const resultIds = results.map((row) => row["Target ID"]);

  assert.match(candidate, /^[0-9a-f]{40}$/u);
  assert.equal(new Set(matrixIds).size, matrixIds.length);
  assert.equal(new Set(resultIds).size, resultIds.length);
  assert.deepEqual(new Set(resultIds), new Set(matrixIds));

  const matrixById = new Map(matrix.map((row) => [row["Target ID"], row]));
  const passingEngines = new Set();

  for (const result of results) {
    assert.equal(result["Candidate SHA"], candidate);
    assert.match(result.State, /^(?:Pass|Blocked)$/u);
    assert.ok(result["Observed behavior"]);
    assert.ok(result["Captured evidence anchor"]);
    assert.ok(result["Material limitation"]);

    const declaration = matrixById.get(result["Target ID"]);
    assert.ok(declaration, `undeclared target: ${result["Target ID"]}`);

    for (const field of [
      "Browser/runtime",
      "Engine family",
      "Device or simulator class",
      "Viewport mode",
      "Input mode",
      "Intended evidence claim",
    ]) {
      assert.ok(declaration[field], `missing ${field} for ${result["Target ID"]}`);
    }

    if (result.State === "Pass") {
      passingEngines.add(declaration["Engine family"]);
    }
  }

  assert.ok(
    passingEngines.size >= 2,
    "completed coverage requires at least two actual engine families",
  );
});

test("Issue 86 keeps unavailable targets and evaluator claims honest", async () => {
  const record = await readRecord();
  const gaps = parseTable(extractSection(record, "## Coverage gaps"));
  const nonClaims = extractSection(record, "## Preserved non-claims");

  for (const gap of gaps) {
    assert.match(gap.State, /^(?:Not tested|Blocked)$/u);
    assert.ok(gap["Reason or blocker"]);
    assert.ok(gap["Claim impact"]);
    assert.ok(gap["Unblock condition"]);
  }

  assert.ok(gaps.some((gap) => gap["Gap target"] === "webkit-1440"));
  assert.ok(gaps.some((gap) => gap["Gap target"] === "physical-mobile"));
  assert.ok(gaps.some((gap) => gap["Gap target"] === "touch-hardware"));
  assert.ok(gaps.some((gap) => gap["Gap target"] === "mobile-simulator"));

  assert.match(record, /run_0fa9b32fa912f304fb87d1d51648f067/gu);
  assert.match(record, /Controller closure `invalid`/gu);
  assert.match(record, /does not define a reusable device\s+lab/gu);
  assert.match(nonClaims, /verification_status: "unverified"/gu);
  assert.match(nonClaims, /qualification: "not-evidence"/gu);
  assert.match(nonClaims, /result: null/gu);
  assert.doesNotMatch(nonClaims, /verification_status: "verified"/gu);
});
