import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const lanePaths = [
  "qa-suite/references/agents/api-qa.md",
  "qa-suite/references/agents/bob-qa.md",
  "qa-suite/references/agents/compatibility-qa.md",
  "qa-suite/references/agents/data-integrity-qa.md",
  "qa-suite/references/agents/deployment-qa.md",
  "qa-suite/references/agents/performance-qa.md",
  "qa-suite/references/agents/regression-qa.md",
  "qa-suite/references/agents/reliability-qa.md",
  "qa-suite/references/agents/security-qa.md",
  "qa-suite/references/agents/smoke-qa.md",
];

function readRepositoryFile(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

function normalizeWhitespace(text) {
  return text.replace(/\s+/g, " ").trim();
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

test("controlled report prose is one central evidence-preserving contract", async () => {
  const skill = await readRepositoryFile("qa-suite/SKILL.md");
  const reports = normalizeWhitespace(extractSection(skill, "## Reports"));

  assert.equal(
    reports.match(/\*\*Controlled report prose\.\*\*/g)?.length,
    1,
  );
  assert.match(
    reports,
    /selected ASD-STE100 Issue 9 principles.*original.*prose/s,
  );
  assert.match(reports, /not.*formal ASD-STE100 conformance/s);
  assert.match(reports, /short, clear sentences/);
  assert.match(reports, /active voice/);
  assert.match(reports, /one fact per sentence/);
  assert.match(reports, /one stable term for each concept/);
  assert.match(
    reports,
    /result, evidence, impact, limitation, or necessary action/,
  );
  assert.match(
    reports,
    /introductions, praise, conversational filler, repeated verdicts,\s+duplicated evidence, and narration of routine test steps/,
  );
  assert.match(reports, /routine passing checks.*compact tables or lists/s);
  assert.match(
    reports,
    /detailed prose only for findings, blockers, `Observed only` flows, and\s+material limitations/,
  );
  assert.match(reports, /Do not shorten or omit.*finding or blocker/s);

  for (const exactText of [
    "Canonical verdicts",
    "identifiers",
    "commands",
    "paths",
    "quotations",
    "logs",
    "measurements",
    "sanitized request/response data",
    "official standard names",
    "exact technical evidence",
  ]) {
    assert.match(reports, new RegExp(exactText));
  }

  assert.match(reports, /does not impose a fixed report length/);
  assert.match(reports, /does not remove required report sections/);
});

test("public docs and standalone Smoke templates mirror controlled prose", async () => {
  const [rawReadme, ...rawTemplates] = await Promise.all([
    readRepositoryFile("README.md"),
    readRepositoryFile("qa-suite/assets/project-agent-smoke-qa.claude.md"),
    readRepositoryFile("qa-suite/assets/project-agent-smoke-qa.codex.toml"),
  ]);
  const readme = normalizeWhitespace(
    extractSection(rawReadme, "## Design Principles"),
  );
  const templates = rawTemplates.map(normalizeWhitespace);

  assert.match(readme, /selected ASD-STE100 Issue 9 principles/);
  assert.match(readme, /not formal ASD-STE100 conformance/);
  assert.match(readme, /Routine passes use compact tables or lists/);
  assert.match(readme, /Findings and blockers retain their supporting evidence/);
  assert.match(readme, /Exact technical text is not rewritten/);

  for (const template of templates) {
    assert.match(template, /selected ASD-STE100 Issue 9 principles/);
    assert.match(template, /not formal ASD-STE100 conformance/);
    assert.match(template, /compact checklist/);
    assert.match(
      template,
      /Do not add introductions, praise, repeated verdicts or evidence, or\s+narration of routine steps/,
    );
    assert.match(
      template,
      /Preserve exact canonical verdicts, identifiers, commands, paths, logs,\s+and measurements/,
    );
    assert.match(
      template,
      /Every prose sentence must provide a result, evidence, impact, limitation,\s+or necessary action/,
    );
    assert.match(template, /Do not shorten or omit blocking evidence/);
  }
});

test("lane report schemas defer to the central rule and avoid open-ended narrative", async () => {
  const [skill, ledger, ...lanes] = await Promise.all([
    readRepositoryFile("qa-suite/SKILL.md"),
    readRepositoryFile("qa-suite/references/finding-ledger.md"),
    ...lanePaths.map(readRepositoryFile),
  ]);

  for (const lane of lanes) {
    assert.doesNotMatch(lane, /ASD-STE100/);
  }

  const synthesis = normalizeWhitespace(
    extractSection(skill, "### Specialist synthesis"),
  );
  const verdictSelection = synthesis.indexOf(
    "applies valid risk acceptance and the most conservative verdict",
  );
  const finalSummary = synthesis.indexOf(
    "writes the final verdict on line one",
  );

  assert.ok(verdictSelection >= 0);
  assert.ok(finalSummary > verdictSelection);
  assert.match(synthesis, /each completed lane once/);
  assert.match(synthesis, /compact lane-results table/);
  assert.match(synthesis, /report reference, and any material limitation/);
  assert.match(synthesis, /without copying lane evidence/);
  assert.match(
    synthesis,
    /`Final assessment`.*only material impact, limitation, or necessary action/,
  );
  assert.match(
    synthesis,
    /does not repeat the final verdict, lane verdicts, or evidence/,
  );

  const bob =
    lanes[lanePaths.indexOf("qa-suite/references/agents/bob-qa.md")];
  const bobReports = normalizeWhitespace(extractSection(bob, "## Reports"));
  assert.doesNotMatch(bob, /fold them into the onboarding narrative/);
  assert.doesNotMatch(bobReports, /Narrative allowed here/);
  assert.match(
    bobReports,
    /Onboarding result.*brief result.*finding, blocker, `Observed only` flow, or material limitation/s,
  );
  assert.match(bobReports, /Supporting tables reference finding IDs/);
  assert.doesNotMatch(bobReports, /observation IDs/);
  assert.match(
    bobReports,
    /Functional QA.*finding or evidence reference for a non-pass result/,
  );
  assert.match(
    bobReports,
    /`Findings` and `Fresh-user observations` own the supporting detail/,
  );

  const compatibilityReports = normalizeWhitespace(
    extractSection(
      lanes[
        lanePaths.indexOf(
          "qa-suite/references/agents/compatibility-qa.md",
        )
      ],
      "## Reports",
    ),
  );
  assert.match(
    compatibilityReports,
    /Coverage claimed.*combinations ran.*emulated\/simulated/,
  );
  assert.match(
    compatibilityReports,
    /Not tested.*skipped combinations and why/,
  );
  assert.match(
    compatibilityReports,
    /Results matrix.*evidence reference or finding ID/,
  );

  const performanceReports = normalizeWhitespace(
    extractSection(
      lanes[
        lanePaths.indexOf("qa-suite/references/agents/performance-qa.md")
      ],
      "## Reports",
    ),
  );
  assert.match(performanceReports, /Results.*including CPU\/memory trend/);
  assert.match(performanceReports, /delta \| result \| finding ID/);
  assert.match(
    performanceReports,
    /Findings.*result-row reference.*full supporting evidence/,
  );

  const securityReports = normalizeWhitespace(
    extractSection(
      lanes[lanePaths.indexOf("qa-suite/references/agents/security-qa.md")],
      "## Reports",
    ),
  );
  assert.match(securityReports, /Dependency scan.*finding ID when failed/);
  assert.match(securityReports, /Checklist results.*finding ID/);
  assert.match(
    securityReports,
    /Not tested.*single material limitation.*not a penetration test/s,
  );
  assert.match(
    securityReports,
    /auth bypass attempts.*injection.*session fixation/s,
  );

  assert.doesNotMatch(ledger, /One narrative for one lane run/);
  assert.match(ledger, /One immutable lane-run record/);
});
