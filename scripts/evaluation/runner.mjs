import { randomBytes } from "node:crypto";
import { constants as fileConstants } from "node:fs";
import {
  appendFile,
  chmod,
  lstat,
  mkdir,
  open,
  opendir,
  readFile,
  realpath,
  rename,
  writeFile,
} from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalJson,
  CASE_DISCLOSURE_PATH,
  createCaseDisclosure,
  parseContractJson,
  sha256,
  validateClosedCaseRun,
  validateFixtureManifest,
  validateSuite,
} from "./contracts.mjs";
import {
  assertSafeRepositoryPath,
  listTreeAtCommit,
  materializeEntries,
  readBlobAtCommit,
  readBlobMetadataAtCommit,
  resolveCommit,
  verifyWorkingFilesAtCommit,
} from "./git-snapshot.mjs";

const RUN_ID = /^run_[0-9a-f]{32}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const ZERO_DIGEST = "0".repeat(64);
const JOURNAL_EVENTS = new Set([
  "close_started",
  "closed",
  "invalid",
  "prepared",
]);
const MAX_INPUT_FILES = 2_048;
const MAX_INPUT_NODES = MAX_INPUT_FILES * 8;
const MAX_INPUT_BYTES = 32 * 1024 * 1024;
const MAX_ARTIFACT_FILES = 512;
const MAX_ARTIFACT_NODES = 2_048;
const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;
const MAX_ARTIFACT_FILE_BYTES = 16 * 1024 * 1024;
const MAX_JOURNAL_BYTES = 1024 * 1024;
const MAX_STATE_BYTES = 8 * 1024 * 1024;
const MAX_TREE_DEPTH = 32;
const CONTROLLER_PROGRAM_PATHS = Object.freeze([
  "qa-suite/scripts/finding-ledger.mjs",
  "scripts/evaluation/bob-host-executor.mjs",
  "scripts/evaluation/bob-host-protocol.mjs",
  "scripts/evaluation/bob-report-adapter.mjs",
  "scripts/evaluation/browser-gateway.mjs",
  "scripts/evaluation/contracts.mjs",
  "scripts/evaluation/git-snapshot.mjs",
  "scripts/evaluation/run-case.mjs",
  "scripts/evaluation/runner.mjs",
]);
const EXECUTING_REPOSITORY_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);

function assertObject(value, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new Error(`${label} must be an object`);
  }
}

function assertExactKeys(value, expected, label) {
  assertObject(value, label);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new Error(
      `${label} fields are ${actual.join(", ")}; expected ${wanted.join(", ")}`,
    );
  }
}

function assertString(value, label, pattern) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim().length === 0
  ) {
    throw new Error(`${label} must be a non-empty string`);
  }
  if (pattern && !pattern.test(value)) {
    throw new Error(`${label} has an invalid value`);
  }
  return value;
}

function comparePaths(left, right) {
  return Buffer.compare(
    Buffer.from(left.path, "utf8"),
    Buffer.from(right.path, "utf8"),
  );
}

function pathReference(path) {
  return `path-sha256:${sha256(Buffer.from(path, "utf8"))}`;
}

function assertResourceInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function stableMetadata(metadata) {
  return {
    ctime_ns: metadata.ctimeNs.toString(),
    device: metadata.dev.toString(),
    inode: metadata.ino.toString(),
    links: metadata.nlink.toString(),
    mode: metadata.mode.toString(),
    mtime_ns: metadata.mtimeNs.toString(),
    size: metadata.size.toString(),
  };
}

function assertStandaloneFile(metadata, label) {
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.nlink !== 1n
  ) {
    throw new Error(`${label} must be a standalone regular file`);
  }
}

function noFollowReadFlags() {
  if (!Number.isInteger(fileConstants.O_NOFOLLOW)) {
    throw new Error("platform does not provide no-follow file opens");
  }
  return fileConstants.O_RDONLY | fileConstants.O_NOFOLLOW;
}

function assertStableReadSize(
  metadata,
  {
    expectedSize,
    maxBytes,
  },
  label,
) {
  if (
    maxBytes !== undefined &&
    metadata.size > BigInt(maxBytes)
  ) {
    throw new Error(`${label} exceeds ${maxBytes} bytes`);
  }
  if (
    expectedSize !== undefined &&
    metadata.size !== BigInt(expectedSize)
  ) {
    throw new Error(`${label} changed before it was read`);
  }
}

async function readExactFileHandle(handle, expectedSize, label) {
  assertResourceInteger(expectedSize, "expected file size");
  const bytes = Buffer.alloc(expectedSize);
  let offset = 0;
  while (offset < expectedSize) {
    const { bytesRead } = await handle.read(
      bytes,
      offset,
      expectedSize - offset,
      offset,
    );
    if (bytesRead === 0) {
      throw new Error(`${label} changed while it was read`);
    }
    offset += bytesRead;
  }
  const probe = Buffer.alloc(1);
  const { bytesRead: trailingBytes } = await handle.read(
    probe,
    0,
    1,
    expectedSize,
  );
  if (trailingBytes !== 0) {
    throw new Error(`${label} exceeds its accepted size`);
  }
  return bytes;
}

async function readStableFile(
  path,
  label,
  {
    expectedSize,
    maxBytes,
  } = {},
) {
  const before = await lstat(path, { bigint: true });
  assertStandaloneFile(before, label);
  assertStableReadSize(before, { expectedSize, maxBytes }, label);
  const handle = await open(
    path,
    noFollowReadFlags(),
  );
  try {
    const openedBefore = await handle.stat({ bigint: true });
    assertStandaloneFile(openedBefore, label);
    assertStableReadSize(
      openedBefore,
      { expectedSize, maxBytes },
      label,
    );
    if (
      canonicalJson(stableMetadata(before)) !==
      canonicalJson(stableMetadata(openedBefore))
    ) {
      throw new Error(`${label} changed before it was opened`);
    }
    const bytes = await readExactFileHandle(
      handle,
      Number(openedBefore.size),
      label,
    );
    const openedAfter = await handle.stat({ bigint: true });
    if (
      canonicalJson(stableMetadata(openedBefore)) !==
      canonicalJson(stableMetadata(openedAfter))
    ) {
      throw new Error(`${label} changed while it was read`);
    }
    return {
      bytes,
      metadata: openedAfter,
    };
  } finally {
    await handle.close();
  }
}

function decodeUtf8(bytes, label) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new Error(`${label} must be valid UTF-8`, { cause: error });
  }
}

