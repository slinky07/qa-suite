import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  constants,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const ASSET_NAMES = ["qa-suite.skill", "qa-suite-source.zip"];
export const ASSET_CONTENT_TYPES = new Map([
  ["qa-suite.skill", "application/octet-stream"],
  ["qa-suite-source.zip", "application/zip"],
]);

export const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const GENERATED_FILE_NAMES = [
  ...ASSET_NAMES,
  "SHA256SUMS",
  "build-evidence.json",
];
const CLAUDE_AGENT_PATHS = [
  ".claude/agents/api-qa.md",
  ".claude/agents/bob-qa.md",
  ".claude/agents/compatibility-qa.md",
  ".claude/agents/performance-qa.md",
  ".claude/agents/regression-qa.md",
  ".claude/agents/security-qa.md",
  ".claude/agents/smoke-qa.md",
];
const CLAUDE_COMMAND_PATHS = [
  ".claude/commands/qa-regression.md",
  ".claude/commands/qa-release.md",
  ".claude/commands/qa-smoke.md",
];
const SEMANTIC_VERSION = /^\d+\.\d+\.\d+$/;
const RELEASE_TAG = /^v\d+\.\d+\.\d+$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SHA256 = /^[0-9a-f]{64}$/;
const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PUBLICATION_DATE = /^\d{4}(?:-\d{2}(?:-\d{2})?)?$/;
const EXTERNAL_REFERENCE_REGISTER_PATH =
  "docs/external-reference-register.json";
const EXTERNAL_REFERENCE_POLICY_PATH = "docs/external-references.md";
const EXTERNAL_REFERENCE_ADR_PATH =
  "docs/adr/0001-controlled-external-references.md";
const CONTROLLED_DOCUMENT_EXTENSIONS = new Set([
  ".doc",
  ".docx",
  ".epub",
  ".key",
  ".keynote",
  ".numbers",
  ".odp",
  ".ods",
  ".odt",
  ".pages",
  ".pdf",
  ".ppt",
  ".pptx",
  ".rtf",
  ".xls",
  ".xlsx",
]);
const REFERENCE_ENTRY_KEYS = [
  "acquisition_date",
  "author",
  "classification",
  "control_owner",
  "current_status",
  "derived_authorities",
  "disposition",
  "distribution",
  "id",
  "license",
  "original_source_url",
  "provenance_status",
  "publication_or_version_date",
  "publication_or_version_date_basis",
  "publisher",
  "review_date",
  "retention",
  "sha256",
  "storage",
  "supersession_history",
  "title",
];
const DISTRIBUTION_CHANNELS = new Set([
  "claude-ai",
  "source-archive",
  "tagged-repository",
]);

export function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, ...options.env },
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const renderedCommand = [command, ...args].join(" ");
    const detail = result.stderr.trim() || result.stdout.trim();
    throw new Error(`${renderedCommand} failed${detail ? `: ${detail}` : ""}`);
  }

  return result.stdout;
}

function runBinaryCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    encoding: null,
    input: options.input,
    maxBuffer: options.maxBuffer ?? 16 * 1024 * 1024,
    env: { ...process.env, ...options.env },
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const renderedCommand = [command, ...args].join(" ");
    const detail = (result.stderr.length > 0 ? result.stderr : result.stdout)
      .toString("utf8")
      .trim();
    throw new Error(`${renderedCommand} failed${detail ? `: ${detail}` : ""}`);
  }

  return result.stdout;
}

export function resolveCommit(ref) {
  const commit = runCommand("git", [
    "rev-parse",
    "--verify",
    "--end-of-options",
    `${ref}^{commit}`,
  ]).trim();

  if (!/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error(`Git ref ${ref} did not resolve to a full commit SHA`);
  }

  return commit;
}

function readGitFile(commit, path) {
  return runCommand("git", ["show", `${commit}:${path}`]);
}

function parseGitJson(commit, path) {
  try {
    return JSON.parse(readGitFile(commit, path));
  } catch (error) {
    throw new Error(`${path} is not valid JSON at ${commit}: ${error.message}`);
  }
}

