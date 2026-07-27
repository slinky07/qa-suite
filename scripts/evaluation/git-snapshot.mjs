import { execFile } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import { canonicalJson, sha256 } from "./contracts.mjs";

const execFileAsync = promisify(execFile);
const COMMIT = /^[0-9a-f]{40}$/;
const GIT_MODE = new Set(["100644", "100755"]);
const OBJECT_ID = /^[0-9a-f]{40,64}$/;
const MAX_GIT_OUTPUT_BYTES = 64 * 1024 * 1024;
const MAX_MATERIALIZED_BYTES = 32 * 1024 * 1024;
const MAX_MATERIALIZED_DEPTH = 32;
const MAX_MATERIALIZED_FILES = 2_048;
const MAX_MATERIALIZED_NODES = 16_384;

function assertString(value, label) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim().length === 0
  ) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

export function assertSafeRepositoryPath(value, label = "path") {
  assertString(value, label);
  if (
    Buffer.byteLength(value, "utf8") > 4_096 ||
    isAbsolute(value) ||
    value.includes("\\") ||
    value.includes(":") ||
    /[\0-\x1f\x7f]/u.test(value)
  ) {
    throw new Error(`${label} must be a normalized repository-relative path`);
  }
  const segments = value.split("/");
  if (
    segments.some(
      (segment) =>
        Buffer.byteLength(segment, "utf8") > 255 ||
        segment === "" ||
        segment === "." ||
        segment === ".." ||
        segment === ".git",
    )
  ) {
    throw new Error(`${label} must be a normalized repository-relative path`);
  }
  return value;
}

function gitEnvironment() {
  const environment = {
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_OPTIONAL_LOCKS: "0",
    LANG: "C",
    LC_ALL: "C",
    PATH: process.env.PATH ?? "",
  };
  for (const name of ["ComSpec", "PATHEXT", "SystemRoot", "WINDIR"]) {
    if (process.env[name] !== undefined) {
      environment[name] = process.env[name];
    }
  }
  return environment;
}

async function runGit(repositoryPath, arguments_, { encoding } = {}) {
  assertString(repositoryPath, "repositoryPath");
  const options = {
    cwd: repositoryPath,
    encoding: encoding ?? "buffer",
    env: gitEnvironment(),
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
    windowsHide: true,
  };
  try {
    return await execFileAsync("git", arguments_, options);
  } catch (error) {
    const detail =
      typeof error.stderr === "string"
        ? error.stderr.trim()
        : Buffer.isBuffer(error.stderr)
          ? error.stderr.toString("utf8").trim()
          : "";
    throw new Error(
      `git ${arguments_[0]} failed${detail ? `: ${detail}` : ""}`,
      { cause: error },
    );
  }
}

function assertCommit(value, label = "commit") {
  assertString(value, label);
  if (!COMMIT.test(value)) {
    throw new Error(`${label} must be a full lowercase commit SHA`);
  }
  return value;
}

function assertRef(value) {
  assertString(value, "ref");
  if (value.startsWith("-") || value.includes("\0")) {
    throw new Error("ref has an invalid value");
  }
  return value;
}

export async function resolveCommit({ ref, repositoryPath }) {
  assertRef(ref);
  const { stdout } = await runGit(
    repositoryPath,
    ["rev-parse", "--verify", `${ref}^{commit}`],
    { encoding: "utf8" },
  );
  const commit = stdout.trim();
  return assertCommit(commit, "resolved commit");
}

function parseTreeRecord(record, label) {
  const tab = record.indexOf("\t");
  if (tab === -1) {
    throw new Error(`${label} has malformed Git tree output`);
  }
  const metadata = record.slice(0, tab).split(" ");
  if (metadata.length !== 3) {
    throw new Error(`${label} has malformed Git tree metadata`);
  }
  const [mode, type, objectId] = metadata;
  const path = record.slice(tab + 1);
  assertSafeRepositoryPath(path, `${label}.path`);
  if (type !== "blob" || !GIT_MODE.has(mode)) {
    throw new Error(
      `${label} must be a regular blob with mode 100644 or 100755`,
    );
  }
  if (!OBJECT_ID.test(objectId)) {
    throw new Error(`${label} has an invalid object ID`);
  }
  return { mode, object_id: objectId, path };
}

