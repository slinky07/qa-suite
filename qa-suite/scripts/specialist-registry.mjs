#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  unlink,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseJsonStrict } from "./finding-ledger.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const schemaPath = resolve(
  dirname(scriptPath),
  "../references/temporary-specialist-registry.schema.json",
);
const REGISTRY_FIELDS = ["schema_version", "specialists"];
const DEFINITION_FIELDS = [
  "slug",
  "specialist_perspective",
  "primary_question",
  "specialist_mission",
  "priorities",
  "decision_rules",
  "evidence_requirements",
  "scope_exclusions",
  "selection_criteria",
  "definition_rationale",
  "time_box_minutes",
];
const ENTRY_FIELDS = ["id", ...DEFINITION_FIELDS];
const LIST_FIELDS = [
  "priorities",
  "decision_rules",
  "evidence_requirements",
  "scope_exclusions",
  "selection_criteria",
];
const DISPATCH_FIELDS = [
  "id",
  "specialist_perspective",
  "primary_question",
  "specialist_mission",
  "priorities",
  "decision_rules",
  "evidence_requirements",
  "scope_exclusions",
  "time_box_minutes",
];
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
export const TEMPORARY_SPECIALIST_PATTERN =
  /^temporary-qa-[a-z0-9]+(?:-[a-z0-9]+)*-[0-9a-f]{64}$/u;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const DIGEST_DOMAIN = "qa-suite-temporary-specialist:v1\0";

function assertPlainObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertExactKeys(value, expected, label) {
  assertPlainObject(value, label);
  const observed = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(observed) !== JSON.stringify(wanted)) {
    throw new Error(
      `${label} fields are ${observed.join(", ")}; expected ${wanted.join(", ")}`,
    );
  }
}

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  if (/\p{Cc}/u.test(value)) {
    throw new Error(`${label} contains a control character`);
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(source) {
  return createHash("sha256").update(source).digest("hex");
}

function assertStringList(value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} must be a non-empty array`);
  }
  value.forEach((item, index) =>
    assertNonEmptyString(item, `${label}[${index}]`),
  );
  if (new Set(value).size !== value.length) {
    throw new Error(`${label} must contain unique strings`);
  }
}

export function validateSpecialistDefinition(definition) {
  assertExactKeys(definition, DEFINITION_FIELDS, "specialist definition");
  assertNonEmptyString(definition.slug, "specialist definition.slug");
  if (definition.slug.length > 40 || !SLUG_PATTERN.test(definition.slug)) {
    throw new Error(
      "specialist definition.slug must be a lowercase hyphenated slug of at most 40 characters",
    );
  }
  for (const field of [
    "specialist_perspective",
    "primary_question",
    "specialist_mission",
    "definition_rationale",
  ]) {
    assertNonEmptyString(definition[field], `specialist definition.${field}`);
  }
  for (const field of LIST_FIELDS) {
    assertStringList(definition[field], `specialist definition.${field}`);
  }
  if (
    !Number.isInteger(definition.time_box_minutes) ||
    definition.time_box_minutes < 15 ||
    definition.time_box_minutes > 240
  ) {
    throw new Error(
      "specialist definition.time_box_minutes must be an integer from 15 through 240",
    );
  }
  return definition;
}

export function specialistDefinitionDigest(definition) {
  validateSpecialistDefinition(definition);
  return sha256(`${DIGEST_DOMAIN}${canonicalJson(definition)}`);
}

export function createSpecialistEntry(definition) {
  const digest = specialistDefinitionDigest(definition);
  return {
    id: `temporary-qa-${definition.slug}-${digest}`,
    ...structuredClone(definition),
  };
}

function definitionFromEntry(entry) {
  return Object.fromEntries(
    DEFINITION_FIELDS.map((field) => [field, structuredClone(entry[field])]),
  );
}

export function validateRegistryDocument(registry) {
  assertExactKeys(registry, REGISTRY_FIELDS, "specialist registry");
  if (registry.schema_version !== 1) {
    throw new Error("specialist registry.schema_version must equal 1");
  }
  if (!Array.isArray(registry.specialists)) {
    throw new Error("specialist registry.specialists must be an array");
  }
  const identities = new Set();
  registry.specialists.forEach((entry, index) => {
    const label = `specialist registry.specialists[${index}]`;
    assertExactKeys(entry, ENTRY_FIELDS, label);
    assertNonEmptyString(entry.id, `${label}.id`);
    if (!TEMPORARY_SPECIALIST_PATTERN.test(entry.id)) {
      throw new Error(`${label}.id does not match the temporary identity contract`);
    }
    const definition = definitionFromEntry(entry);
    validateSpecialistDefinition(definition);
    const expectedId = createSpecialistEntry(definition).id;
    if (entry.id !== expectedId) {
      throw new Error(`${label}.id does not match its definition digest`);
    }
    if (identities.has(entry.id)) {
      throw new Error(`duplicate temporary specialist identity: ${entry.id}`);
    }
    identities.add(entry.id);
  });
  return registry;
}

export function validateRegistrySchema(schema) {
  assertPlainObject(schema, "temporary specialist registry schema");
  if (
    schema.$schema !== "https://json-schema.org/draft/2020-12/schema" ||
    schema.type !== "object" ||
    schema.additionalProperties !== false
  ) {
    throw new Error("temporary specialist registry schema header is invalid");
  }
  const required = [...(schema.required ?? [])].sort();
  if (JSON.stringify(required) !== JSON.stringify([...REGISTRY_FIELDS].sort())) {
    throw new Error("temporary specialist registry schema fields are invalid");
  }
  const specialist = schema.$defs?.specialist;
  if (!specialist || specialist.additionalProperties !== false) {
    throw new Error("temporary specialist entry schema is not closed");
  }
  const entryRequired = [...(specialist.required ?? [])].sort();
  if (JSON.stringify(entryRequired) !== JSON.stringify([...ENTRY_FIELDS].sort())) {
    throw new Error("temporary specialist entry schema fields are invalid");
  }
  if (
    specialist.properties?.id?.pattern !== TEMPORARY_SPECIALIST_PATTERN.source ||
    specialist.properties?.slug?.minLength !== 1 ||
    specialist.properties?.slug?.maxLength !== 40 ||
    specialist.properties?.slug?.pattern !== SLUG_PATTERN.source ||
    specialist.properties?.time_box_minutes?.minimum !== 15 ||
    specialist.properties?.time_box_minutes?.maximum !== 240
  ) {
    throw new Error("temporary specialist registry schema bounds are invalid");
  }
  return schema;
}

function runGit(repositoryRoot, args, acceptedStatuses = [0]) {
  const result = spawnSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (!acceptedStatuses.includes(result.status)) {
    const detail = result.stderr.trim() || result.stdout.trim();
    throw new Error(`git ${args.join(" ")} failed: ${detail}`);
  }
  return result;
}

function extractField(markdown, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(
    `^- \\*\\*${escaped}:\\*\\*[ \\t]*(.+)$`,
    "m",
  ).exec(markdown);
  if (!match) throw new Error(`qa-context.md is missing ${label}`);
  return match[1].replace(/[ \t]*<!--.*$/, "").trim();
}

function extractOptionalField(markdown, label) {
  try {
    return extractField(markdown, label);
  } catch (error) {
    if (error.message === `qa-context.md is missing ${label}`) return undefined;
    throw error;
  }
}

function insideRepository(repositoryRoot, path, label) {
  const relativePath = relative(repositoryRoot, path);
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`${label} must resolve inside the repository`);
  }
  return relativePath.split(sep).join("/");
}

async function assertRegularFile(path, label) {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file, not a symlink`);
  }
}

async function assertRegularInRepository(repositoryRoot, path, label) {
  await assertRegularFile(path, label);
  const canonical = await realpath(path);
  insideRepository(repositoryRoot, canonical, label);
}

async function assertCreationParentInRepository(
  repositoryRoot,
  targetPath,
  label,
) {
  let existingParent = dirname(targetPath);
  while (true) {
    try {
      const canonicalParent = await realpath(existingParent);
      const relativeParent = relative(repositoryRoot, canonicalParent);
      if (
        relativeParent === ".." ||
        relativeParent.startsWith(`..${sep}`) ||
        isAbsolute(relativeParent)
      ) {
        throw new Error(`${label} parent must resolve inside the repository`);
      }
      return;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const parent = dirname(existingParent);
      if (parent === existingParent) throw error;
      existingParent = parent;
    }
  }
}

function assertNotIgnored(repositoryRoot, gitPath) {
  const result = runGit(
    repositoryRoot,
    ["check-ignore", "--no-index", "--", gitPath],
    [0, 1],
  );
  if (result.status === 0) {
    throw new Error(`temporary specialist registry is ignored: ${gitPath}`);
  }
}