function normalizedRepositoryPath(path) {
  if (typeof path !== "string") {
    throw new Error(`Manifest path must be a string; received ${typeof path}`);
  }
  return path.replace(/^\.\//, "").replace(/\/+$/, "");
}

function sorted(values) {
  return [...values].sort();
}

function assertPlainObject(label, value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertExactKeys(label, value, expectedKeys) {
  assertPlainObject(label, value);
  const observedKeys = sorted(Object.keys(value));
  const expected = sorted(expectedKeys);

  if (JSON.stringify(observedKeys) !== JSON.stringify(expected)) {
    throw new Error(
      `${label} has keys ${observedKeys.join(", ")}; expected ${expected.join(", ")}`,
    );
  }
}

function assertNonEmptyString(label, value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function assertNullableString(label, value) {
  if (value !== null) {
    assertNonEmptyString(label, value);
  }
}

function assertEqualPaths(label, observed, expected) {
  const normalizedObserved = sorted(observed.map(normalizedRepositoryPath));
  const normalizedExpected = sorted(expected);
  if (
    JSON.stringify(normalizedObserved) !== JSON.stringify(normalizedExpected)
  ) {
    throw new Error(
      `${label} declares ${normalizedObserved.join(", ")}; expected ${normalizedExpected.join(", ")}`,
    );
  }
}

function gitTreeEntries(commit) {
  return runCommand("git", [
    "ls-tree",
    "-r",
    "-z",
    "--full-tree",
    commit,
  ])
    .split("\0")
    .filter(Boolean)
    .map((record) => {
      const separator = record.indexOf("\t");
      const metadata = record.slice(0, separator).split(" ");
      return {
        mode: metadata[0],
        type: metadata[1],
        oid: metadata[2],
        path: record.slice(separator + 1),
      };
    });
}

function gitBlobContents(entries) {
  const objectIds = [
    ...new Set(
      entries
        .filter((entry) => entry.type === "blob")
        .map((entry) => entry.oid),
    ),
  ];
  if (objectIds.length === 0) {
    return new Map();
  }

  const output = runBinaryCommand("git", ["cat-file", "--batch"], {
    input: Buffer.from(`${objectIds.join("\n")}\n`),
    maxBuffer: 64 * 1024 * 1024,
  });
  const contents = new Map();
  let offset = 0;

  for (const expectedObjectId of objectIds) {
    const headerEnd = output.indexOf(0x0a, offset);
    if (headerEnd === -1) {
      throw new Error("git cat-file --batch returned a truncated header");
    }
    const header = output.subarray(offset, headerEnd).toString("utf8");
    const [objectId, type, rawSize] = header.split(" ");
    const size = Number(rawSize);
    if (
      objectId !== expectedObjectId ||
      type !== "blob" ||
      !Number.isSafeInteger(size) ||
      size < 0
    ) {
      throw new Error(`git cat-file --batch returned an invalid blob header`);
    }
    const contentStart = headerEnd + 1;
    const contentEnd = contentStart + size;
    if (contentEnd >= output.length || output[contentEnd] !== 0x0a) {
      throw new Error(`git cat-file --batch returned a truncated blob`);
    }
    contents.set(objectId, output.subarray(contentStart, contentEnd));
    offset = contentEnd + 1;
  }

  if (offset !== output.length) {
    throw new Error("git cat-file --batch returned unexpected trailing bytes");
  }
  return contents;
}

function gitFiles(commit) {
  return new Set(gitTreeEntries(commit).map((entry) => entry.path));
}

function assertFileExists(files, path) {
  if (!files.has(path)) {
    throw new Error(`Required distribution file is missing: ${path}`);
  }
}

function assertDirectoryExists(files, path) {
  const prefix = `${normalizedRepositoryPath(path)}/`;
  if (![...files].some((file) => file.startsWith(prefix))) {
    throw new Error(`Required distribution directory is missing: ${prefix}`);
  }
}

function controlledDocumentPath(path) {
  const lowerPath = path.toLowerCase();
  for (const extension of CONTROLLED_DOCUMENT_EXTENSIONS) {
    if (lowerPath.endsWith(extension)) {
      return true;
    }
  }
  return false;
}

function controlledDocumentSignature(content) {
  if (!Buffer.isBuffer(content)) {
    return false;
  }
  const signatures = [
    Buffer.from("%PDF-"),
    Buffer.from("{\\rtf"),
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from([0x50, 0x4b, 0x05, 0x06]),
    Buffer.from([0x50, 0x4b, 0x07, 0x08]),
  ];
  return signatures.some(
    (signature) =>
      content.length >= signature.length &&
      content.subarray(0, signature.length).equals(signature),
  );
}

function controlledDocumentEntry(entry) {
  return (
    controlledDocumentPath(entry.path) ||
    controlledDocumentSignature(entry.content)
  );
}

function assertRepositoryPath(label, path) {
  assertNonEmptyString(label, path);
  if (
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error(`${label} is not a safe normalized repository path: ${path}`);
  }
}

function assertReferenceDate(label, value, options = {}) {
  if (value === null && options.nullable === true) {
    return;
  }
  if (typeof value !== "string" || !options.pattern.test(value)) {
    throw new Error(`${label} is not a valid controlled date`);
  }
  const parts = value.split("-").map(Number);
  const year = parts[0];
  const month = parts[1];
  const day = parts[2];
  if (month !== undefined && (month < 1 || month > 12)) {
    throw new Error(`${label} is not a valid calendar date`);
  }
  if (day !== undefined) {
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const daysInMonth = [
      31,
      leapYear ? 29 : 28,
      31,
      30,
      31,
      30,
      31,
      31,
      30,
      31,
      30,
      31,
    ][month - 1];
    if (day < 1 || day > daysInMonth) {
      throw new Error(`${label} is not a valid calendar date`);
    }
  }
}

function assertReferenceHistory(reference, label) {
  if (!Array.isArray(reference.derived_authorities)) {
    throw new Error(`${label}.derived_authorities must be an array`);
  }
  reference.derived_authorities.forEach((authority, index) => {
    const authorityLabel = `${label}.derived_authorities[${index}]`;
    assertExactKeys(authorityLabel, authority, [
      "locator",
      "path",
      "rationale",
      "treatment",
    ]);
    assertRepositoryPath(`${authorityLabel}.path`, authority.path);
    if (
      !authority.path.endsWith(".md") ||
      (!authority.path.startsWith("docs/adr/") &&
        !authority.path.startsWith("docs/rfcs/"))
    ) {
      throw new Error(
        `${authorityLabel}.path must identify a tracked ADR or RFC`,
      );
    }
    assertNonEmptyString(`${authorityLabel}.locator`, authority.locator);
    if (!/^(?:figure|page|pages|section|table)\s+\S/i.test(authority.locator)) {
      throw new Error(`${authorityLabel}.locator must be an exact source locator`);
    }
    assertNonEmptyString(`${authorityLabel}.rationale`, authority.rationale);
    if (!["adopted", "modified", "rejected"].includes(authority.treatment)) {
      throw new Error(`${authorityLabel}.treatment is invalid`);
    }
  });

  if (!Array.isArray(reference.supersession_history)) {
    throw new Error(`${label}.supersession_history must be an array`);
  }
  reference.supersession_history.forEach((event, index) => {
    const eventLabel = `${label}.supersession_history[${index}]`;
    assertExactKeys(eventLabel, event, [
      "action",
      "date",
      "reason",
      "reference_id",
    ]);
    assertReferenceDate(`${eventLabel}.date`, event.date, {
      pattern: CALENDAR_DATE,
    });
    assertNonEmptyString(`${eventLabel}.action`, event.action);
    if (!["superseded-by", "supersedes"].includes(event.action)) {
      throw new Error(`${eventLabel}.action is invalid`);
    }
    assertNonEmptyString(`${eventLabel}.reason`, event.reason);
    if (!/^REF-\d{4}$/.test(event.reference_id)) {
      throw new Error(`${eventLabel}.reference_id is invalid`);
    }
  });
}

function assertReferenceRecord(reference, index) {
  const label = `external reference at index ${index}`;
  assertExactKeys(label, reference, REFERENCE_ENTRY_KEYS);

  if (!/^REF-\d{4}$/.test(reference.id)) {
    throw new Error(`${label}.id must use REF-####`);
  }
  assertNonEmptyString(`${reference.id}.title`, reference.title);
  assertNullableString(`${reference.id}.author`, reference.author);
  assertNullableString(`${reference.id}.publisher`, reference.publisher);
  assertNullableString(
    `${reference.id}.original_source_url`,
    reference.original_source_url,
  );
  if (
    reference.original_source_url !== null &&
    !/^https:\/\//.test(reference.original_source_url)
  ) {
    throw new Error(`${reference.id}.original_source_url must use HTTPS`);
  }
  assertReferenceDate(
    `${reference.id}.publication_or_version_date`,
    reference.publication_or_version_date,
    { nullable: true, pattern: PUBLICATION_DATE },
  );
  assertNonEmptyString(
    `${reference.id}.publication_or_version_date_basis`,
    reference.publication_or_version_date_basis,
  );
  assertReferenceDate(`${reference.id}.acquisition_date`, reference.acquisition_date, {
    nullable: true,
    pattern: CALENDAR_DATE,
  });
  assertNonEmptyString(`${reference.id}.control_owner`, reference.control_owner);
  if (!["public", "internal", "restricted"].includes(reference.classification)) {
    throw new Error(`${reference.id}.classification is invalid`);
  }
  if (!["pending", "rejected", "verified"].includes(reference.provenance_status)) {
    throw new Error(`${reference.id}.provenance_status is invalid`);
  }
  if (!SHA256.test(reference.sha256)) {
    throw new Error(`${reference.id}.sha256 must be 64 lowercase hex characters`);
  }
  assertReferenceDate(`${reference.id}.review_date`, reference.review_date, {
    pattern: CALENDAR_DATE,
  });
  assertExactKeys(`${reference.id}.retention`, reference.retention, [
    "decision",
    "review_due",
    "term",
  ]);
  if (
    !["dispose-source", "retain-metadata", "retain-source"].includes(
      reference.retention.decision,
    )
  ) {
    throw new Error(`${reference.id}.retention.decision is invalid`);
  }
  assertReferenceDate(
    `${reference.id}.retention.review_due`,
    reference.retention.review_due,
    { nullable: true, pattern: CALENDAR_DATE },
  );
  assertNonEmptyString(`${reference.id}.retention.term`, reference.retention.term);
  if (
    reference.retention.review_due !== null &&
    reference.retention.review_due < reference.review_date
  ) {
    throw new Error(`${reference.id}.retention.review_due precedes review_date`);
  }
  if (
    ["active", "provenance-and-rights-pending"].includes(
      reference.current_status,
    ) &&
    reference.retention.review_due === null
  ) {
    throw new Error(`${reference.id} non-final status requires a review due date`);
  }
  if (
    reference.retention.decision === "dispose-source" &&
    !["disposed", "rejected"].includes(reference.current_status)
  ) {
    throw new Error(
      `${reference.id} dispose-source retention requires a final status`,
    );
  }
  if (
    ![
      "active",
      "disposed",
      "provenance-and-rights-pending",
      "rejected",
      "superseded",
    ].includes(reference.current_status)
  ) {
    throw new Error(`${reference.id}.current_status is invalid`);
  }
  if (
    reference.provenance_status === "pending" &&
    reference.current_status !== "provenance-and-rights-pending"
  ) {
    throw new Error(`${reference.id} pending provenance requires pending status`);
  }
  if (
    reference.provenance_status === "rejected" &&
    reference.current_status !== "rejected"
  ) {
    throw new Error(`${reference.id} rejected provenance requires rejected status`);
  }
  if (
    reference.provenance_status === "verified" &&
    [
      reference.author,
      reference.publisher,
      reference.original_source_url,
      reference.publication_or_version_date,
      reference.acquisition_date,
    ].some((value) => value === null)
  ) {
    throw new Error(
      `${reference.id} verified provenance requires complete source metadata`,
    );
  }

  assertExactKeys(`${reference.id}.license`, reference.license, [
    "evidence",
    "identifier",
    "redistribution",
  ]);
  assertNullableString(
    `${reference.id}.license.identifier`,
    reference.license.identifier,
  );
  assertNullableString(
    `${reference.id}.license.evidence`,
    reference.license.evidence,
  );
  if (!["approved", "not-approved"].includes(reference.license.redistribution)) {
    throw new Error(`${reference.id}.license.redistribution is invalid`);
  }

  assertExactKeys(`${reference.id}.storage`, reference.storage, [
    "kind",
    "locator",
    "repository_path",
  ]);
  if (
    ![
      "approved-document-store",
      "metadata-only",
      "repository-git-lfs",
    ].includes(reference.storage.kind)
  ) {
    throw new Error(`${reference.id}.storage.kind is invalid`);
  }
  assertNullableString(`${reference.id}.storage.locator`, reference.storage.locator);
  assertNullableString(
    `${reference.id}.storage.repository_path`,
    reference.storage.repository_path,
  );
  if (reference.storage.repository_path !== null) {
    assertRepositoryPath(
      `${reference.id}.storage.repository_path`,
      reference.storage.repository_path,
    );
  }
  if (
    reference.storage.kind === "metadata-only" &&
    (reference.storage.locator !== null ||
      reference.storage.repository_path !== null)
  ) {
    throw new Error(`${reference.id} metadata-only storage cannot name a location`);
  }
  if (
    reference.storage.kind === "metadata-only" &&
    !["dispose-source", "retain-metadata"].includes(
      reference.retention.decision,
    )
  ) {
    throw new Error(
      `${reference.id} metadata-only storage requires metadata retention or source disposal`,
    );
  }
  if (
    reference.storage.kind === "approved-document-store" &&
    (reference.storage.locator === null ||
      reference.storage.repository_path !== null)
  ) {
    throw new Error(
      `${reference.id} approved document storage requires only an external locator`,
    );
  }
  if (
    reference.storage.kind === "approved-document-store" &&
    reference.retention.decision !== "retain-source"
  ) {
    throw new Error(
      `${reference.id} approved document storage requires retain-source`,
    );
  }
  if (
    reference.storage.kind === "repository-git-lfs" &&
    (reference.storage.locator !== null ||
      reference.storage.repository_path === null)
  ) {
    throw new Error(
      `${reference.id} Git LFS storage requires only a repository path`,
    );
  }
  if (
    reference.storage.kind === "repository-git-lfs" &&
    reference.retention.decision !== "retain-source"
  ) {
    throw new Error(`${reference.id} Git LFS storage requires retain-source`);
  }

  assertExactKeys(`${reference.id}.distribution`, reference.distribution, [
    "channels",
    "decision",
  ]);
  if (!["approved", "excluded"].includes(reference.distribution.decision)) {
    throw new Error(`${reference.id}.distribution.decision is invalid`);
  }
  if (!Array.isArray(reference.distribution.channels)) {
    throw new Error(`${reference.id}.distribution.channels must be an array`);
  }
  if (
    JSON.stringify(reference.distribution.channels) !==
    JSON.stringify(sorted(new Set(reference.distribution.channels)))
  ) {
    throw new Error(`${reference.id}.distribution.channels must be unique and sorted`);
  }
  for (const channel of reference.distribution.channels) {
    if (!DISTRIBUTION_CHANNELS.has(channel)) {
      throw new Error(`${reference.id} has an unknown distribution channel`);
    }
  }
  if (
    (reference.distribution.decision === "excluded" &&
      reference.distribution.channels.length !== 0) ||
    (reference.distribution.decision === "approved" &&
      reference.distribution.channels.length === 0)
  ) {
    throw new Error(
      `${reference.id}.distribution decision does not match its channels`,
    );
  }

  assertReferenceHistory(reference, reference.id);
  assertExactKeys(`${reference.id}.disposition`, reference.disposition, [
    "approver",
    "date",
    "decision",
    "reason",
  ]);
  assertNonEmptyString(
    `${reference.id}.disposition.approver`,
    reference.disposition.approver,
  );
  assertReferenceDate(
    `${reference.id}.disposition.date`,
    reference.disposition.date,
    { pattern: CALENDAR_DATE },
  );
  assertNonEmptyString(
    `${reference.id}.disposition.decision`,
    reference.disposition.decision,
  );
  assertNonEmptyString(
    `${reference.id}.disposition.reason`,
    reference.disposition.reason,
  );

  const pendingOrRejected = ["pending", "rejected"].includes(
    reference.provenance_status,
  );
  if (pendingOrRejected) {
    if (
      reference.storage.repository_path !== null ||
      reference.distribution.decision !== "excluded" ||
      reference.distribution.channels.length !== 0 ||
      reference.license.redistribution !== "not-approved"
    ) {
      throw new Error(
        `${reference.id} has pending or rejected provenance and cannot be distributed`,
      );
    }
  }

  return reference;
}

export function assertExternalReferenceInventory(register, trackedEntries) {
  assertExactKeys("external reference register", register, [
    "references",
    "schema_version",
  ]);
  if (register.schema_version !== 1) {
    throw new Error("external reference register schema_version must be 1");
  }
  if (!Array.isArray(register.references)) {
    throw new Error("external reference register references must be an array");
  }
  if (!Array.isArray(trackedEntries)) {
    throw new Error("trackedEntries must be an array");
  }

  const references = register.references.map(assertReferenceRecord);
  const referencesById = new Map();
  const referencesByPath = new Map();
  const caseFoldedPaths = new Set();

  for (const reference of references) {
    if (referencesById.has(reference.id)) {
      throw new Error(`Duplicate external reference ID: ${reference.id}`);
    }
    referencesById.set(reference.id, reference);

    const repositoryPath = reference.storage.repository_path;
    if (repositoryPath === null) {
      if (
        reference.storage.kind === "repository-git-lfs" ||
        reference.distribution.channels.length !== 0
      ) {
        throw new Error(`${reference.id} has no repository path but is distributed`);
      }
      continue;
    }
    if (reference.classification !== "public") {
      throw new Error(
        `${reference.id} must be public before repository distribution`,
      );
    }
    if (reference.storage.kind !== "repository-git-lfs") {
      throw new Error(`${reference.id} repository storage must use Git LFS`);
    }
    if (!controlledDocumentPath(repositoryPath)) {
      throw new Error(`${reference.id} repository path is not a controlled document`);
    }
    if (
      !repositoryPath.startsWith("docs/external-reference-files/") &&
      !repositoryPath.startsWith("qa-suite/references/external/")
    ) {
      throw new Error(
        `${reference.id} repository path is outside the controlled reference roots`,
      );
    }
    if (referencesByPath.has(repositoryPath)) {
      throw new Error(`Duplicate external reference path: ${repositoryPath}`);
    }
    const foldedPath = repositoryPath.toLowerCase();
    if (caseFoldedPaths.has(foldedPath)) {
      throw new Error(`Case-colliding external reference path: ${repositoryPath}`);
    }
    caseFoldedPaths.add(foldedPath);
    referencesByPath.set(repositoryPath, reference);

    if (
      reference.provenance_status !== "verified" ||
      reference.current_status !== "active" ||
      reference.license.redistribution !== "approved" ||
      reference.license.identifier === null ||
      reference.license.evidence === null ||
      reference.distribution.decision !== "approved"
    ) {
      throw new Error(
        `${reference.id} must prove provenance, rights, and active approval before repository distribution`,
      );
    }
    const requiredChannels = ["tagged-repository"];
    if (repositoryPath.startsWith("qa-suite/")) {
      requiredChannels.push("claude-ai", "source-archive");
    }
    for (const channel of requiredChannels) {
      if (!reference.distribution.channels.includes(channel)) {
        throw new Error(
          `${reference.id} must allowlist ${channel} for ${repositoryPath}`,
        );
      }
    }
  }

  for (const reference of references) {
    const seenEvents = new Set();
    for (const event of reference.supersession_history) {
      if (event.reference_id === reference.id) {
        throw new Error(`${reference.id} cannot supersede itself`);
      }
      const relatedReference = referencesById.get(event.reference_id);
      if (!relatedReference) {
        throw new Error(
          `${reference.id} supersession target is not registered: ${event.reference_id}`,
        );
      }
      const eventKey = `${event.action}:${event.reference_id}`;
      if (seenEvents.has(eventKey)) {
        throw new Error(`${reference.id} has a duplicate supersession event`);
      }
      seenEvents.add(eventKey);
      const reciprocalAction =
        event.action === "supersedes" ? "superseded-by" : "supersedes";
      const reciprocal = relatedReference.supersession_history.some(
        (candidate) =>
          candidate.action === reciprocalAction &&
          candidate.reference_id === reference.id,
      );
      if (!reciprocal) {
        throw new Error(
          `${reference.id} supersession link to ${event.reference_id} is not reciprocal`,
        );
      }
      if (
        event.action === "superseded-by" &&
        reference.current_status !== "superseded"
      ) {
        throw new Error(
          `${reference.id} superseded-by history requires superseded status`,
        );
      }
    }
    if (
      reference.current_status === "superseded" &&
      !reference.supersession_history.some(
        (event) => event.action === "superseded-by",
      )
    ) {
      throw new Error(`${reference.id} superseded status requires lineage`);
    }
  }

  const controlledEntries = trackedEntries.filter(controlledDocumentEntry);
  const allTrackedPaths = new Set(trackedEntries.map((entry) => entry.path));
  for (const reference of references) {
    for (const authority of reference.derived_authorities) {
      if (!allTrackedPaths.has(authority.path)) {
        throw new Error(
          `${reference.id} derived authority is not tracked: ${authority.path}`,
        );
      }
    }
  }
  const trackedPaths = new Set(controlledEntries.map((entry) => entry.path));
  for (const path of referencesByPath.keys()) {
    if (!trackedPaths.has(path)) {
      throw new Error(`Stale external reference path is not tracked: ${path}`);
    }
  }

  for (const entry of controlledEntries) {
    const reference = referencesByPath.get(entry.path);
    if (!reference) {
      throw new Error(`Uncontrolled external reference binary: ${entry.path}`);
    }
    if (entry.type !== "blob" || entry.mode !== "100644") {
      throw new Error(
        `${reference.id} must use a non-executable regular Git LFS pointer: ${entry.path}`,
      );
    }
    if (!Buffer.isBuffer(entry.content)) {
      throw new Error(`${reference.id} is missing binary-safe Git blob content`);
    }
    if (entry.content.length >= 1024) {
      throw new Error(
        `${reference.id} Git LFS pointer must be smaller than 1024 bytes`,
      );
    }
    const pointer = entry.content.toString("utf8");
    const match =
      /^version https:\/\/git-lfs\.github\.com\/spec\/v1\noid sha256:([0-9a-f]{64})\nsize (0|[1-9][0-9]*)\n$/.exec(
        pointer,
      );
    if (!match) {
      throw new Error(
        `${reference.id} must be stored as a canonical Git LFS pointer: ${entry.path}`,
      );
    }
    if (match[1] !== reference.sha256) {
      throw new Error(
        `${reference.id} Git LFS SHA-256 does not match the register: ${entry.path}`,
      );
    }
  }

  return {
    approvedRepositoryPaths: sorted(referencesByPath.keys()),
    referenceCount: references.length,
  };
}

export function assertExternalReferenceContract(ref) {
  const commit = resolveCommit(ref);
  const entries = gitTreeEntries(commit);
  const blobContents = gitBlobContents(entries);
  const files = new Set(entries.map((entry) => entry.path));

  for (const path of [
    EXTERNAL_REFERENCE_POLICY_PATH,
    EXTERNAL_REFERENCE_REGISTER_PATH,
    EXTERNAL_REFERENCE_ADR_PATH,
  ]) {
    assertFileExists(files, path);
  }

  const trackedEntries = entries.map((entry) => ({
    ...entry,
    content: blobContents.get(entry.oid),
  }));
  const register = parseGitJson(commit, EXTERNAL_REFERENCE_REGISTER_PATH);
  return assertExternalReferenceInventory(
    register,
    trackedEntries,
  );
}

export function assertDistributionChannels(ref) {
  const commit = resolveCommit(ref);
  const files = gitFiles(commit);
  const claudePlugin = parseGitJson(commit, ".claude-plugin/plugin.json");
  const claudeMarketplace = parseGitJson(
    commit,
    ".claude-plugin/marketplace.json",
  );
  const codexPlugin = parseGitJson(commit, ".codex-plugin/plugin.json");
  const codexMarketplace = parseGitJson(
    commit,
    ".agents/plugins/marketplace.json",
  );

  for (const path of [
    "qa-suite/SKILL.md",
    ".claude-plugin/plugin.json",
    ".claude-plugin/marketplace.json",
    ".codex-plugin/plugin.json",
    ".agents/plugins/marketplace.json",
    ...CLAUDE_AGENT_PATHS,
    ...CLAUDE_COMMAND_PATHS,
  ]) {
    assertFileExists(files, path);
  }

  assertEqualPaths(
    "Claude Code agent manifest",
    claudePlugin.agents ?? [],
    CLAUDE_AGENT_PATHS,
  );
  assertEqualPaths(
    "Claude Code agent tree",
    [...files].filter((path) => path.startsWith(".claude/agents/")),
    CLAUDE_AGENT_PATHS,
  );
  assertEqualPaths(
    "Claude Code command tree",
    [...files].filter((path) => path.startsWith(".claude/commands/")),
    CLAUDE_COMMAND_PATHS,
  );

  if (normalizedRepositoryPath(claudePlugin.skills) !== "qa-suite") {
    throw new Error("Claude Code skill path must resolve to qa-suite/");
  }
  if (
    normalizedRepositoryPath(claudePlugin.commands) !== ".claude/commands"
  ) {
    throw new Error(
      "Claude Code command path must resolve to .claude/commands/",
    );
  }
  if (
    normalizedRepositoryPath(claudeMarketplace.plugins?.[0]?.source) !== ""
  ) {
    throw new Error("Claude Code marketplace source must resolve to repo root");
  }
  if (normalizedRepositoryPath(codexPlugin.skills) !== "qa-suite") {
    throw new Error("Codex skill path must resolve to qa-suite/");
  }
  if (
    codexMarketplace.plugins?.[0]?.source?.source !== "local" ||
    normalizedRepositoryPath(
      codexMarketplace.plugins?.[0]?.source?.path,
    ) !== ""
  ) {
    throw new Error("Codex marketplace source must resolve to repo root");
  }

  assertDirectoryExists(files, claudePlugin.skills);
  assertDirectoryExists(files, claudePlugin.commands);
  assertDirectoryExists(files, codexPlugin.skills);

  return {
    claude_ai: {
      asset: "qa-suite.skill",
      tree: "qa-suite/",
    },
    source_archive: {
      asset: "qa-suite-source.zip",
      tree: "qa-suite/",
    },
    local_skill: {
      tree: "qa-suite/",
    },
    claude_code: {
      manifest: ".claude-plugin/plugin.json",
      marketplace: ".claude-plugin/marketplace.json",
      agents: CLAUDE_AGENT_PATHS,
      commands: CLAUDE_COMMAND_PATHS,
      skill: "qa-suite/",
    },
    codex: {
      manifest: ".codex-plugin/plugin.json",
      marketplace: ".agents/plugins/marketplace.json",
      skill: "qa-suite/",
    },
  };
}

export function assertVersionContract(ref, expectedTag) {
  const commit = resolveCommit(ref);
  const version = readGitFile(commit, "VERSION").trim();

  if (!SEMANTIC_VERSION.test(version)) {
    throw new Error(`VERSION must contain x.y.z; received ${version}`);
  }

  const observedVersions = new Map([
    [
      ".codex-plugin/plugin.json",
      parseGitJson(commit, ".codex-plugin/plugin.json").version,
    ],
    [
      ".claude-plugin/plugin.json",
      parseGitJson(commit, ".claude-plugin/plugin.json").version,
    ],
    [
      ".claude-plugin/marketplace.json",
      parseGitJson(commit, ".claude-plugin/marketplace.json").plugins?.[0]
        ?.version,
    ],
  ]);

  for (const [path, observedVersion] of observedVersions) {
    if (observedVersion !== version) {
      throw new Error(
        `${path} declares ${observedVersion ?? "no version"}; expected ${version}`,
      );
    }
  }

  const readme = readGitFile(commit, "README.md");
  const repositoryVersionStatement =
    `Repository package version: \`v${version}\`.`;
  if (!readme.includes(repositoryVersionStatement)) {
    throw new Error(
      `README.md must contain the repository-version statement for v${version}`,
    );
  }

  const externalReferences = assertExternalReferenceContract(commit);
  const channels = assertDistributionChannels(commit);

  if (expectedTag !== undefined) {
    assertReleaseTag(expectedTag);
    if (expectedTag !== `v${version}`) {
      throw new Error(
        `Release tag ${expectedTag} does not match VERSION ${version}`,
      );
    }
  }

  return { channels, commit, externalReferences, version };
}

export function assertReleaseTag(tag) {
  if (!RELEASE_TAG.test(tag)) {
    throw new Error(`Release tag must use v<major>.<minor>.<patch>: ${tag}`);
  }
}

export function assertRepository(repository) {
  if (!REPOSITORY.test(repository)) {
    throw new Error(`Repository must use owner/name form: ${repository}`);
  }
}

export function selectReleaseByTag(releasePages, tag, options = {}) {
  assertReleaseTag(tag);
  if (
    !Array.isArray(releasePages) ||
    releasePages.some((page) => !Array.isArray(page))
  ) {
    throw new Error("GitHub Releases API pagination response is invalid");
  }

  const matches = releasePages
    .flat()
    .filter((release) => release?.tag_name === tag);

  if (matches.length > 1) {
    throw new Error(`Multiple releases use tag ${tag}`);
  }
  if (matches.length === 0) {
    if (options.allowMissing === true) {
      return null;
    }
    throw new Error(`Release ${tag} was not found`);
  }

  return matches[0];
}

export function fetchReleaseByTag(repository, tag, options = {}) {
  assertRepository(repository);
  assertReleaseTag(tag);

  const output = runCommand("gh", [
    "api",
    "--paginate",
    "--slurp",
    `repos/${repository}/releases?per_page=100`,
  ]);

  let releasePages;
  try {
    releasePages = JSON.parse(output);
  } catch (error) {
    throw new Error(
      `GitHub Releases API returned invalid JSON: ${error.message}`,
    );
  }

  return selectReleaseByTag(releasePages, tag, options);
}

export function assertExpectedReleaseState(release, expectedState) {
  if (expectedState === "draft") {
    if (release.draft !== true) {
      throw new Error("Release is not a draft");
    }
    return;
  }

  if (expectedState === "published") {
    if (release.draft !== false) {
      throw new Error("Release is still a draft");
    }
    if (release.immutable !== true) {
      throw new Error("Published release is not immutable");
    }
    return;
  }

  if (expectedState === "draft-or-immutable") {
    if (release.draft === true) {
      return;
    }
    if (release.draft === false && release.immutable === true) {
      return;
    }
    throw new Error(
      "Release must be a draft or an immutable published release",
    );
  }

  throw new Error(`Unsupported expected release state: ${expectedState}`);
}

async function assertGeneratedFilesAbsent(outputDirectory) {
  await mkdir(outputDirectory, { recursive: true });

  for (const fileName of GENERATED_FILE_NAMES) {
    try {
      await lstat(join(outputDirectory, fileName));
      throw new Error(
        `Refusing to overwrite ${join(outputDirectory, fileName)}`,
      );
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  }
}

export async function sha256(path) {
  const bytes = await readFile(path);
  return createHash("sha256").update(bytes).digest("hex");
}

async function writeBuildEvidence(outputDirectory, evidence) {
  const evidencePath = join(outputDirectory, "build-evidence.json");
  await writeFile(
    evidencePath,
    `${JSON.stringify(evidence, null, 2)}\n`,
    { flag: "wx" },
  );
}

export async function buildArtifacts(ref, outputDirectory) {
  const { channels, commit, version } = assertVersionContract(ref);
  const resolvedOutput = resolve(outputDirectory);
  await assertGeneratedFilesAbsent(resolvedOutput);

  const skillPath = join(resolvedOutput, "qa-suite.skill");
  const sourcePath = join(resolvedOutput, "qa-suite-source.zip");

  runCommand("git", [
    "archive",
    "--format=zip",
    "-0",
    `--output=${skillPath}`,
    commit,
    "qa-suite",
  ], { env: { TZ: "UTC" } });
  await copyFile(skillPath, sourcePath, constants.COPYFILE_EXCL);

  const digest = await sha256(skillPath);
  const sourceDigest = await sha256(sourcePath);
  if (digest !== sourceDigest) {
    throw new Error("The two release asset names do not contain equal bytes");
  }

  await writeFile(
    join(resolvedOutput, "SHA256SUMS"),
    ASSET_NAMES.map((name) => `${digest}  ${name}`).join("\n") + "\n",
    { flag: "wx" },
  );
  await writeBuildEvidence(resolvedOutput, {
    schema_version: 1,
    commit,
    version,
    channels,
    assets: ASSET_NAMES.map((name) => ({
      name,
      sha256: digest,
    })),
  });

  return { commit, version, digest, outputDirectory: resolvedOutput };
}

async function collectTreeEntries(root, current = root) {
  const entries = [];
  const names = await readdir(current);
  names.sort();

  for (const name of names) {
    const path = join(current, name);
    const metadata = await lstat(path);
    const relativePath = relative(root, path).split(sep).join("/");

    if (metadata.isDirectory()) {
      entries.push(...(await collectTreeEntries(root, path)));
      continue;
    }

    if (metadata.isFile()) {
      entries.push({
        path: relativePath,
        type: "file",
        sha256: await sha256(path),
      });
      continue;
    }

    if (metadata.isSymbolicLink()) {
      entries.push({
        path: relativePath,
        type: "symlink",
        target: await readlink(path),
      });
      continue;
    }

    throw new Error(`Unsupported archive entry type: ${relativePath}`);
  }

  return entries;
}

async function expectedTree(commit, temporaryDirectory) {
  const archivePath = join(temporaryDirectory, "expected.tar");
  const extractionPath = join(temporaryDirectory, "expected");
  await mkdir(extractionPath);

  runCommand("git", [
    "archive",
    "--format=tar",
    `--output=${archivePath}`,
    commit,
    "qa-suite",
  ], { env: { TZ: "UTC" } });
  runCommand("tar", ["-xf", archivePath, "-C", extractionPath]);

  return collectTreeEntries(extractionPath);
}

async function extractedTree(assetPath, temporaryDirectory, name) {
  const extractionPath = join(temporaryDirectory, name);
  await mkdir(extractionPath);
  runCommand("unzip", ["-q", assetPath, "-d", extractionPath]);
  return collectTreeEntries(extractionPath);
}

export async function verifyArtifactSet(ref, artifactsDirectory) {
  const { commit, version } = assertVersionContract(ref);
  const resolvedArtifacts = resolve(artifactsDirectory);
  const digests = new Map();

  for (const assetName of ASSET_NAMES) {
    const assetPath = join(resolvedArtifacts, assetName);
    const metadata = await lstat(assetPath);
    if (!metadata.isFile()) {
      throw new Error(`${assetPath} is not a regular file`);
    }
    digests.set(assetName, await sha256(assetPath));
  }

  if (new Set(digests.values()).size !== 1) {
    throw new Error("Release assets are not byte-identical");
  }

  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "qa-suite-release-verify-"),
  );

  try {
    const expectedEntries = await expectedTree(commit, temporaryDirectory);
    for (const assetName of ASSET_NAMES) {
      const observedEntries = await extractedTree(
        join(resolvedArtifacts, assetName),
        temporaryDirectory,
        assetName.replaceAll(".", "-"),
      );
      if (
        JSON.stringify(observedEntries) !== JSON.stringify(expectedEntries)
      ) {
        throw new Error(
          `${assetName} does not match qa-suite/ at commit ${commit}`,
        );
      }
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }

  return {
    commit,
    version,
    digest: digests.get("qa-suite.skill"),
  };
}

export async function copyGeneratedFiles(sourceDirectory, outputDirectory) {
  const resolvedOutput = resolve(outputDirectory);
  await assertGeneratedFilesAbsent(resolvedOutput);

  for (const fileName of GENERATED_FILE_NAMES) {
    await copyFile(
      join(sourceDirectory, fileName),
      join(resolvedOutput, fileName),
      constants.COPYFILE_EXCL,
    );
  }
}

export async function compareBuilds(firstDirectory, secondDirectory) {
  for (const assetName of ASSET_NAMES) {
    const firstDigest = await sha256(join(firstDirectory, assetName));
    const secondDigest = await sha256(join(secondDirectory, assetName));
    if (firstDigest !== secondDigest) {
      throw new Error(
        `${assetName} is not reproducible across independent builds`,
      );
    }
  }
}
