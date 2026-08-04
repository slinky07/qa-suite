import { createHash } from "node:crypto";
import { lstat, readFile, readdir, readlink } from "node:fs/promises";
import { relative, resolve, sep, posix } from "node:path";
import { pathToFileURL } from "node:url";

const ARCHIVE_ROOT = "qa-suite/";
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;
const UTF8_FLAG = 0x0800;
const STORED_COMPRESSION = 0;
const ZIP_DIRECTORY_ATTRIBUTE = 0x10;
const UNIX_FILE_TYPE_MASK = 0o170000;
const UNIX_DIRECTORY = 0o040000;
const UNIX_REGULAR_FILE = 0o100000;
const UNIX_SYMBOLIC_LINK = 0o120000;
const textDecoder = new TextDecoder("utf-8", { fatal: true });

const CRC32_TABLE = new Uint32Array(256);
for (let index = 0; index < CRC32_TABLE.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  CRC32_TABLE[index] = value >>> 0;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value = CRC32_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function requireBytes(bytes, offset, length, label) {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset + length > bytes.length
  ) {
    throw new Error(`Truncated ZIP ${label}`);
  }
}

function readUInt16(bytes, offset, label) {
  requireBytes(bytes, offset, 2, label);
  return bytes.readUInt16LE(offset);
}

function readUInt32(bytes, offset, label) {
  requireBytes(bytes, offset, 4, label);
  return bytes.readUInt32LE(offset);
}

function decodeUtf8(bytes, label) {
  try {
    return textDecoder.decode(bytes);
  } catch {
    throw new Error(`${label} is not valid UTF-8`);
  }
}

function validateExtraFields(bytes, label) {
  let offset = 0;
  while (offset < bytes.length) {
    requireBytes(bytes, offset, 4, `${label} extra-field header`);
    const fieldLength = bytes.readUInt16LE(offset + 2);
    requireBytes(bytes, offset + 4, fieldLength, `${label} extra-field data`);
    offset += 4 + fieldLength;
  }
}

function findEndOfCentralDirectory(bytes) {
  if (bytes.length < 22) {
    throw new Error("Archive is too short to be a ZIP file");
  }

  const earliestOffset = Math.max(0, bytes.length - 22 - 0xffff);
  for (let offset = bytes.length - 22; offset >= earliestOffset; offset -= 1) {
    if (bytes.readUInt32LE(offset) !== END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      continue;
    }
    const commentLength = readUInt16(
      bytes,
      offset + 20,
      "end-of-central-directory comment length",
    );
    if (offset + 22 + commentLength === bytes.length) {
      return offset;
    }
  }

  throw new Error("ZIP end-of-central-directory record is missing");
}

function assertSupportedFlags(flags, path) {
  if ((flags & ~UTF8_FLAG) !== 0) {
    throw new Error(`Unsupported ZIP flags for ${path}: 0x${flags.toString(16)}`);
  }
}

function archivePath(name) {
  if (name.includes("\0") || name.includes("\\")) {
    throw new Error(`Unsafe ZIP entry path: ${JSON.stringify(name)}`);
  }
  if (name === ARCHIVE_ROOT) {
    return { path: "", directoryMarker: true };
  }
  if (!name.startsWith(ARCHIVE_ROOT)) {
    throw new Error(`ZIP entry is outside the canonical ${ARCHIVE_ROOT} root: ${name}`);
  }

  const directoryMarker = name.endsWith("/");
  const path = name.slice(
    ARCHIVE_ROOT.length,
    directoryMarker ? -1 : undefined,
  );
  const parts = path.split("/");
  if (
    path === "" ||
    parts.some((part) => part === "" || part === "." || part === "..") ||
    posix.normalize(path) !== path
  ) {
    throw new Error(`Unsafe or non-canonical ZIP entry path: ${name}`);
  }
  return { path, directoryMarker };
}