function assertTracked(repositoryRoot, gitPath) {
  const result = runGit(
    repositoryRoot,
    ["ls-files", "--error-unmatch", "--", gitPath],
    [0, 1],
  );
  if (result.status !== 0) {
    throw new Error(`temporary specialist registry is not tracked: ${gitPath}`);
  }
}

async function loadRegistryLocation({
  repository = ".",
  context = "qa-context.md",
  registry,
}) {
  const repositoryRoot = await realpath(resolve(repository));
  const contextPath = resolve(repositoryRoot, context);
  await assertRegularInRepository(repositoryRoot, contextPath, "qa-context.md");
  const markdown = await readFile(contextPath, "utf8");
  const configured =
    registry ?? extractOptionalField(markdown, "Temporary specialist registry");
  if (!configured || configured === "N/A" || isAbsolute(configured)) {
    throw new Error(
      "Temporary specialist registry must name a repository-relative path",
    );
  }
  const registryPath = resolve(repositoryRoot, configured);
  const registryGitPath = insideRepository(
    repositoryRoot,
    registryPath,
    "temporary specialist registry",
  );
  const reportPath = resolve(
    repositoryRoot,
    extractField(markdown, "Report output folder"),
  );
  const reportRelative = relative(reportPath, registryPath);
  if (
    reportRelative === "" ||
    (!reportRelative.startsWith(`..${sep}`) && !isAbsolute(reportRelative))
  ) {
    throw new Error(
      "temporary specialist registry must not resolve inside the report folder",
    );
  }
  return {
    contextPath,
    registryGitPath,
    registryPath,
    repositoryRoot,
  };
}

async function loadSchema() {
  const source = await readFile(schemaPath, "utf8");
  return validateRegistrySchema(
    parseJsonStrict(source, "temporary-specialist-registry.schema.json"),
  );
}

function serializeRegistry(registry) {
  return `${JSON.stringify(registry, null, 2)}\n`;
}

export async function validateRegistryProject(options = {}) {
  const location = await loadRegistryLocation(options);
  await assertRegularInRepository(
    location.repositoryRoot,
    location.registryPath,
    "temporary specialist registry",
  );
  assertNotIgnored(location.repositoryRoot, location.registryGitPath);
  assertTracked(location.repositoryRoot, location.registryGitPath);
  await loadSchema();
  const source = await readFile(location.registryPath, "utf8");
  const registry = validateRegistryDocument(
    parseJsonStrict(source, location.registryGitPath),
  );
  return {
    ...location,
    digest: sha256(source),
    registry,
  };
}