function isInside(parent, child) {
  const path = relative(parent, child);
  return (
    path !== "" &&
    path !== ".." &&
    !path.startsWith(`..${sep}`) &&
    !isAbsolute(path)
  );
}

function assertSeparatedParents({
  laneParent,
  repositoryPath,
  stateParent,
}) {
  if (
    laneParent === stateParent ||
    isInside(laneParent, stateParent) ||
    isInside(stateParent, laneParent)
  ) {
    throw new Error(
      "laneParent and stateParent must be separate, non-nested directories",
    );
  }
  if (
    laneParent === repositoryPath ||
    stateParent === repositoryPath ||
    isInside(repositoryPath, laneParent) ||
    isInside(repositoryPath, stateParent)
  ) {
    throw new Error("run parents must be outside the controller repository");
  }
}

function publicEntry(blob, scope) {
  return {
    git_mode: blob.mode,
    object_id: blob.object_id,
    path: blob.path,
    scope,
    sha256: blob.sha256,
    size: blob.size,
  };
}

function totalSize(entries) {
  return entries.reduce((sum, { size }) => sum + size, 0);
}

function assertInputLimits(entries) {
  if (entries.length > MAX_INPUT_FILES) {
    throw new Error(`frozen input exceeds ${MAX_INPUT_FILES} files`);
  }
  if (totalSize(entries) > MAX_INPUT_BYTES) {
    throw new Error(`frozen input exceeds ${MAX_INPUT_BYTES} bytes`);
  }
}

function assertInputTreeShape(entries, writableRoots) {
  const filePaths = [
    CASE_DISCLOSURE_PATH,
    ...entries.map(({ path }) => path),
  ];
  const directoryPaths = new Set();
  function addDirectory(path) {
    directoryPaths.add(path);
    if (filePaths.length + directoryPaths.size > MAX_INPUT_NODES) {
      throw new Error(`frozen input exceeds ${MAX_INPUT_NODES} nodes`);
    }
  }
  function addParents(path, { includePath = false } = {}) {
    const segments = path.split("/");
    if (segments.length > MAX_TREE_DEPTH) {
      throw new Error(`frozen input exceeds depth ${MAX_TREE_DEPTH}`);
    }
    const limit = includePath ? segments.length : segments.length - 1;
    let parent = "";
    for (let index = 0; index < limit; index += 1) {
      parent = parent ? `${parent}/${segments[index]}` : segments[index];
      addDirectory(parent);
    }
  }
  for (const path of filePaths) {
    addParents(path);
  }
  for (const root of writableRoots) {
    addParents(root, { includePath: true });
  }
}

function reportFolderFromContext(source) {
  const matches = [
    ...source.matchAll(
      /^- \*\*Report output folder:\*\*\s+([^\r\n]+?)\s*$/gmu,
    ),
  ];
  if (matches.length !== 1) {
    throw new Error("qa-context must declare one Report output folder");
  }
  const value = matches[0][1].replace(/\/+$/u, "");
  assertSafeRepositoryPath(value, "Report output folder");
  return value;
}

function pathIsWithinRoot(path, root) {
  return path === root || path.startsWith(`${root}/`);
}

function assertNoInputOverlap(entries, writableRoots) {
  const paths = [CASE_DISCLOSURE_PATH, ...entries.map(({ path }) => path)];
  for (const root of writableRoots) {
    const overlap = paths.find(
      (path) =>
        pathIsWithinRoot(path, root) || pathIsWithinRoot(root, path),
    );
    if (overlap) {
      throw new Error(
        `writable root ${pathReference(root)} overlaps immutable path ${pathReference(overlap)}`,
      );
    }
  }
  const seen = new Set();
  for (const path of paths) {
    if (seen.has(path)) {
      throw new Error(
        `frozen input contains duplicate path ${pathReference(path)}`,
      );
    }
    seen.add(path);
  }
}

