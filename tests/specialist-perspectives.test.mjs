import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const laneDefinitions = [
  {
    name: "smoke-qa",
    perspective: "Release verification engineer",
    contractPattern: /release verification engineer/,
    question:
      "Does this build come up and do the declared critical paths respond?",
  },
  {
    name: "regression-qa",
    perspective: "Regression and change-impact QA engineer",
    contractPattern: /regression and change-impact QA engineer/,
    question: "Did this change break something that worked?",
  },
  {
    name: "bob-qa",
    perspective: "End-user behavior, usability, and accessibility reviewer",
    contractPattern: /end-user behavior, usability, and\s+accessibility reviewer/,
    question: "Is the UI/UX usable and accessible for a fresh user?",
  },
  {
    name: "performance-qa",
    perspective: "Performance and reliability QA engineer",
    contractPattern: /performance and reliability QA\s+engineer/,
    question: "Is it fast enough, and is that getting worse?",
  },
  {
    name: "security-qa",
    perspective:
      "Application security QA engineer performing a hygiene review",
    contractPattern: /application security QA engineer/,
    question: "Are there any cheap-to-catch security hygiene issues?",
  },
  {
    name: "api-qa",
    perspective: "API contract and integration QA engineer",
    contractPattern: /API contract and integration QA\s+engineer/,
    question: "Does the API honor its contract, independent of the UI?",
  },
  {
    name: "compatibility-qa",
    perspective: "Platform compatibility QA engineer",
    contractPattern: /platform compatibility QA engineer/,
    question: "Does it behave the same across the platform matrix?",
  },
];

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

function extractTableRows(markdown, heading) {
  return extractSection(markdown, heading)
    .split("\n")
    .filter((line) => line.startsWith("|") && !line.includes("---"))
    .slice(1)
    .map((line) =>
      line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.replaceAll("`", "").replace(/\s+/g, " ").trim()),
    );
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

test("every shipped lane applies the validated specialist contract", async () => {
  const lanes = await Promise.all(
    laneDefinitions.map(async (definition) => ({
      definition,
      markdown: await readRepositoryFile(
        `qa-suite/references/agents/${definition.name}.md`,
      ),
    })),
  );

  for (const { definition, markdown } of lanes) {
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
        `${definition.name} needs exactly one ${field} field`,
      );
    }

    assert.match(
      extractField(contract, "Specialist perspective"),
      definition.contractPattern,
      definition.name,
    );
    assert.equal(
      extractField(contract, "Primary question"),
      definition.question,
      definition.name,
    );
    assert.match(extractField(contract, "Priorities"), /\S/, definition.name);
    assert.match(
      extractField(contract, "Decision rules"),
      /Confirm|A number without/,
      definition.name,
    );
    assert.match(
      extractField(contract, "Decision rules"),
      /assumptions/i,
      definition.name,
    );
    assert.match(
      extractField(contract, "Decision rules"),
      /verdict-neutral/,
      definition.name,
    );
    assert.match(
      extractField(contract, "Evidence requirements"),
      /\S/,
      definition.name,
    );
    assert.match(
      extractField(contract, "Scope exclusions and escalation"),
      /Do not|Never/,
      definition.name,
    );

    const isolation = extractSection(markdown, "## Isolation");
    assert.match(isolation, /Specialist dispatch envelope/, definition.name);
    assert.match(isolation, /Mission modes/, definition.name);
    assert.match(
      isolation,
      /Lane\s+identity never changes its visibility/,
      definition.name,
    );

    const reports = extractSection(markdown, "## Reports");
    assert.match(reports, /\*\*Assumptions\*\*/, definition.name);
    assert.match(reports, /Assumptions are not findings/, definition.name);
  }
});

