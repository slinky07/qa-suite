import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parseJsonStrict } from "../qa-suite/scripts/finding-ledger.mjs";
import {
  createSpecialistEntry,
  initializeRegistry,
  registerSpecialist,
  resolveSpecialist,
  specialistDefinitionDigest,
  validateRegistryDocument,
  validateRegistryProject,
  validateRegistrySchema,
  validateSpecialistDefinition,
} from "../qa-suite/scripts/specialist-registry.mjs";

const repositoryRoot = new URL("../", import.meta.url);

function runGit(repository, ...args) {
  return execFileSync("git", args, {
    cwd: repository,
    encoding: "utf8",
    stdio: "pipe",
  });
}

function sha256(source) {
  return createHash("sha256").update(source).digest("hex");
}

function definition(overrides = {}) {
  return {
    slug: "cache-failover",
    specialist_perspective: "Cache failover QA engineer",
    primary_question:
      "Does cache failover preserve the documented recovery objective?",
    specialist_mission:
      "Test the bounded cache failover behavior without changing owner data.",
    priorities: ["Recovery objective", "State continuity"],
    decision_rules: [
      "Report runtime behavior only from an isolated exercised target.",
    ],
    evidence_requirements: [
      "Retain failure and recovery timestamps from the disposable target.",
    ],
    scope_exclusions: ["Do not test production or shared cache state."],
    selection_criteria: [
      "Select only when no shipped lane owns cache failover semantics.",
    ],
    definition_rationale:
      "The risk combines cache topology and application-specific recovery semantics.",
    time_box_minutes: 60,
    ...overrides,
  };
}

async function createTestRepository({
  registryPath = "qa-specialists.json",
  createRegistry = true,
  trackRegistry = true,
} = {}) {
  const repository = await mkdtemp(join(tmpdir(), "specialist-registry-test-"));
  runGit(repository, "init", "-q");
  await writeFile(
    join(repository, "qa-context.md"),
    `# QA Context

## Project

- **Report output folder:** QA/
- **Temporary specialist registry:** ${registryPath}

## Finding ledger

- **Path:** findings.jsonl
- **Repository visibility (\`repo_visibility\`):** public
- **Named components:** authentication
`,
  );
  await writeFile(join(repository, "findings.jsonl"), "");
  if (createRegistry) {
    await writeFile(
      join(repository, "qa-specialists.json"),
      `${JSON.stringify({ schema_version: 1, specialists: [] }, null, 2)}\n`,
    );
  }
  await writeFile(join(repository, ".gitignore"), "QA/\n");
  runGit(repository, "add", ".gitignore", "qa-context.md", "findings.jsonl");
  if (createRegistry && trackRegistry) {
    runGit(repository, "add", "qa-specialists.json");
  }
  return repository;
}

test("init creates the canonical empty registry without overwriting it", async (t) => {
  const repository = await createTestRepository({
    createRegistry: false,
    trackRegistry: false,
  });
  t.after(() => rm(repository, { recursive: true, force: true }));

  const initialized = await initializeRegistry({ repository });
  const canonical = `${JSON.stringify(
    { schema_version: 1, specialists: [] },
    null,
    2,
  )}\n`;
  assert.equal(
    await readFile(join(repository, "qa-specialists.json"), "utf8"),
    canonical,
  );
  assert.equal(initialized.digest, sha256(canonical));

  const entry = createSpecialistEntry(definition());
  const existing = `${JSON.stringify(
    { schema_version: 1, specialists: [entry] },
    null,
    2,
  )}\n`;
  await writeFile(join(repository, "qa-specialists.json"), existing);
  await initializeRegistry({ repository });
  assert.equal(
    await readFile(join(repository, "qa-specialists.json"), "utf8"),
    existing,
  );
});