async function loadFrozenCase({
  caseId,
  controllerProgramPaths,
  controllerRef,
  repositoryPath,
  subjectRef,
  suitePath,
  writableRoots,
}) {
  const controllerCommit = await resolveCommit({
    ref: controllerRef,
    repositoryPath,
  });
  const subjectCommit = await resolveCommit({
    ref: subjectRef,
    repositoryPath,
  });
  const program = await verifyWorkingFilesAtCommit({
    commit: controllerCommit,
    paths: controllerProgramPaths,
    repositoryPath,
    workingRoot: EXECUTING_REPOSITORY_ROOT,
  });
  const suiteBlob = await readBlobAtCommit({
    commit: controllerCommit,
    maxBytes: MAX_INPUT_BYTES,
    path: suitePath,
    repositoryPath,
  });
  const suite = parseContractJson(
    decodeUtf8(suiteBlob.bytes, "suite"),
    "suite",
  );
  validateSuite(suite);
  const suiteCase = suite.cases.find(({ id }) => id === caseId);
  if (!suiteCase) {
    throw new Error(`suite does not contain case ${caseId}`);
  }
  const manifestBlob = await readBlobAtCommit({
    commit: controllerCommit,
    maxBytes: MAX_INPUT_BYTES,
    path: suiteCase.fixture_manifest,
    repositoryPath,
  });
  const manifest = parseContractJson(
    decodeUtf8(manifestBlob.bytes, "fixture manifest"),
    "fixture manifest",
  );
  validateFixtureManifest(manifest, suiteCase);
  const fixtureMetadata = [];
  for (const declaration of manifest.files) {
    const metadata = await readBlobMetadataAtCommit({
      commit: controllerCommit,
      path: declaration.path,
      repositoryPath,
    });
    if (metadata.mode !== declaration.mode) {
      throw new Error(
        `fixture ${pathReference(declaration.path)} differs from its manifest`,
      );
    }
    fixtureMetadata.push({
      ...metadata,
      declared_sha256: declaration.sha256,
    });
  }
  const subjectTree = await listTreeAtCommit({
    commit: subjectCommit,
    maxEntries: MAX_INPUT_FILES,
    prefix: "qa-suite",
    repositoryPath,
  });
  if (fixtureMetadata.length + subjectTree.length > MAX_INPUT_FILES) {
    throw new Error(`frozen input exceeds ${MAX_INPUT_FILES} files`);
  }
  let preflightBytes = totalSize(fixtureMetadata);
  if (
    !Number.isSafeInteger(preflightBytes) ||
    preflightBytes > MAX_INPUT_BYTES
  ) {
    throw new Error(`frozen input exceeds ${MAX_INPUT_BYTES} bytes`);
  }
  const subjectMetadata = [];
  for (const entry of subjectTree) {
    const metadata = await readBlobMetadataAtCommit({
      commit: subjectCommit,
      path: entry.path,
      repositoryPath,
    });
    if (
      metadata.mode !== entry.mode ||
      metadata.object_id !== entry.object_id
    ) {
      throw new Error("subject Git metadata changed during preflight");
    }
    subjectMetadata.push(metadata);
    preflightBytes += metadata.size;
    if (
      !Number.isSafeInteger(preflightBytes) ||
      preflightBytes > MAX_INPUT_BYTES
    ) {
      throw new Error(`frozen input exceeds ${MAX_INPUT_BYTES} bytes`);
    }
  }
  const inputMetadata = [...fixtureMetadata, ...subjectMetadata];
  assertInputLimits(inputMetadata);
  assertNoInputOverlap(inputMetadata, writableRoots);
  assertInputTreeShape(inputMetadata, writableRoots);

  const fixtureEntries = [];
  let qaContextBytes;
  for (const metadata of fixtureMetadata) {
    const blob = await readBlobAtCommit({
      commit: controllerCommit,
      maxBytes: metadata.size,
      path: metadata.path,
      repositoryPath,
    });
    if (
      blob.mode !== metadata.mode ||
      blob.object_id !== metadata.object_id ||
      blob.size !== metadata.size ||
      blob.sha256 !== metadata.declared_sha256
    ) {
      throw new Error(
        `fixture ${pathReference(metadata.path)} differs from its manifest`,
      );
    }
    fixtureEntries.push(publicEntry(blob, "fixture"));
    if (metadata.path === suiteCase.qa_context) {
      qaContextBytes = blob.bytes;
    }
  }
  if (!qaContextBytes) {
    throw new Error("fixture qa-context bytes are unavailable");
  }
  const reportFolder = reportFolderFromContext(
    decodeUtf8(qaContextBytes, "qa-context"),
  );
  if (
    writableRoots.length !== 1 ||
    writableRoots[0] !== reportFolder
  ) {
    throw new Error(
      `writable roots must equal ${pathReference(reportFolder)}`,
    );
  }

  const subjectEntries = [];
  for (const metadata of subjectMetadata) {
    const blob = await readBlobAtCommit({
      commit: subjectCommit,
      maxBytes: metadata.size,
      path: metadata.path,
      repositoryPath,
    });
    if (
      blob.mode !== metadata.mode ||
      blob.object_id !== metadata.object_id ||
      blob.size !== metadata.size
    ) {
      throw new Error("subject Git object changed after preflight");
    }
    subjectEntries.push(publicEntry(blob, "subject"));
  }
  const inputs = [...fixtureEntries, ...subjectEntries].sort(comparePaths);
  const runId = `run_${randomBytes(16).toString("hex")}`;
  const disclosure = createCaseDisclosure({
    runId,
    subjectCommit,
    suite,
    suiteCase,
    writableRoots,
  });
  return {
    case_id: suiteCase.id,
    confidential_values: [
      ...suite.cases
        .flatMap(({ oracle_commitments: commitments }) => commitments),
      ...suite.cases
        .filter(({ id }) => id !== suiteCase.id)
        .map(({ id }) => id),
    ].sort(),
    controller_commit: controllerCommit,
    controller_program: program,
    fixture_entries: fixtureEntries,
    inputs,
    lane: suite.lane,
    report_folder: reportFolder,
    run_id: runId,
    subject_commit: subjectCommit,
    subject_entries: subjectEntries,
    suite_id: suite.id,
    suite_path: suitePath,
    writable_roots: writableRoots,
    disclosure,
  };
}

function pathDirectories(path) {
  const segments = path.split("/");
  const directories = [];
  for (let index = 1; index < segments.length; index += 1) {
    directories.push(segments.slice(0, index).join("/"));
  }
  return directories;
}

function preparedDirectoryPaths(frozen) {
  return [
    ...new Set(
      [
        ...frozen.inputs.flatMap(({ path }) => pathDirectories(path)),
        ...pathDirectories(CASE_DISCLOSURE_PATH),
        ...frozen.writable_roots.flatMap((path) => [
          ...pathDirectories(path),
          path,
        ]),
      ],
    ),
  ].sort((left, right) =>
    Buffer.compare(Buffer.from(left), Buffer.from(right)),
  );
}

async function freezeLaneDirectories(laneRoot, frozen) {
  const writable = new Set(frozen.writable_roots);
  const directories = preparedDirectoryPaths(frozen).sort(
    (left, right) => right.split("/").length - left.split("/").length,
  );
  for (const path of directories) {
    await chmod(
      join(laneRoot, ...path.split("/")),
      writable.has(path) ? 0o700 : 0o555,
    );
  }
  await chmod(laneRoot, 0o555);
}

function permissionString(metadata) {
  const permissions =
    typeof metadata.mode === "bigint"
      ? Number(metadata.mode & 0o777n)
      : metadata.mode & 0o777;
  return permissions.toString(8).padStart(4, "0");
}

async function inventoryRoot(
  root,
  {
    maxBytes = MAX_INPUT_BYTES,
    maxDepth = MAX_TREE_DEPTH,
    maxFileBytes = MAX_INPUT_BYTES,
    maxFiles = MAX_INPUT_FILES,
    maxNodes = MAX_INPUT_NODES,
  } = {},
) {
  for (const [label, value] of Object.entries({
    maxBytes,
    maxDepth,
    maxFileBytes,
    maxFiles,
    maxNodes,
  })) {
    assertResourceInteger(value, label);
  }
  const rootMetadata = await lstat(root);
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw new Error("lane root must be a real directory");
  }
  const nodes = [];
  let observedBytes = 0;
  let observedFiles = 0;
  let observedNodes = 0;
  async function visit(directory, prefix = "", parentDepth = 0) {
    const entries = await opendir(directory);
    for await (const entry of entries) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      assertSafeRepositoryPath(path, "lane path");
      const depth = parentDepth + 1;
      if (depth > maxDepth) {
        throw new Error(`lane tree exceeds depth ${maxDepth}`);
      }
      observedNodes += 1;
      if (observedNodes > maxNodes) {
        throw new Error(`lane tree exceeds ${maxNodes} nodes`);
      }
      const absolutePath = join(directory, entry.name);
      const metadata = await lstat(absolutePath);
      if (metadata.isSymbolicLink()) {
        throw new Error(
          `lane path ${pathReference(path)} cannot be a symbolic link`,
        );
      }
      if (metadata.isDirectory()) {
        nodes.push({
          mode: permissionString(metadata),
          path,
          type: "directory",
        });
        await visit(absolutePath, path, depth);
        continue;
      }
      if (!metadata.isFile() || metadata.nlink !== 1) {
        throw new Error(
          `lane path ${pathReference(path)} must be a standalone regular file`,
        );
      }
      observedFiles += 1;
      if (observedFiles > maxFiles) {
        throw new Error(`lane tree exceeds ${maxFiles} files`);
      }
      assertResourceInteger(metadata.size, "lane file size");
      if (metadata.size > maxFileBytes) {
        throw new Error(
          `lane file ${pathReference(path)} exceeds ${maxFileBytes} bytes`,
        );
      }
      observedBytes += metadata.size;
      if (!Number.isSafeInteger(observedBytes) || observedBytes > maxBytes) {
        throw new Error(`lane tree exceeds ${maxBytes} bytes`);
      }
      const { bytes } = await readStableFile(
        absolutePath,
        `lane file ${pathReference(path)}`,
        {
          expectedSize: metadata.size,
          maxBytes: maxFileBytes,
        },
      );
      if (bytes.length !== metadata.size) {
        throw new Error(
          `lane file ${pathReference(path)} changed while inventoried`,
        );
      }
      nodes.push({
        mode: permissionString(metadata),
        path,
        sha256: sha256(bytes),
        size: bytes.length,
        type: "file",
      });
    }
  }
  await visit(root);
  nodes.sort(comparePaths);
  return {
    nodes,
    root_mode: permissionString(rootMetadata),
    sha256: sha256(canonicalJson(nodes)),
  };
}