function parseTreeOutput(output, label, { maxEntries } = {}) {
  const source = output.toString("utf8");
  if (Buffer.from(source, "utf8").compare(output) !== 0) {
    throw new Error(`${label} contains a non-UTF-8 repository path`);
  }
  const records = source.split("\0");
  if (records.at(-1) === "") records.pop();
  if (
    maxEntries !== undefined &&
    records.length > maxEntries
  ) {
    throw new Error(`${label} exceeds ${maxEntries} entries`);
  }
  const entries = records.map((record, index) =>
    parseTreeRecord(record, `${label}[${index}]`),
  );
  const paths = entries.map(({ path }) => path);
  if (new Set(paths).size !== paths.length) {
    throw new Error(`${label} contains duplicate paths`);
  }
  return entries;
}

function comparePaths(left, right) {
  return Buffer.compare(
    Buffer.from(left.path, "utf8"),
    Buffer.from(right.path, "utf8"),
  );
}

async function readObject(repositoryPath, objectId) {
  if (!OBJECT_ID.test(objectId)) {
    throw new Error("objectId has an invalid value");
  }
  const { stdout } = await runGit(
    repositoryPath,
    ["cat-file", "blob", objectId],
  );
  return stdout;
}

async function readObjectSize(repositoryPath, objectId) {
  if (!OBJECT_ID.test(objectId)) {
    throw new Error("objectId has an invalid value");
  }
  const { stdout } = await runGit(
    repositoryPath,
    ["cat-file", "-s", objectId],
    { encoding: "utf8" },
  );
  const source = stdout.trim();
  if (!/^(0|[1-9][0-9]*)$/u.test(source)) {
    throw new Error("Git blob has an invalid object size");
  }
  const size = Number(source);
  if (!Number.isSafeInteger(size)) {
    throw new Error("Git blob size exceeds the supported integer range");
  }
  return size;
}

function pathReference(path) {
  return `path-sha256:${sha256(Buffer.from(path, "utf8"))}`;
}

export async function readBlobMetadataAtCommit({
  commit,
  path,
  repositoryPath,
}) {
  assertCommit(commit);
  assertSafeRepositoryPath(path);
  const { stdout } = await runGit(
    repositoryPath,
    ["ls-tree", "-z", "--full-tree", commit, "--", path],
  );
  const entries = parseTreeOutput(stdout, "Git path", { maxEntries: 1 });
  if (entries.length !== 1 || entries[0].path !== path) {
    throw new Error(
      `Git path ${pathReference(path)} is missing or ambiguous`,
    );
  }
  const entry = entries[0];
  return {
    ...entry,
    size: await readObjectSize(repositoryPath, entry.object_id),
  };
}

export async function readBlobAtCommit({
  commit,
  maxBytes,
  path,
  repositoryPath,
}) {
  const entry = await readBlobMetadataAtCommit({
    commit,
    path,
    repositoryPath,
  });
  if (maxBytes !== undefined && entry.size > maxBytes) {
    throw new Error(`Git blob exceeds ${maxBytes} bytes`);
  }
  const bytes = await readObject(repositoryPath, entry.object_id);
  if (bytes.length !== entry.size) {
    throw new Error("Git blob size changed while it was read");
  }
  return {
    ...entry,
    bytes,
    sha256: sha256(bytes),
  };
}

export async function listTreeAtCommit({
  commit,
  maxEntries,
  prefix,
  repositoryPath,
}) {
  assertCommit(commit);
  assertSafeRepositoryPath(prefix, "prefix");
  const { stdout } = await runGit(
    repositoryPath,
    ["ls-tree", "-r", "-z", "--full-tree", commit, "--", prefix],
  );
  const entries = parseTreeOutput(
    stdout,
    "Git tree",
    { maxEntries },
  ).sort(comparePaths);
  if (entries.length === 0) {
    throw new Error(`Git tree ${prefix} is empty or missing at ${commit}`);
  }
  const expectedPrefix = `${prefix}/`;
  if (entries.some(({ path }) => !path.startsWith(expectedPrefix))) {
    throw new Error(`Git tree ${prefix} contains an out-of-scope path`);
  }
  return entries;
}

function stagedPermissions(mode) {
  return mode === "100755" ? 0o555 : 0o444;
}