test("registry schema and content-addressed identities are strict", async () => {
  const schema = parseJsonStrict(
    await readFile(
      new URL(
        "qa-suite/references/temporary-specialist-registry.schema.json",
        repositoryRoot,
      ),
      "utf8",
    ),
    "temporary-specialist-registry.schema.json",
  );
  validateRegistrySchema(schema);

  const original = definition();
  const reordered = Object.fromEntries(Object.entries(original).reverse());
  assert.equal(
    specialistDefinitionDigest(original),
    specialistDefinitionDigest(reordered),
  );
  const entry = createSpecialistEntry(original);
  assert.equal(
    entry.id,
    "temporary-qa-cache-failover-176207707c4da4b0ac0bee025bebb78a854165008f13d5fc03512f8e2c6d8c98",
  );
  assert.notEqual(
    specialistDefinitionDigest(original),
    specialistDefinitionDigest({
      ...original,
      priorities: [...original.priorities].reverse(),
    }),
  );
  assert.doesNotThrow(() =>
    validateRegistryDocument({ schema_version: 1, specialists: [entry] }),
  );

  const changed = createSpecialistEntry(
    definition({ priorities: ["Recovery objective"] }),
  );
  assert.notEqual(changed.id, entry.id);

  assert.throws(
    () => validateSpecialistDefinition({ ...original, tools: ["Bash"] }),
    /fields are .*tools/,
  );
  assert.throws(
    () => validateSpecialistDefinition(definition({ slug: "UPPER" })),
    /lowercase hyphenated slug/,
  );
  assert.throws(
    () => validateSpecialistDefinition(definition({ time_box_minutes: 241 })),
    /15 through 240/,
  );
  const drifted = structuredClone(entry);
  drifted.primary_question = "Has the question changed?";
  assert.throws(
    () =>
      validateRegistryDocument({ schema_version: 1, specialists: [drifted] }),
    /does not match its definition digest/,
  );
  assert.throws(
    () =>
      validateRegistryDocument({
        schema_version: 1,
        specialists: [entry, structuredClone(entry)],
      }),
    /duplicate temporary specialist identity/,
  );
});

test("the repository carries a canonical empty registry", async () => {
  const context = await readFile(new URL("qa-context.md", repositoryRoot), "utf8");
  const source = await readFile(
    new URL("qa-specialists.json", repositoryRoot),
    "utf8",
  );
  assert.match(
    context,
    /^- \*\*Temporary specialist registry:\*\* qa-specialists\.json$/m,
  );
  assert.deepEqual(
    structuredClone(
      validateRegistryDocument(parseJsonStrict(source, "qa-specialists.json")),
    ),
    { schema_version: 1, specialists: [] },
  );
});

test("registry file boundaries reject untracked, ignored, escaped, and symlink paths", async (t) => {
  const untracked = await createTestRepository({ trackRegistry: false });
  t.after(() => rm(untracked, { recursive: true, force: true }));
  await assert.rejects(
    validateRegistryProject({ repository: untracked }),
    /registry is not tracked/,
  );

  const ignored = await createTestRepository();
  t.after(() => rm(ignored, { recursive: true, force: true }));
  await writeFile(join(ignored, ".gitignore"), "QA/\nqa-specialists.json\n");
  await assert.rejects(
    validateRegistryProject({ repository: ignored }),
    /registry is ignored/,
  );

  const escaped = await createTestRepository();
  t.after(() => rm(escaped, { recursive: true, force: true }));
  await assert.rejects(
    validateRegistryProject({
      repository: escaped,
      registry: "../qa-specialists.json",
    }),
    /must resolve inside the repository/,
  );

  const linked = await createTestRepository();
  t.after(() => rm(linked, { recursive: true, force: true }));
  const outside = join(tmpdir(), `specialists-outside-${process.pid}.json`);
  t.after(() => rm(outside, { force: true }));
  await writeFile(
    outside,
    `${JSON.stringify({ schema_version: 1, specialists: [] })}\n`,
  );
  await unlink(join(linked, "qa-specialists.json"));
  await symlink(outside, join(linked, "qa-specialists.json"));
  await assert.rejects(
    validateRegistryProject({ repository: linked }),
    /regular file, not a symlink/,
  );

  const reportPath = await createTestRepository({ registryPath: "QA/registry.json" });
  t.after(() => rm(reportPath, { recursive: true, force: true }));
  await assert.rejects(
    validateRegistryProject({ repository: reportPath }),
    /must not resolve inside the report folder/,
  );

  const linkedParentRepository = await createTestRepository({
    registryPath: "linked/qa-specialists.json",
    createRegistry: false,
    trackRegistry: false,
  });
  const linkedParentOutside = await mkdtemp(
    join(tmpdir(), "specialists-linked-parent-"),
  );
  t.after(() => rm(linkedParentRepository, { recursive: true, force: true }));
  t.after(() => rm(linkedParentOutside, { recursive: true, force: true }));
  await symlink(linkedParentOutside, join(linkedParentRepository, "linked"));
  await assert.rejects(
    initializeRegistry({ repository: linkedParentRepository }),
    /parent must resolve inside the repository/,
  );
  await assert.rejects(
    readFile(join(linkedParentOutside, "qa-specialists.json"), "utf8"),
    /ENOENT/,
  );
});