function immutableFileInventory(frozen, disclosureBytes) {
  return [
    ...frozen.inputs.map((entry) => ({
      mode: entry.git_mode === "100755" ? "0555" : "0444",
      path: entry.path,
      sha256: entry.sha256,
      size: entry.size,
      type: "file",
    })),
    {
      mode: "0444",
      path: CASE_DISCLOSURE_PATH,
      sha256: sha256(disclosureBytes),
      size: disclosureBytes.length,
      type: "file",
    },
  ].sort(comparePaths);
}

function assertPreparedInventory({ disclosureBytes, frozen, inventory }) {
  if (inventory.root_mode !== "0555") {
    throw new Error("prepared lane root must use mode 0555");
  }
  const expectedFiles = immutableFileInventory(frozen, disclosureBytes);
  const observedFiles = inventory.nodes.filter(({ type }) => type === "file");
  if (canonicalJson(observedFiles) !== canonicalJson(expectedFiles)) {
    throw new Error("prepared lane files differ from frozen input");
  }
  const writable = new Set(frozen.writable_roots);
  const expectedDirectories = preparedDirectoryPaths(frozen).map((path) => ({
    mode: writable.has(path) ? "0700" : "0555",
    path,
    type: "directory",
  }));
  const observedDirectories = inventory.nodes.filter(
    ({ type }) => type === "directory",
  );
  if (
    canonicalJson(observedDirectories) !== canonicalJson(expectedDirectories)
  ) {
    throw new Error("prepared lane directories differ from the disclosure");
  }
}

async function scanForbiddenStrings(root, inventory, values) {
  const unique = [...new Set(values)];
  for (const value of unique) {
    assertString(value, "forbidden value");
  }
  for (const node of inventory.nodes) {
    if (unique.some((value) => node.path.includes(value))) {
      throw new Error(
        `controller-value-leak in lane path ${pathReference(node.path)}`,
      );
    }
    if (node.type !== "file") continue;
    const { bytes } = await readStableFile(
      join(root, ...node.path.split("/")),
      `lane file ${pathReference(node.path)}`,
      {
        expectedSize: node.size,
        maxBytes: node.size,
      },
    );
    if (sha256(bytes) !== node.sha256) {
      throw new Error(
        `lane file ${pathReference(node.path)} changed before scanning`,
      );
    }
    if (
      unique.some((value) =>
        bytes.includes(Buffer.from(value, "utf8")),
      )
    ) {
      throw new Error(
        `controller-value-leak in lane file ${pathReference(node.path)}`,
      );
    }
  }
  return unique.length;
}

async function writeJsonExclusive(path, value, mode = 0o600) {
  await writeFile(path, canonicalJson(value), {
    flag: "wx",
    mode,
  });
  await chmod(path, mode);
}

function canonicalJsonLine(value) {
  return `${JSON.stringify(JSON.parse(canonicalJson(value)))}\n`;
}

function journalHash(entry) {
  const unsigned = { ...entry };
  delete unsigned.sha256;
  return sha256(canonicalJson(unsigned));
}

function createJournalEntry({
  event,
  payloadDigest,
  previousDigest,
  runId,
  sequence,
}) {
  const entry = {
    event,
    payload_sha256: payloadDigest,
    previous_sha256: previousDigest,
    run_id: runId,
    schema_version: 1,
    sequence,
  };
  return {
    ...entry,
    sha256: journalHash(entry),
  };
}

function validateJournalEntry(value, index, previousDigest, runId) {
  const label = `journal[${index}]`;
  assertExactKeys(
    value,
    [
      "event",
      "payload_sha256",
      "previous_sha256",
      "run_id",
      "schema_version",
      "sequence",
      "sha256",
    ],
    label,
  );
  if (value.schema_version !== 1) {
    throw new Error(`${label}.schema_version must equal 1`);
  }
  if (value.run_id !== runId || !RUN_ID.test(value.run_id)) {
    throw new Error(`${label}.run_id does not match state`);
  }
  if (value.sequence !== index + 1) {
    throw new Error(`${label}.sequence is not monotonic`);
  }
  if (!JOURNAL_EVENTS.has(value.event)) {
    throw new Error(`${label}.event is unsupported`);
  }
  assertString(value.payload_sha256, `${label}.payload_sha256`, SHA256);
  assertString(value.previous_sha256, `${label}.previous_sha256`, SHA256);
  assertString(value.sha256, `${label}.sha256`, SHA256);
  if (value.previous_sha256 !== previousDigest) {
    throw new Error(`${label}.previous_sha256 breaks the chain`);
  }
  if (journalHash(value) !== value.sha256) {
    throw new Error(`${label}.sha256 does not match its bytes`);
  }
  return value.sha256;
}

function assertJournalTransitions(entries) {
  const events = entries.map(({ event }) => event);
  const allowed = [
    ["prepared"],
    ["prepared", "close_started"],
    ["prepared", "close_started", "closed"],
    ["prepared", "close_started", "invalid"],
  ];
  if (!allowed.some((value) => canonicalJson(value) === canonicalJson(events))) {
    throw new Error("journal contains an invalid state transition");
  }
}