export async function materializeEntries({
  commit,
  destination,
  entries,
  repositoryPath,
}) {
  assertCommit(commit);
  if (!isAbsolute(destination)) {
    throw new Error("destination must be an absolute path");
  }
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error("entries must be a non-empty array");
  }
  if (entries.length > MAX_MATERIALIZED_FILES) {
    throw new Error(
      `entries exceed ${MAX_MATERIALIZED_FILES} files`,
    );
  }
  const destinationRealPath = await realpath(destination);
  const materialized = [];
  const seen = new Set();
  const validated = entries.map((entry, index) => {
    const label = `entries[${index}]`;
    if (
      entry === null ||
      typeof entry !== "object" ||
      Array.isArray(entry)
    ) {
      throw new Error(`${label} must be an object`);
    }
    assertSafeRepositoryPath(entry.path, `${label}.path`);
    if (!GIT_MODE.has(entry.mode) || !OBJECT_ID.test(entry.object_id)) {
      throw new Error(`${label} has invalid Git metadata`);
    }
    if (seen.has(entry.path)) {
      throw new Error("entries must contain unique paths");
    }
    seen.add(entry.path);
    if (entry.path.split("/").length > MAX_MATERIALIZED_DEPTH) {
      throw new Error(
        `entries exceed depth ${MAX_MATERIALIZED_DEPTH}`,
      );
    }
    return { entry, label };
  });
  const directoryPaths = new Set();
  for (const { entry } of validated) {
    const segments = entry.path.split("/");
    let parent = "";
    for (let index = 0; index < segments.length - 1; index += 1) {
      parent = parent ? `${parent}/${segments[index]}` : segments[index];
      directoryPaths.add(parent);
      if (
        validated.length + directoryPaths.size >
        MAX_MATERIALIZED_NODES
      ) {
        throw new Error(
          `entries exceed ${MAX_MATERIALIZED_NODES} materialized nodes`,
        );
      }
    }
  }
  validated.sort((left, right) =>
    comparePaths(left.entry, right.entry),
  );
  let materializedBytes = 0;
  for (const row of validated) {
    const metadata = await readBlobMetadataAtCommit({
      commit,
      path: row.entry.path,
      repositoryPath,
    });
    if (
      metadata.mode !== row.entry.mode ||
      metadata.object_id !== row.entry.object_id
    ) {
      throw new Error(`${row.label} differs from the frozen Git tree`);
    }
    materializedBytes += metadata.size;
    if (
      !Number.isSafeInteger(materializedBytes) ||
      materializedBytes > MAX_MATERIALIZED_BYTES
    ) {
      throw new Error(
        `entries exceed ${MAX_MATERIALIZED_BYTES} bytes`,
      );
    }
    row.metadata = metadata;
  }
  for (const { entry, label, metadata } of validated) {
    const frozen = await readBlobAtCommit({
      commit,
      maxBytes: metadata.size,
      path: entry.path,
      repositoryPath,
    });
    if (
      frozen.mode !== entry.mode ||
      frozen.object_id !== entry.object_id ||
      frozen.size !== metadata.size
    ) {
      throw new Error(`${label} differs from the frozen Git tree`);
    }
    const bytes = frozen.bytes;
    const target = join(destinationRealPath, ...entry.path.split("/"));
    await mkdir(dirname(target), { mode: 0o700, recursive: true });
    await writeFile(target, bytes, {
      flag: "wx",
      mode: stagedPermissions(entry.mode),
    });
    await chmod(target, stagedPermissions(entry.mode));
    materialized.push({
      git_mode: entry.mode,
      path: entry.path,
      sha256: sha256(bytes),
      size: bytes.length,
      staged_mode: entry.mode === "100755" ? "0555" : "0444",
    });
  }
  return materialized;
}

export async function verifyWorkingFilesAtCommit({
  commit,
  paths,
  repositoryPath,
  workingRoot = repositoryPath,
}) {
  assertCommit(commit);
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new Error("paths must be a non-empty array");
  }
  const repositoryRealPath = await realpath(repositoryPath);
  const workingRootRealPath = await realpath(workingRoot);
  const rows = [];
  const seen = new Set();
  for (const [index, path] of paths.entries()) {
    assertSafeRepositoryPath(path, `paths[${index}]`);
    if (seen.has(path)) {
      throw new Error("paths must contain unique values");
    }
    seen.add(path);
    const expected = await readBlobAtCommit({
      commit,
      path,
      repositoryPath: repositoryRealPath,
    });
    const workingPath = join(workingRootRealPath, ...path.split("/"));
    const metadata = await lstat(workingPath);
    if (!metadata.isFile() || metadata.nlink !== 1) {
      throw new Error(`working file ${path} must be a standalone regular file`);
    }
    if ((metadata.mode & 0o022) !== 0) {
      throw new Error(`working file ${path} cannot be group/world writable`);
    }
    const executable = (metadata.mode & 0o111) !== 0;
    if (executable !== (expected.mode === "100755")) {
      throw new Error(`working file ${path} mode differs from controller commit`);
    }
    const bytes = await readFile(workingPath);
    const digest = sha256(bytes);
    if (digest !== expected.sha256) {
      throw new Error(`working file ${path} differs from controller commit`);
    }
    rows.push({
      path,
      sha256: digest,
    });
  }
  rows.sort(comparePaths);
  return {
    files: rows,
    sha256: sha256(canonicalJson(rows)),
  };
}