export async function initializeRegistry(options = {}) {
  const location = await loadRegistryLocation(options);
  await assertCreationParentInRepository(
    location.repositoryRoot,
    location.registryPath,
    "temporary specialist registry",
  );
  assertNotIgnored(location.repositoryRoot, location.registryGitPath);
  await mkdir(dirname(location.registryPath), { recursive: true });
  try {
    const file = await open(location.registryPath, "wx", 0o644);
    await file.writeFile(serializeRegistry({ schema_version: 1, specialists: [] }));
    await file.sync();
    await file.close();
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  await assertRegularInRepository(
    location.repositoryRoot,
    location.registryPath,
    "temporary specialist registry",
  );
  const source = await readFile(location.registryPath, "utf8");
  validateRegistryDocument(parseJsonStrict(source, location.registryGitPath));
  return { ...location, digest: sha256(source) };
}

export async function registerSpecialist({
  repository = ".",
  context = "qa-context.md",
  registry,
  definitionPath,
  expectedDigest,
}) {
  assertNonEmptyString(definitionPath, "definitionPath");
  assertNonEmptyString(expectedDigest, "expectedDigest");
  if (!DIGEST_PATTERN.test(expectedDigest)) {
    throw new Error("expectedDigest must be a lowercase SHA-256 digest");
  }
  const project = await validateRegistryProject({ repository, context, registry });
  const resolvedDefinition = resolve(definitionPath);
  await assertRegularFile(resolvedDefinition, "specialist definition");
  const definition = validateSpecialistDefinition(
    parseJsonStrict(
      await readFile(resolvedDefinition, "utf8"),
      resolvedDefinition,
    ),
  );
  const entry = createSpecialistEntry(definition);
  const lockPath = `${project.registryPath}.lock`;
  const temporaryPath = `${project.registryPath}.${process.pid}.${Date.now()}.tmp`;
  let lock;
  let temporary;
  try {
    lock = await open(lockPath, "wx", 0o600);
    await lock.writeFile(
      `${JSON.stringify({
        pid: process.pid,
        created_at: new Date().toISOString(),
        expected_digest: expectedDigest,
      })}\n`,
    );
    await lock.sync();

    await assertRegularInRepository(
      project.repositoryRoot,
      project.registryPath,
      "temporary specialist registry",
    );
    const currentSource = await readFile(project.registryPath, "utf8");
    const currentDigest = sha256(currentSource);
    if (currentDigest !== expectedDigest) {
      throw new Error(
        `temporary specialist registry changed concurrently: expected ${expectedDigest}, observed ${currentDigest}`,
      );
    }
    const current = validateRegistryDocument(
      parseJsonStrict(currentSource, project.registryGitPath),
    );
    if (current.specialists.some(({ id }) => id === entry.id)) {
      throw new Error(`duplicate temporary specialist identity: ${entry.id}`);
    }
    const candidate = {
      schema_version: 1,
      specialists: [...current.specialists, entry],
    };
    validateRegistryDocument(candidate);
    temporary = await open(temporaryPath, "wx", 0o644);
    await temporary.writeFile(serializeRegistry(candidate));
    await temporary.sync();
    await temporary.close();
    temporary = undefined;
    await rename(temporaryPath, project.registryPath);
  } finally {
    if (temporary) await temporary.close();
    await unlink(temporaryPath).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    if (lock) {
      await lock.close();
      await unlink(lockPath).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
  }
  const result = await validateRegistryProject({ repository, context, registry });
  return { ...result, entry };
}

export async function resolveSpecialist({
  repository = ".",
  context = "qa-context.md",
  registry,
  id,
  projection = "dispatch",
}) {
  assertNonEmptyString(id, "id");
  if (projection !== "dispatch") {
    throw new Error("projection must be dispatch");
  }
  const project = await validateRegistryProject({ repository, context, registry });
  const entry = project.registry.specialists.find((candidate) => candidate.id === id);
  if (!entry) {
    throw new Error(`temporary specialist identity is not registered: ${id}`);
  }
  return Object.fromEntries(
    DISPATCH_FIELDS.map((field) => [field, structuredClone(entry[field])]),
  );
}

function parseArguments(argv) {
  const [command, ...argumentsList] = argv;
  const options = {};
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (!argument.startsWith("--")) {
      throw new Error(`Unknown argument: ${argument}`);
    }
    const key = argument.slice(2);
    if (Object.hasOwn(options, key)) {
      throw new Error(`Duplicate option: ${argument}`);
    }
    const value = argumentsList[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${argument} requires a value`);
    }
    options[key] = value;
    index += 1;
  }
  return { command, options };
}

function assertAllowedOptions(options, allowed) {
  const unexpected = Object.keys(options).find((option) => !allowed.has(option));
  if (unexpected) throw new Error(`Unknown option: --${unexpected}`);
}

function requiredOption(options, name) {
  const value = options[name];
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

async function main() {
  const { command, options } = parseArguments(process.argv.slice(2));
  const commonOptions = new Set(["repo", "context", "registry"]);
  const common = {
    repository: options.repo ?? ".",
    context: options.context ?? "qa-context.md",
    registry: options.registry,
  };
  if (command === "init") {
    assertAllowedOptions(options, commonOptions);
    const result = await initializeRegistry(common);
    console.log(
      `Initialized ${result.registryGitPath}; the human must commit it with qa-context.md`,
    );
    return;
  }
  if (command === "validate") {
    assertAllowedOptions(options, commonOptions);
    const result = await validateRegistryProject(common);
    console.log(
      JSON.stringify({
        registry: result.registryGitPath,
        schema_version: 1,
        specialists: result.registry.specialists.length,
        sha256: result.digest,
      }),
    );
    return;
  }
  if (command === "register") {
    assertAllowedOptions(
      options,
      new Set([...commonOptions, "definition", "expected-sha256"]),
    );
    const result = await registerSpecialist({
      ...common,
      definitionPath: requiredOption(options, "definition"),
      expectedDigest: requiredOption(options, "expected-sha256"),
    });
    console.log(
      JSON.stringify({
        id: result.entry.id,
        registry: result.registryGitPath,
        sha256: result.digest,
      }),
    );
    return;
  }
  if (command === "resolve") {
    assertAllowedOptions(
      options,
      new Set([...commonOptions, "id", "projection"]),
    );
    console.log(
      JSON.stringify(
        await resolveSpecialist({
          ...common,
          id: requiredOption(options, "id"),
          projection: requiredOption(options, "projection"),
        }),
      ),
    );
    return;
  }
  throw new Error("command must be init, validate, register, or resolve");
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