test("primary questions and perspectives match both public indexes", async () => {
  const [skill, readme] = await Promise.all([
    readRepositoryFile("qa-suite/SKILL.md"),
    readRepositoryFile("README.md"),
  ]);
  const skillRows = new Map(
    extractTableRows(skill, "## The agents").map((row) => [row[0], row]),
  );
  const readmeRows = new Map(
    extractTableRows(readme, "## Agents").map((row) => [row[0], row]),
  );

  assert.equal(skillRows.size, laneDefinitions.length);
  assert.equal(readmeRows.size, laneDefinitions.length);

  for (const definition of laneDefinitions) {
    const skillRow = skillRows.get(definition.name);
    const readmeRow = readmeRows.get(definition.name);

    assert.deepEqual(
      skillRow?.slice(1, 3),
      [definition.perspective, definition.question],
      `${definition.name} SKILL index`,
    );
    assert.equal(
      skillRow?.[3],
      `references/agents/${definition.name}.md`,
      `${definition.name} canonical path`,
    );
    assert.deepEqual(
      readmeRow?.slice(1, 3),
      [definition.perspective, definition.question],
      `${definition.name} README index`,
    );
  }
});

test("mission context preserves fresh discovery and authorized lifecycle inputs", async () => {
  const [bob, regression] = await Promise.all([
    readRepositoryFile("qa-suite/references/agents/bob-qa.md"),
    readRepositoryFile("qa-suite/references/agents/regression-qa.md"),
  ]);

  assert.match(bob, /In a discovery mission, start as if you have never seen/);
  assert.match(
    bob,
    /A confirmation mission may supply only\s+its authorized finding manifest/,
  );
  assert.match(bob, /use it as test basis, not as proof/);
  assert.match(
    bob,
    /lifecycle context authorized for the current mission/,
  );
  assert.match(
    regression,
    /graduated regression corpus only in a regression mission/,
  );
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
  assert.match(envelope, /declared candidate, and resolved platform/);
  assert.match(
    envelope,
    /canonical verdict\/report and hard-boundary sections/,
  );
  assert.match(envelope, /Verbatim dispatch/);
  assert.match(envelope, /Post-fix lifecycle — Mission modes/);
  assert.match(envelope, /Mission mode, never lane identity/);
  assert.match(envelope, /keeps lane-selection reasons in\s+its own record/);
  assert.match(envelope, /does not add a biography, fictional credentials/);
  assert.doesNotMatch(envelope, /^-\s+lane-selection reason/im);

  const workflow = extractSection(skill, "## Workflow");
  assert.match(
    workflow,
    /expected outcomes outside the lifecycle context permitted for\s+the current mission/,
  );
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
  assert.match(synthesis, /Contract-defined defaults.*declared test\s+inputs/s);
  assert.match(synthesis, /safe, redacted supporting evidence references/);
});

test("Claude wrappers remain thin, isolated, and report-write-only", async () => {
  const wrappers = await Promise.all(
    laneDefinitions.map(async ({ name }) => ({
      name,
      markdown: await readRepositoryFile(`.claude/agents/${name}.md`),
    })),
  );

  for (const { name, markdown } of wrappers) {
    assert.match(
      markdown,
      new RegExp(`qa-suite/references/agents/${name}\\.md`),
      name,
    );
    assert.match(markdown, /complete\s+instruction set/, name);
    assert.match(markdown, /project-visible\s+evidence/, name);
    assert.match(
      markdown,
      /Stay\s+read-only except your own report\s+and\s+evidence files/,
      name,
    );
    assert.match(markdown, /finding\s+ledger/, name);
    assert.match(markdown, /git state/, name);
    assert.doesNotMatch(
      markdown,
      /not what (?:it|the software) was meant to do/,
      name,
    );
  }
});

test("standalone Smoke templates mirror the validated specialist contract", async () => {
  const templates = await Promise.all([
    readRepositoryFile("qa-suite/assets/project-agent-smoke-qa.claude.md"),
    readRepositoryFile("qa-suite/assets/project-agent-smoke-qa.codex.toml"),
  ]);

  for (const template of templates) {
    assert.match(template, /simulate a release verification engineer/i);
    assert.match(
      template,
      /does this build\s+come up and do the declared critical paths respond\?/i,
    );
    assert.match(template, /specialist mission/i);
    assert.match(template, /lifecycle mission/i);
    assert.match(
      template,
      /Without a canonical qa-suite orchestrator envelope, lifecycle mission is\s+[`]?discovery[`]?/,
    );
    assert.match(
      template,
      /no finding manifest or regression corpus is allowed/,
    );
    assert.match(
      template,
      /Accept\s+[`]?confirmation[`]? or [`]?regression[`]? only when a qa-suite orchestrator/,
    );
    assert.match(template, /canonical mission context under the installed skill/);
    assert.match(template, /Assumptions\s+section/);
    assert.match(template, /never count an assumption as a\s+finding/);
  }
});