async function readJournal(path, runId) {
  const metadata = await lstat(path);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.nlink !== 1 ||
    (metadata.mode & 0o777) !== 0o600
  ) {
    throw new Error("journal must be a private standalone regular file");
  }
  const { bytes } = await readStableFile(path, "journal", {
    expectedSize: metadata.size,
    maxBytes: MAX_JOURNAL_BYTES,
  });
  const source = decodeUtf8(bytes, "journal");
  if (!source.endsWith("\n")) {
    throw new Error("journal must end with a newline");
  }
  const lines = source.slice(0, -1).split("\n");
  if (lines.length === 0 || lines.some((line) => line.length === 0)) {
    throw new Error("journal must contain complete JSONL rows");
  }
  const entries = lines.map((line, index) =>
    parseContractJson(line, `journal[${index}]`),
  );
  let previousDigest = ZERO_DIGEST;
  entries.forEach((entry, index) => {
    previousDigest = validateJournalEntry(
      entry,
      index,
      previousDigest,
      runId,
    );
  });
  assertJournalTransitions(entries);
  return entries;
}

async function appendJournalEvent({
  event,
  journalPath,
  payloadDigest,
  runId,
}) {
  const entries = await readJournal(journalPath, runId);
  const previous = entries.at(-1);
  const entry = createJournalEntry({
    event,
    payloadDigest,
    previousDigest: previous.sha256,
    runId,
    sequence: previous.sequence + 1,
  });
  await appendFile(journalPath, canonicalJsonLine(entry), {
    encoding: "utf8",
  });
  return entry;
}

function preparationRecord({ frozen, inventory, programBinding }) {
  return {
    case_id: frozen.case_id,
    claims: {
      adapter_status: "not-run",
      artifact_inventory: "not-closed",
      context_isolation: "not-attested",
      execution_isolation: "not-attested",
      fixture_opacity: "not-attested",
      input_integrity: "verified",
      method_order: "unverified_by_report",
      network_isolation: "not-attested",
      state_authentication: "not-attested",
    },
    confidentiality: "controller-only",
    controller_commit: frozen.controller_commit,
    controller_program_sha256: programBinding.sha256,
    input_file_count: frozen.inputs.length + 1,
    input_tree_sha256: inventory.sha256,
    lane: frozen.lane,
    node_version: process.version,
    qualification: "not-evidence",
    result: null,
    run_id: frozen.run_id,
    schema_version: 1,
    subject_commit: frozen.subject_commit,
    suite_id: frozen.suite_id,
    verification_status: "unverified",
  };
}

function nonQualificationSummary(record) {
  return {
    claims: record.claims,
    qualification: record.qualification,
    result: record.result,
    verification_status: record.verification_status,
  };
}

function privateState({
  controllerProgramPaths,
  frozen,
  inventory,
  laneRoot,
  preparation,
  repositoryPath,
}) {
  return {
    case_id: frozen.case_id,
    confidential_values: frozen.confidential_values,
    controller_commit: frozen.controller_commit,
    controller_program_paths: controllerProgramPaths,
    immutable_files: inventory.nodes.filter(({ type }) => type === "file"),
    lane: frozen.lane,
    lane_root: laneRoot,
    preparation,
    prepared_inventory: inventory,
    repository_path: repositoryPath,
    run_id: frozen.run_id,
    schema_version: 1,
    subject_commit: frozen.subject_commit,
    suite_id: frozen.suite_id,
    suite_path: frozen.suite_path,
    writable_roots: frozen.writable_roots,
  };
}

function validatePrivateState(value) {
  assertExactKeys(
    value,
    [
      "case_id",
      "confidential_values",
      "controller_commit",
      "controller_program_paths",
      "immutable_files",
      "lane",
      "lane_root",
      "preparation",
      "prepared_inventory",
      "repository_path",
      "run_id",
      "schema_version",
      "subject_commit",
      "suite_id",
      "suite_path",
      "writable_roots",
    ],
    "private state",
  );
  if (value.schema_version !== 1) {
    throw new Error("private state.schema_version must equal 1");
  }
  assertString(value.run_id, "private state.run_id", RUN_ID);
  if (!isAbsolute(value.lane_root) || !isAbsolute(value.repository_path)) {
    throw new Error("private state paths must be absolute");
  }
  if (!Array.isArray(value.immutable_files) || value.immutable_files.length < 2) {
    throw new Error("private state immutable_files is incomplete");
  }
  if (
    !Array.isArray(value.confidential_values) ||
    value.confidential_values.length < 2 ||
    new Set(value.confidential_values).size !==
      value.confidential_values.length
  ) {
    throw new Error("private state confidential_values is incomplete");
  }
  value.confidential_values.forEach((entry, index) =>
    assertString(entry, `private state.confidential_values[${index}]`),
  );
  if (!Array.isArray(value.writable_roots) || value.writable_roots.length < 1) {
    throw new Error("private state writable_roots is incomplete");
  }
  return value;
}

async function materializeCase({
  controllerProgramPaths,
  frozen,
  laneRoot,
  repositoryPath,
}) {
  await materializeEntries({
    commit: frozen.controller_commit,
    destination: laneRoot,
    entries: frozen.fixture_entries.map((entry) => ({
      mode: entry.git_mode,
      object_id: entry.object_id,
      path: entry.path,
    })),
    repositoryPath,
  });
  await materializeEntries({
    commit: frozen.subject_commit,
    destination: laneRoot,
    entries: frozen.subject_entries.map((entry) => ({
      mode: entry.git_mode,
      object_id: entry.object_id,
      path: entry.path,
    })),
    repositoryPath,
  });
  const disclosureBytes = Buffer.from(
    canonicalJson(frozen.disclosure),
    "utf8",
  );
  await writeFile(join(laneRoot, CASE_DISCLOSURE_PATH), disclosureBytes, {
    flag: "wx",
    mode: 0o444,
  });
  await chmod(join(laneRoot, CASE_DISCLOSURE_PATH), 0o444);
  for (const root of frozen.writable_roots) {
    await mkdir(join(laneRoot, ...root.split("/")), {
      mode: 0o700,
      recursive: true,
    });
  }
  await freezeLaneDirectories(laneRoot, frozen);
  const inventory = await inventoryRoot(laneRoot, {
    maxBytes: totalSize(frozen.inputs) + disclosureBytes.length,
    maxDepth: MAX_TREE_DEPTH,
    maxFileBytes: MAX_INPUT_BYTES,
    maxFiles: frozen.inputs.length + 1,
    maxNodes: MAX_INPUT_NODES,
  });
  assertPreparedInventory({ disclosureBytes, frozen, inventory });
  await scanForbiddenStrings(
    laneRoot,
    inventory,
    frozen.confidential_values,
  );
  const programBinding = await verifyWorkingFilesAtCommit({
    commit: frozen.controller_commit,
    paths: controllerProgramPaths,
    repositoryPath,
    workingRoot: EXECUTING_REPOSITORY_ROOT,
  });
  return {
    inventory,
    preparation: preparationRecord({
      frozen,
      inventory,
      programBinding,
    }),
  };
}