test("malformed registry JSON fails closed", async (t) => {
  const repository = await createTestRepository();
  t.after(() => rm(repository, { recursive: true, force: true }));
  await writeFile(
    join(repository, "qa-specialists.json"),
    '{"schema_version":1,"specialists":[}',
  );
  await assert.rejects(
    validateRegistryProject({ repository }),
    /invalid value|unexpected token|expected|JSON/,
  );
});

test("register is append-only, CAS-protected, and resolves a rationale-free projection", async (t) => {
  const repository = await createTestRepository();
  t.after(() => rm(repository, { recursive: true, force: true }));
  const definitionPath = join(repository, "definition.json");
  await writeFile(definitionPath, `${JSON.stringify(definition(), null, 2)}\n`);
  const initial = await validateRegistryProject({ repository });

  const registered = await registerSpecialist({
    repository,
    definitionPath,
    expectedDigest: initial.digest,
  });
  assert.equal(registered.registry.specialists.length, 1);
  assert.equal(registered.entry.id, registered.registry.specialists[0].id);

  const projection = await resolveSpecialist({
    repository,
    id: registered.entry.id,
  });
  assert.equal(projection.id, registered.entry.id);
  assert.equal(projection.primary_question, definition().primary_question);
  assert.equal(projection.definition_rationale, undefined);
  assert.equal(projection.selection_criteria, undefined);
  assert.equal(projection.slug, undefined);

  await assert.rejects(
    registerSpecialist({
      repository,
      definitionPath,
      expectedDigest: initial.digest,
    }),
    /changed concurrently/,
  );
  await assert.rejects(
    registerSpecialist({
      repository,
      definitionPath,
      expectedDigest: registered.digest,
    }),
    /duplicate temporary specialist identity/,
  );

  const changedPath = join(repository, "definition-changed.json");
  await writeFile(
    changedPath,
    `${JSON.stringify(
      definition({ definition_rationale: "A revised immutable rationale." }),
      null,
      2,
    )}\n`,
  );
  const changed = await registerSpecialist({
    repository,
    definitionPath: changedPath,
    expectedDigest: registered.digest,
  });
  assert.equal(changed.registry.specialists.length, 2);
  assert.notEqual(changed.entry.id, registered.entry.id);
  assert.equal(
    sha256(await readFile(join(repository, "qa-specialists.json"), "utf8")),
    changed.digest,
  );
});

test("concurrent registration permits exactly one writer for a digest", async (t) => {
  const repository = await createTestRepository();
  t.after(() => rm(repository, { recursive: true, force: true }));
  const firstPath = join(repository, "first.json");
  const secondPath = join(repository, "second.json");
  await writeFile(firstPath, `${JSON.stringify(definition())}\n`);
  await writeFile(
    secondPath,
    `${JSON.stringify(definition({ slug: "queue-failover" }))}\n`,
  );
  const initial = await validateRegistryProject({ repository });
  const results = await Promise.allSettled([
    registerSpecialist({
      repository,
      definitionPath: firstPath,
      expectedDigest: initial.digest,
    }),
    registerSpecialist({
      repository,
      definitionPath: secondPath,
      expectedDigest: initial.digest,
    }),
  ]);
  assert.equal(results.filter(({ status }) => status === "fulfilled").length, 1);
  assert.equal(results.filter(({ status }) => status === "rejected").length, 1);
  assert.equal(
    (await validateRegistryProject({ repository })).registry.specialists.length,
    1,
  );
});