function entryType(entry, directoryMarker) {
  const origin = entry.versionMadeBy >>> 8;
  const unixMode = origin === 3 ? entry.externalAttributes >>> 16 : 0;
  const unixType = unixMode & UNIX_FILE_TYPE_MASK;
  const dosDirectory = (entry.externalAttributes & ZIP_DIRECTORY_ATTRIBUTE) !== 0;

  if (directoryMarker) {
    if (entry.uncompressedSize !== 0) {
      throw new Error(`ZIP directory entry is not empty: ${entry.name}`);
    }
    if (unixType !== 0 && unixType !== UNIX_DIRECTORY) {
      throw new Error(`ZIP directory marker has a conflicting type: ${entry.name}`);
    }
    if (origin !== 3 && !dosDirectory) {
      throw new Error(`ZIP directory entry has no directory attribute: ${entry.name}`);
    }
    return "directory";
  }

  if (dosDirectory || unixType === UNIX_DIRECTORY) {
    throw new Error(`ZIP directory entry is missing its trailing slash: ${entry.name}`);
  }
  if (unixType === UNIX_SYMBOLIC_LINK) {
    return "symlink";
  }
  if (unixType !== 0 && unixType !== UNIX_REGULAR_FILE) {
    throw new Error(`Unsupported ZIP entry type: ${entry.name}`);
  }
  return "file";
}

function assertSafeSymlink(path, target) {
  if (
    target === "" ||
    target.includes("\0") ||
    target.includes("\\") ||
    posix.isAbsolute(target) ||
    /^[A-Za-z]:/.test(target)
  ) {
    throw new Error(`Unsafe symlink target for ${path}: ${JSON.stringify(target)}`);
  }

  const resolvedTarget = posix.normalize(posix.join(posix.dirname(path), target));
  if (resolvedTarget === ".." || resolvedTarget.startsWith("../")) {
    throw new Error(`Symlink target escapes ${ARCHIVE_ROOT}: ${path}`);
  }
}

function parseCentralDirectory(bytes) {
  const endOffset = findEndOfCentralDirectory(bytes);
  const diskNumber = readUInt16(bytes, endOffset + 4, "disk number");
  const centralDisk = readUInt16(bytes, endOffset + 6, "central-directory disk");
  const entriesOnDisk = readUInt16(bytes, endOffset + 8, "entries on disk");
  const entryCount = readUInt16(bytes, endOffset + 10, "entry count");
  const centralSize = readUInt32(bytes, endOffset + 12, "central-directory size");
  const centralOffset = readUInt32(bytes, endOffset + 16, "central-directory offset");

  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) {
    throw new Error("Multi-disk ZIP archives are not supported");
  }
  if (
    entryCount === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff
  ) {
    throw new Error("ZIP64 archives are not supported");
  }
  if (centralOffset + centralSize !== endOffset) {
    throw new Error("ZIP central-directory bounds are inconsistent");
  }

  const entries = [];
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    requireBytes(bytes, offset, 46, "central-directory entry");
    if (bytes.readUInt32LE(offset) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error(`Invalid ZIP central-directory entry ${index + 1}`);
    }

    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const entryLength = 46 + nameLength + extraLength + commentLength;
    requireBytes(bytes, offset, entryLength, "central-directory entry data");
    if (offset + entryLength > endOffset) {
      throw new Error("ZIP central-directory entry crosses its declared boundary");
    }

    const nameBytes = bytes.subarray(offset + 46, offset + 46 + nameLength);
    const name = decodeUtf8(nameBytes, "ZIP entry name");
    const extraStart = offset + 46 + nameLength;
    validateExtraFields(
      bytes.subarray(extraStart, extraStart + extraLength),
      `ZIP entry ${name}`,
    );
    const entry = {
      name,
      nameBytes,
      versionMadeBy: bytes.readUInt16LE(offset + 4),
      flags: bytes.readUInt16LE(offset + 8),
      compression: bytes.readUInt16LE(offset + 10),
      checksum: bytes.readUInt32LE(offset + 16),
      compressedSize: bytes.readUInt32LE(offset + 20),
      uncompressedSize: bytes.readUInt32LE(offset + 24),
      diskStart: bytes.readUInt16LE(offset + 34),
      externalAttributes: bytes.readUInt32LE(offset + 38),
      localOffset: bytes.readUInt32LE(offset + 42),
    };
    assertSupportedFlags(entry.flags, name);
    if (entry.diskStart !== 0) {
      throw new Error(`ZIP entry starts on another disk: ${name}`);
    }
    if (entry.compression !== STORED_COMPRESSION) {
      throw new Error(`ZIP entry is not stored without compression: ${name}`);
    }
    if (entry.compressedSize !== entry.uncompressedSize) {
      throw new Error(`Stored ZIP entry has inconsistent sizes: ${name}`);
    }
    entries.push(entry);
    offset += entryLength;
  }

  if (offset !== endOffset) {
    throw new Error("ZIP central-directory entry count is inconsistent");
  }
  return { entries, centralOffset };
}

