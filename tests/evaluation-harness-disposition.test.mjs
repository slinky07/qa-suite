import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

async function readRepositoryFile(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
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

function normalizeWhitespace(value) {
  return value.replace(/\s+/gu, " ").trim();
}

test(
  "maintainer evaluation tiers keep their active and frozen dispositions",
  async () => {
    const [codemap, readme] = await Promise.all([
      readRepositoryFile("scripts/evaluation/CODEMAP.md"),
      readRepositoryFile("tests/evaluation/README.md"),
    ]);
    const tiers = normalizeWhitespace(extractSection(codemap, "## Tiers"));
    const disposition = normalizeWhitespace(
      extractSection(readme, "## Maintainer evaluation harness disposition"),
    );

    assert.match(tiers, /Tier A — active and maintained/u);
    assert.match(tiers, /Tier F — frozen reference/u);
    assert.match(tiers, /Only the repository owner may authorize/u);
    assert.match(tiers, /record `Blocked` with evidence/u);
    assert.match(disposition, /Tier A remains active and maintained/u);
    assert.match(disposition, /Tier F is a frozen reference/u);
    assert.match(disposition, /Only the repository owner may authorize/u);
    assert.match(disposition, /filed issue with the exact evidence contract/u);
    assert.match(disposition, /Invocation is as-is/u);
    assert.match(disposition, /record `Blocked` with the failure evidence/u);
    assert.match(disposition, /instead of patching it opportunistically/u);
  },
);

test(
  "recurring semantic runs stay de-scoped until all claims are proven",
  async () => {
    const readme = await readRepositoryFile("tests/evaluation/README.md");
    const disposition = normalizeWhitespace(
      extractSection(readme, "## Maintainer evaluation harness disposition"),
    );

    assert.match(
      disposition,
      /Recurring semantic runs are explicitly de-scoped/u,
    );
    assert.match(
      disposition,
      /No scheduler, release gate, or recurring semantic automation is authorized/u,
    );
    assert.match(
      disposition,
      /separately reviewed qualifying host and sandbox-adapter path proves/u,
    );
    assert.match(disposition, /provider\/model\/tool identity/u);
    assert.match(disposition, /sandbox qualification/u);
    assert.match(disposition, /exact candidate and controller identity/u);
    assert.match(disposition, /closed report binding and semantic parity/u);
    assert.match(disposition, /semantic fixture and oracle opacity/u);
    assert.match(
      disposition,
      /hostile same-user, escaped-session, and process-tree containment/u,
    );
    assert.match(disposition, /every other qualifying limitation/u);
    assert.match(disposition, /verification_status: "unverified"/u);
    assert.match(disposition, /qualification: "not-evidence"/u);
    assert.match(disposition, /result: null/u);
  },
);