export async function prepareCaseRun({
  caseId,
  controllerRef,
  laneParent,
  repositoryPath,
  stateParent,
  subjectRef,
  suitePath,
  writableRoots,
}) {
  const controllerProgramPaths = CONTROLLER_PROGRAM_PATHS;
  assertSafeRepositoryPath(suitePath, "suitePath");
  if (!Array.isArray(writableRoots) || writableRoots.length === 0) {
    throw new Error("writableRoots must be a non-empty array");
  }
  const declaredWritableRoots = [...writableRoots];
  declaredWritableRoots.forEach((path, index) =>
    assertSafeRepositoryPath(path, `writableRoots[${index}]`),
  );
  if (
    new Set(declaredWritableRoots).size !==
    declaredWritableRoots.length
  ) {
    throw new Error("writableRoots must contain unique values");
  }
  const repositoryRealPath = await realpath(resolve(repositoryPath));
  const laneParentRealPath = await realpath(resolve(laneParent));
  const stateParentRealPath = await realpath(resolve(stateParent));
  assertSeparatedParents({
    laneParent: laneParentRealPath,
    repositoryPath: repositoryRealPath,
    stateParent: stateParentRealPath,
  });
  const frozen = await loadFrozenCase({
    caseId,
    controllerProgramPaths,
    controllerRef,
    repositoryPath: repositoryRealPath,
    subjectRef,
    suitePath,
    writableRoots: declaredWritableRoots,
  });
  const laneRoot = join(laneParentRealPath, frozen.run_id);
  const stateRoot = join(stateParentRealPath, frozen.run_id);
  await mkdir(stateRoot, { mode: 0o700 });
  await chmod(stateRoot, 0o700);
  await mkdir(laneRoot, { mode: 0o700 });
  await chmod(laneRoot, 0o700);
  const { inventory, preparation } = await materializeCase({
    controllerProgramPaths,
    frozen,
    laneRoot,
    repositoryPath: repositoryRealPath,
  });
  const state = privateState({
    controllerProgramPaths,
    frozen,
    inventory,
    laneRoot,
    preparation,
    repositoryPath: repositoryRealPath,
  });
  const statePath = join(stateRoot, "state.json");
  const journalPath = join(stateRoot, "journal.jsonl");
  await writeJsonExclusive(statePath, state);
  const stateDigest = sha256(canonicalJson(state));
  const preparedEvent = createJournalEntry({
    event: "prepared",
    payloadDigest: stateDigest,
    previousDigest: ZERO_DIGEST,
    runId: frozen.run_id,
    sequence: 1,
  });
  await writeFile(journalPath, canonicalJsonLine(preparedEvent), {
    flag: "wx",
    mode: 0o600,
  });
  await chmod(journalPath, 0o600);
  return {
    controller_commit: frozen.controller_commit,
    lane_root: laneRoot,
    ...nonQualificationSummary(preparation),
    preparation,
    run_id: frozen.run_id,
    state_path: statePath,
    subject_commit: frozen.subject_commit,
  };
}

async function readPrivateState(statePath) {
  if (!isAbsolute(statePath)) {
    throw new Error("statePath must be absolute");
  }
  const metadata = await lstat(statePath);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.nlink !== 1 ||
    (metadata.mode & 0o777) !== 0o600
  ) {
    throw new Error("statePath must be a private standalone regular file");
  }
  const stateRootMetadata = await lstat(dirname(statePath));
  if (
    !stateRootMetadata.isDirectory() ||
    stateRootMetadata.isSymbolicLink() ||
    (stateRootMetadata.mode & 0o777) !== 0o700
  ) {
    throw new Error("state directory must be a private real directory");
  }
  const { bytes } = await readStableFile(
    statePath,
    "private state",
    {
      expectedSize: metadata.size,
      maxBytes: MAX_STATE_BYTES,
    },
  );
  const state = parseContractJson(
    decodeUtf8(bytes, "private state"),
    "private state",
  );
  return validatePrivateState(state);
}

function nodeMap(inventory) {
  return new Map(
    inventory.nodes.map((node) => [`${node.type}\0${node.path}`, node]),
  );
}

function isWritablePath(path, writableRoots) {
  return writableRoots.some((root) => pathIsWithinRoot(path, root));
}

function assertSecureArtifactNode(node) {
  const permissions = Number.parseInt(node.mode, 8);
  if ((permissions & 0o022) !== 0) {
    throw new Error(
      `artifact path ${pathReference(node.path)} cannot be group/world writable`,
    );
  }
  if (node.type === "file" && (permissions & 0o111) !== 0) {
    throw new Error(
      `artifact file ${pathReference(node.path)} cannot be executable`,
    );
  }
}