function readEntryData(bytes, entry, centralOffset) {
  const offset = entry.localOffset;
  requireBytes(bytes, offset, 30, `local header for ${entry.name}`);
  if (bytes.readUInt32LE(offset) !== LOCAL_FILE_SIGNATURE) {
    throw new Error(`Invalid ZIP local header for ${entry.name}`);
  }

  const flags = bytes.readUInt16LE(offset + 6);
  const compression = bytes.readUInt16LE(offset + 8);
  const checksum = bytes.readUInt32LE(offset + 14);
  const compressedSize = bytes.readUInt32LE(offset + 18);
  const uncompressedSize = bytes.readUInt32LE(offset + 22);
  const nameLength = bytes.readUInt16LE(offset + 26);
  const extraLength = bytes.readUInt16LE(offset + 28);
  const headerLength = 30 + nameLength + extraLength;
  requireBytes(bytes, offset, headerLength, `local header data for ${entry.name}`);

  const localName = bytes.subarray(offset + 30, offset + 30 + nameLength);
  if (!localName.equals(entry.nameBytes)) {
    throw new Error(`ZIP local and central names differ for ${entry.name}`);
  }
  validateExtraFields(
    bytes.subarray(offset + 30 + nameLength, offset + headerLength),
    `ZIP local entry ${entry.name}`,
  );
  if (
    flags !== entry.flags ||
    compression !== entry.compression ||
    checksum !== entry.checksum ||
    compressedSize !== entry.compressedSize ||
    uncompressedSize !== entry.uncompressedSize
  ) {
    throw new Error(`ZIP local and central metadata differ for ${entry.name}`);
  }

  const dataStart = offset + headerLength;
  requireBytes(bytes, dataStart, entry.compressedSize, `entry data for ${entry.name}`);
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > centralOffset) {
    throw new Error(`ZIP entry overlaps the central directory: ${entry.name}`);
  }
  const data = bytes.subarray(dataStart, dataEnd);
  if (crc32(data) !== entry.checksum) {
    throw new Error(`ZIP entry checksum does not match: ${entry.name}`);
  }
  return { data, start: offset, end: dataEnd };
}

function assertCanonicalParents(entries) {
  for (const [path] of entries) {
    const parts = path.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      const parent = parts.slice(0, index).join("/");
      if (entries.get(parent)?.type !== "directory") {
        throw new Error(`ZIP entry has no canonical directory parent: ${path}`);
      }
    }
  }
}

function archiveEntries(bytes) {
  const { entries: centralEntries, centralOffset } = parseCentralDirectory(bytes);
  const entries = new Map();
  const ranges = [];
  let foundRoot = false;

  for (const centralEntry of centralEntries) {
    const { path, directoryMarker } = archivePath(centralEntry.name);
    const type = entryType(centralEntry, directoryMarker);
    const { data, start, end } = readEntryData(
      bytes,
      centralEntry,
      centralOffset,
    );
    ranges.push({ start, end, name: centralEntry.name });

    if (path === "") {
      if (foundRoot || type !== "directory") {
        throw new Error(`ZIP archive has an invalid ${ARCHIVE_ROOT} root`);
      }
      foundRoot = true;
      continue;
    }
    if (entries.has(path)) {
      throw new Error(`Duplicate ZIP entry path: ${path}`);
    }

    if (type === "directory") {
      entries.set(path, { type });
    } else if (type === "file") {
      entries.set(path, { type, sha256: sha256(data) });
    } else {
      const target = decodeUtf8(data, `Symlink target for ${path}`);
      assertSafeSymlink(path, target);
      entries.set(path, { type, target });
    }
  }

  if (!foundRoot) {
    throw new Error(`ZIP archive is missing the canonical ${ARCHIVE_ROOT} root`);
  }
  ranges.sort((left, right) => left.start - right.start);
  let expectedOffset = 0;
  for (const range of ranges) {
    if (range.start !== expectedOffset) {
      throw new Error(`ZIP local entries contain a gap or overlap before ${range.name}`);
    }
    expectedOffset = range.end;
  }
  if (expectedOffset !== centralOffset) {
    throw new Error("ZIP local entries do not end at the central directory");
  }

  assertCanonicalParents(entries);
  return entries;
}