test("specialist rollout preserves lane-specific decision boundaries", async () => {
  const laneMarkdown = Object.fromEntries(
    await Promise.all(
      laneDefinitions.map(async ({ name }) => [
        name,
        await readRepositoryFile(`qa-suite/references/agents/${name}.md`),
      ]),
    ),
  );

  assert.match(
    laneMarkdown["smoke-qa"],
    /does not accept a dispatch\s+time-box override/,
  );
  assert.match(laneMarkdown["smoke-qa"], /Stop at the first hard failure/);
  assert.match(
    laneMarkdown["regression-qa"],
    /Run the full automated suite first/,
  );
  assert.match(laneMarkdown["regression-qa"], /2–3 times/);
  assert.match(laneMarkdown["bob-qa"], /15-minute.*60-minute/s);
  assert.match(laneMarkdown["bob-qa"], /NEVER read implementation source/);
  assert.match(
    laneMarkdown["performance-qa"],
    /a number without a baseline is not a finding/,
  );
  assert.match(laneMarkdown["performance-qa"], /p50\/p95/);
  assert.match(laneMarkdown["security-qa"], /No active exploitation/);
  assert.match(laneMarkdown["security-qa"], /not a penetration test/);
  assert.match(
    laneMarkdown["api-qa"],
    /no backend API, say so immediately and stop/,
  );
  assert.match(laneMarkdown["api-qa"], /literal sanitized request and\s+response/);
  assert.match(
    laneMarkdown["api-qa"],
    /prohibited values replaced by `<redacted>`/,
  );
  assert.match(
    laneMarkdown["compatibility-qa"],
    /Only claim coverage for combinations you actually ran/,
  );
  assert.match(
    laneMarkdown["compatibility-qa"],
    /evidence-supported cause hypothesis, clearly labeled/,
  );
});

test("specialist roles do not inflate confidence or claim qualifications", async () => {
  const [skill, readme] = await Promise.all([
    readRepositoryFile("qa-suite/SKILL.md"),
    readRepositoryFile("README.md"),
  ]);
  const principles = extractSection(skill, "## Design principles");

  assert.match(principles, /semantic steering, not credentials/);
  assert.match(principles, /certification, guaranteed expertise/);
  assert.match(principles, /title never raises confidence/);
  assert.match(readme, /perspectives are\s+semantic steering/);
  assert.match(readme, /not credentials, certification, guaranteed\s+expertise/);
  assert.match(readme, /evidence outrank the role title/);
  assert.match(readme, /final release assessment/);
});

test("authorized audience fallback and sensitive output stay distinct", async () => {
  const [skill, bob, api, template, readme] = await Promise.all([
    readRepositoryFile("qa-suite/SKILL.md"),
    readRepositoryFile("qa-suite/references/agents/bob-qa.md"),
    readRepositoryFile("qa-suite/references/agents/api-qa.md"),
    readRepositoryFile("qa-suite/assets/qa-context-template.md"),
    readRepositoryFile("README.md"),
  ]);
  const reports = extractSection(skill, "## Reports");

  assert.match(
    bob,
    /contract-defined\s+\"general end user\" fallback/,
  );
  assert.match(bob, /declared test input, not an assumption/);
  assert.match(template, /contract-defined \"general end user\" fallback/);

  assert.match(reports, /Sensitive output is redacted/);
  for (const prohibited of [
    "credentials",
    "tokens",
    "session or cookie values",
    "personal data",
    "private user identifiers",
    "signed URLs",
  ]) {
    assert.match(reports, new RegExp(prohibited));
  }
  assert.match(reports, /replace prohibited\s+values with `<redacted>`/);
  assert.match(api, /literal sanitized request and\s+response/);
  assert.match(api, /output-redaction rule/);
  assert.match(readme, /redacting credentials, sessions, personal data/);
});