async function sealWritableRoots(state) {
  let observedBytes = 0;
  let observedFiles = 0;
  let observedNodes = 0;
  async function seal(directory, prefix, parentDepth) {
    const entries = await opendir(directory);
    for await (const entry of entries) {
      const path = `${prefix}/${entry.name}`;
      assertSafeRepositoryPath(path, "artifact path");
      const depth = parentDepth + 1;
      if (depth > MAX_TREE_DEPTH) {
        throw new Error(`artifact tree exceeds depth ${MAX_TREE_DEPTH}`);
      }
      observedNodes += 1;
      if (observedNodes > MAX_ARTIFACT_NODES) {
        throw new Error(`artifact tree exceeds ${MAX_ARTIFACT_NODES} nodes`);
      }
      const absolutePath = join(directory, entry.name);
      const metadata = await lstat(absolutePath);
      if (metadata.isSymbolicLink()) {
        throw new Error(
          `artifact path ${pathReference(path)} cannot be a symbolic link`,
        );
      }
      if (metadata.isDirectory()) {
        await seal(absolutePath, path, depth);
        await chmod(absolutePath, 0o555);
        continue;
      }
      if (!metadata.isFile() || metadata.nlink !== 1) {
        throw new Error(
          `artifact path ${pathReference(path)} must be a standalone regular file`,
        );
      }
      observedFiles += 1;
      if (observedFiles > MAX_ARTIFACT_FILES) {
        throw new Error(`artifacts exceed ${MAX_ARTIFACT_FILES} files`);
      }
      assertResourceInteger(metadata.size, "artifact file size");
      if (metadata.size > MAX_ARTIFACT_FILE_BYTES) {
        throw new Error(
          `artifact file ${pathReference(path)} exceeds ${MAX_ARTIFACT_FILE_BYTES} bytes`,
        );
      }
      observedBytes += metadata.size;
      if (
        !Number.isSafeInteger(observedBytes) ||
        observedBytes > MAX_ARTIFACT_BYTES
      ) {
        throw new Error(`artifacts exceed ${MAX_ARTIFACT_BYTES} bytes`);
      }
      await chmod(absolutePath, 0o444);
    }
  }
  for (const root of state.writable_roots) {
    const path = join(state.lane_root, ...root.split("/"));
    const metadata = await lstat(path);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error(
        `writable root ${pathReference(root)} must remain a real directory`,
      );
    }
    const rootDepth = root.split("/").length;
    if (rootDepth > MAX_TREE_DEPTH) {
      throw new Error(`artifact tree exceeds depth ${MAX_TREE_DEPTH}`);
    }
    await seal(path, root, rootDepth);
    await chmod(path, 0o555);
  }
}

function closeInventory(state, inventory) {
  if (inventory.root_mode !== state.prepared_inventory.root_mode) {
    throw new Error("lane root mode changed after preparation");
  }
  const prepared = nodeMap(state.prepared_inventory);
  const observed = nodeMap(inventory);
  for (const [key, expected] of prepared) {
    if (isWritablePath(expected.path, state.writable_roots)) continue;
    const actual = observed.get(key);
    if (!actual || canonicalJson(actual) !== canonicalJson(expected)) {
      throw new Error(
        `immutable lane input changed at ${pathReference(expected.path)}`,
      );
    }
  }
  for (const root of state.writable_roots) {
    const directory = observed.get(`directory\0${root}`);
    if (!directory) {
      throw new Error(
        `writable root ${pathReference(root)} is missing`,
      );
    }
    assertSecureArtifactNode(directory);
  }
  const artifacts = [];
  for (const node of inventory.nodes) {
    const known = prepared.has(`${node.type}\0${node.path}`);
    if (!known && !isWritablePath(node.path, state.writable_roots)) {
      throw new Error(
        `undeclared output escaped writable roots at ${pathReference(node.path)}`,
      );
    }
    if (!isWritablePath(node.path, state.writable_roots)) continue;
    assertSecureArtifactNode(node);
    if (node.type === "file") {
      artifacts.push({
        mode: node.mode,
        path: node.path,
        sha256: node.sha256,
        size: node.size,
      });
    }
  }
  if (artifacts.length > MAX_ARTIFACT_FILES) {
    throw new Error(`artifacts exceed ${MAX_ARTIFACT_FILES} files`);
  }
  if (artifacts.some(({ size }) => size > MAX_ARTIFACT_FILE_BYTES)) {
    throw new Error(
      `an artifact exceeds ${MAX_ARTIFACT_FILE_BYTES} bytes`,
    );
  }
  if (totalSize(artifacts) > MAX_ARTIFACT_BYTES) {
    throw new Error(`artifacts exceed ${MAX_ARTIFACT_BYTES} bytes`);
  }
  return artifacts.sort(comparePaths);
}

function assertNoConfidentialValues({ bytes, path, values }) {
  if (values.some((value) => path.includes(value))) {
    throw new Error(
      `controller-value-leak in artifact path ${pathReference(path)}`,
    );
  }
  if (
    values.some((value) =>
      bytes.includes(Buffer.from(value, "utf8")),
    )
  ) {
    throw new Error(
      `controller-value-leak in artifact file ${pathReference(path)}`,
    );
  }
}

async function captureArtifactFile({
  artifact,
  destination,
  source,
  values,
}) {
  const label = `artifact file ${pathReference(artifact.path)}`;
  const before = await lstat(source, { bigint: true });
  assertStandaloneFile(before, label);
  const sourceHandle = await open(
    source,
    noFollowReadFlags(),
  );
  try {
    const openedBefore = await sourceHandle.stat({ bigint: true });
    assertStandaloneFile(openedBefore, label);
    if (
      canonicalJson(stableMetadata(before)) !==
      canonicalJson(stableMetadata(openedBefore))
    ) {
      throw new Error(`${label} changed before snapshot capture`);
    }
    if (
      permissionString(openedBefore) !== artifact.mode ||
      Number(openedBefore.size) !== artifact.size
    ) {
      throw new Error(`${label} differs from the accepted inventory`);
    }
    const bytes = await readExactFileHandle(
      sourceHandle,
      artifact.size,
      label,
    );
    if (
      bytes.length !== artifact.size ||
      sha256(bytes) !== artifact.sha256
    ) {
      throw new Error(`${label} changed before snapshot capture`);
    }
    assertNoConfidentialValues({
      bytes,
      path: artifact.path,
      values,
    });
    await writeFile(destination, bytes, {
      flag: "wx",
      mode: 0o400,
    });
    await chmod(destination, 0o400);
    const openedAfter = await sourceHandle.stat({ bigint: true });
    if (
      canonicalJson(stableMetadata(openedBefore)) !==
      canonicalJson(stableMetadata(openedAfter))
    ) {
      throw new Error(`${label} changed during snapshot capture`);
    }
  } finally {
    await sourceHandle.close();
  }
  const captured = await readStableFile(
    destination,
    "snapshot artifact",
    {
      expectedSize: artifact.size,
      maxBytes: MAX_ARTIFACT_FILE_BYTES,
    },
  );
  if (
    captured.bytes.length !== artifact.size ||
    sha256(captured.bytes) !== artifact.sha256 ||
    permissionString(captured.metadata) !== "0400"
  ) {
    throw new Error("captured artifact differs from the accepted bytes");
  }
}