async function installedEntries(root) {
  const rootMetadata = await lstat(root);
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw new Error("--installed-root must name a real directory, not a symlink");
  }

  const entries = new Map();
  async function visit(current) {
    const names = await readdir(current);
    names.sort();
    for (const name of names) {
      const absolutePath = resolve(current, name);
      const path = relative(root, absolutePath).split(sep).join("/");
      const metadata = await lstat(absolutePath);

      if (metadata.isDirectory()) {
        entries.set(path, { type: "directory" });
        await visit(absolutePath);
      } else if (metadata.isFile()) {
        entries.set(path, {
          type: "file",
          sha256: sha256(await readFile(absolutePath)),
        });
      } else if (metadata.isSymbolicLink()) {
        entries.set(path, { type: "symlink", target: await readlink(absolutePath) });
      } else {
        throw new Error(`Unsupported installed entry type: ${path}`);
      }
    }
  }

  await visit(root);
  return entries;
}

function compareEntries(expected, observed) {
  const differences = [];
  const paths = [...new Set([...expected.keys(), ...observed.keys()])].sort();

  for (const path of paths) {
    const expectedEntry = expected.get(path);
    const observedEntry = observed.get(path);
    if (expectedEntry === undefined) {
      differences.push({
        path,
        difference: "extra",
        observed_type: observedEntry.type,
      });
      continue;
    }
    if (observedEntry === undefined) {
      differences.push({
        path,
        difference: "missing",
        expected_type: expectedEntry.type,
      });
      continue;
    }
    if (expectedEntry.type !== observedEntry.type) {
      differences.push({
        path,
        difference: "type",
        expected_type: expectedEntry.type,
        observed_type: observedEntry.type,
      });
      continue;
    }
    if (
      expectedEntry.type === "file" &&
      expectedEntry.sha256 !== observedEntry.sha256
    ) {
      differences.push({
        path,
        difference: "content",
        expected_sha256: expectedEntry.sha256,
        observed_sha256: observedEntry.sha256,
      });
    }
    if (
      expectedEntry.type === "symlink" &&
      expectedEntry.target !== observedEntry.target
    ) {
      differences.push({
        path,
        difference: "symlink-target",
        expected_target: expectedEntry.target,
        observed_target: observedEntry.target,
      });
    }
  }
  return differences;
}

export async function verifyInstalledPayload({ archive, installedRoot }) {
  const archivePath = resolve(archive);
  const installedPath = resolve(installedRoot);
  const bytes = await readFile(archivePath);
  const archiveSha256 = sha256(bytes);

  try {
    const expected = archiveEntries(bytes);
    const observed = await installedEntries(installedPath);
    const differences = compareEntries(expected, observed);

    return {
      schema_version: 1,
      result: differences.length === 0 ? "match" : "mismatch",
      archive: archivePath,
      archive_sha256: archiveSha256,
      installed_root: installedPath,
      expected_entries: expected.size,
      observed_entries: observed.size,
      differences,
    };
  } catch (error) {
    error.archiveSha256 = archiveSha256;
    throw error;
  }
}

function usage() {
  return "Usage: node verify-installed-payload.mjs --archive <qa-suite-source.zip> --installed-root <active-qa-suite-directory>";
}

function parseArguments(args) {
  if (args.length === 1 && args[0] === "--help") {
    return { help: true };
  }

  const values = new Map();
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (option !== "--archive" && option !== "--installed-root") {
      throw new Error(`Unknown argument: ${option}`);
    }
    if (values.has(option)) {
      throw new Error(`Duplicate argument: ${option}`);
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for ${option}`);
    }
    values.set(option, value);
    index += 1;
  }

  if (!values.has("--archive") || !values.has("--installed-root")) {
    throw new Error("Both --archive and --installed-root are required");
  }
  return {
    archive: values.get("--archive"),
    installedRoot: values.get("--installed-root"),
  };
}

async function run(args) {
  try {
    const options = parseArguments(args);
    if (options.help) {
      process.stdout.write(`${usage()}\n`);
      return;
    }
    const report = await verifyInstalledPayload(options);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (report.result !== "match") {
      process.exitCode = 1;
    }
  } catch (error) {
    const report = {
      schema_version: 1,
      result: "error",
      ...(error.archiveSha256 === undefined
        ? {}
        : { archive_sha256: error.archiveSha256 }),
      error: error.message,
      usage: usage(),
    };
    process.stderr.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = 2;
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) {
  await run(process.argv.slice(2));
}