async function captureArtifactSnapshot({
  artifacts,
  state,
  stateRoot,
}) {
  const snapshotRoot = join(stateRoot, "artifacts");
  await mkdir(snapshotRoot, { mode: 0o700 });
  await chmod(snapshotRoot, 0o700);
  const directories = new Set();
  for (const artifact of artifacts) {
    for (const directory of pathDirectories(artifact.path)) {
      directories.add(directory);
    }
    const destination = join(
      snapshotRoot,
      ...artifact.path.split("/"),
    );
    await mkdir(dirname(destination), {
      mode: 0o700,
      recursive: true,
    });
    await captureArtifactFile({
      artifact,
      destination,
      source: join(state.lane_root, ...artifact.path.split("/")),
      values: state.confidential_values,
    });
  }
  for (
    const directory of [...directories].sort(
      (left, right) =>
        right.split("/").length - left.split("/").length,
    )
  ) {
    await chmod(
      join(snapshotRoot, ...directory.split("/")),
      0o500,
    );
  }
  await chmod(snapshotRoot, 0o500);
  const inventory = await inventoryRoot(snapshotRoot, {
    maxBytes: MAX_ARTIFACT_BYTES,
    maxDepth: MAX_TREE_DEPTH,
    maxFileBytes: MAX_ARTIFACT_FILE_BYTES,
    maxFiles: MAX_ARTIFACT_FILES,
    maxNodes: MAX_ARTIFACT_NODES,
  });
  if (inventory.root_mode !== "0500") {
    throw new Error("artifact snapshot root must use mode 0500");
  }
  const capturedArtifacts = inventory.nodes
    .filter(({ type }) => type === "file")
    .map(({ mode, path, sha256: digest, size }) => ({
      mode,
      path,
      sha256: digest,
      size,
    }));
  const expectedArtifacts = artifacts.map(
    ({ path, sha256: digest, size }) => ({
      mode: "0400",
      path,
      sha256: digest,
      size,
    }),
  );
  if (
    canonicalJson(capturedArtifacts) !==
    canonicalJson(expectedArtifacts)
  ) {
    throw new Error("artifact snapshot differs from the accepted inventory");
  }
  await scanForbiddenStrings(
    snapshotRoot,
    inventory,
    state.confidential_values,
  );
  return {
    artifacts: capturedArtifacts,
    inventory,
    root: snapshotRoot,
  };
}

async function verifyControllerBinding(state) {
  if (state.preparation.node_version !== process.version) {
    throw new Error("Node.js version changed after preparation");
  }
  const binding = await verifyWorkingFilesAtCommit({
    commit: state.controller_commit,
    paths: state.controller_program_paths,
    repositoryPath: state.repository_path,
    workingRoot: EXECUTING_REPOSITORY_ROOT,
  });
  if (
    binding.sha256 !== state.preparation.controller_program_sha256
  ) {
    throw new Error("controller program binding changed after preparation");
  }
}

function closureRecord({ inventory, snapshot, state }) {
  return validateClosedCaseRun({
    artifacts: snapshot.artifacts,
    artifact_snapshot_root: "artifacts",
    artifact_tree_sha256: sha256(
      canonicalJson(snapshot.artifacts),
    ),
    case_id: state.case_id,
    claims: {
      adapter_status: "not-run",
      artifact_inventory: "closed",
      context_isolation: "not-attested",
      execution_isolation: "not-attested",
      fixture_opacity: "not-attested",
      input_integrity: "verified",
      method_order: "unverified_by_report",
      network_isolation: "not-attested",
      state_authentication: "not-attested",
    },
    confidentiality: "controller-only",
    controller_commit: state.controller_commit,
    lane: state.lane,
    node_version: process.version,
    qualification: "not-evidence",
    result: null,
    run_id: state.run_id,
    schema_version: 1,
    subject_commit: state.subject_commit,
    suite_id: state.suite_id,
    verification_status: "unverified",
    workspace_tree_sha256: inventory.sha256,
  });
}

export async function closeCaseRun({ statePath }) {
  const state = await readPrivateState(statePath);
  const stateRoot = dirname(statePath);
  const journalPath = join(stateRoot, "journal.jsonl");
  const lock = await open(join(stateRoot, "close.lock"), "wx", 0o600);
  await lock.close();
  const stateDigest = sha256(canonicalJson(state));
  const initialJournal = await readJournal(journalPath, state.run_id);
  if (
    initialJournal.length !== 1 ||
    initialJournal[0].event !== "prepared" ||
    initialJournal[0].payload_sha256 !== stateDigest
  ) {
    throw new Error("run is not in the prepared state");
  }
  await appendJournalEvent({
    event: "close_started",
    journalPath,
    payloadDigest: stateDigest,
    runId: state.run_id,
  });
  let terminalJournalAppended = false;
  try {
    await verifyControllerBinding(state);
    await sealWritableRoots(state);
    const inventoryOptions = {
      maxBytes:
        totalSize(
          state.prepared_inventory.nodes.filter(
            ({ type }) => type === "file",
          ),
        ) + MAX_ARTIFACT_BYTES,
      maxDepth: MAX_TREE_DEPTH,
      maxFileBytes: Math.max(MAX_INPUT_BYTES, MAX_ARTIFACT_FILE_BYTES),
      maxFiles:
        state.prepared_inventory.nodes.filter(
          ({ type }) => type === "file",
        ).length + MAX_ARTIFACT_FILES,
      maxNodes:
        state.prepared_inventory.nodes.length + MAX_ARTIFACT_NODES,
    };
    const inventory = await inventoryRoot(
      state.lane_root,
      inventoryOptions,
    );
    await scanForbiddenStrings(
      state.lane_root,
      inventory,
      state.confidential_values,
    );
    const artifacts = closeInventory(state, inventory);
    const snapshot = await captureArtifactSnapshot({
      artifacts,
      state,
      stateRoot,
    });
    const repeatedInventory = await inventoryRoot(
      state.lane_root,
      inventoryOptions,
    );
    if (
      canonicalJson(inventory) !== canonicalJson(repeatedInventory)
    ) {
      throw new Error("lane tree changed while closure was measured");
    }
    const closure = closureRecord({ inventory, snapshot, state });
    const pendingPath = join(stateRoot, "closed.pending.json");
    const closedPath = join(stateRoot, "closed.json");
    await writeJsonExclusive(pendingPath, closure);
    await appendJournalEvent({
      event: "closed",
      journalPath,
      payloadDigest: sha256(canonicalJson(closure)),
      runId: state.run_id,
    });
    terminalJournalAppended = true;
    await rename(pendingPath, closedPath);
    return {
      artifact_snapshot_path: snapshot.root,
      closed_path: closedPath,
      closure,
      ...nonQualificationSummary(closure),
      run_id: state.run_id,
    };
  } catch (error) {
    if (!terminalJournalAppended) {
      await appendJournalEvent({
        event: "invalid",
        journalPath,
        payloadDigest: sha256(
          canonicalJson({ error_code: "closure-rejected" }),
        ),
        runId: state.run_id,
      });
    }
    throw error;
  }
}
