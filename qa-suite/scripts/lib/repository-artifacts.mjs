import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  lstat,
  link,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  unlink,
} from "node:fs/promises";
import { hostname } from "node:os";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";

export function runGit(repositoryRoot, args, acceptedStatuses = [0]) {
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

export async function resolveRepository(repository = ".") {
  const repositoryRoot = await realpath(resolve(repository));
  const topLevel = runGit(repositoryRoot, ["rev-parse", "--show-toplevel"])
    .stdout.trim();
  const canonicalTopLevel = await realpath(topLevel);
  if (canonicalTopLevel !== repositoryRoot) {
    throw new Error(`repository must resolve to Git top level ${canonicalTopLevel}`);
  }
  return repositoryRoot;
}

export function repositoryPath(repositoryRoot, gitPath, label) {
  if (typeof gitPath !== "string" || gitPath.trim().length === 0) {
    throw new Error(`${label} path must be a non-empty string`);
  }
  if (isAbsolute(gitPath) || gitPath.includes("\\")) {
    throw new Error(`${label} path must be a portable repository-relative path`);
  }
  const absolutePath = resolve(repositoryRoot, gitPath);
  const relativePath = relative(repositoryRoot, absolutePath);
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`${label} path must resolve inside the repository`);
  }
  const normalized = relativePath.split(sep).join("/");
  if (normalized !== gitPath) {
    throw new Error(`${label} path must be normalized as ${normalized}`);
  }
  return { absolutePath, gitPath: normalized };
}

async function assertNoSymlinkComponents(repositoryRoot, absolutePath, label) {
  const relativePath = relative(repositoryRoot, absolutePath);
  const components = relativePath.split(sep);
  let current = repositoryRoot;
  for (const component of components) {
    current = resolve(current, component);
    try {
      const metadata = await lstat(current);
      if (metadata.isSymbolicLink()) {
        throw new Error(`${label} path must not contain symlinks: ${current}`);
      }
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
  }
}

export async function assertRegularRepositoryFile(
  repositoryRoot,
  gitPath,
  label,
) {
  const location = repositoryPath(repositoryRoot, gitPath, label);
  await assertNoSymlinkComponents(repositoryRoot, location.absolutePath, label);
  const metadata = await lstat(location.absolutePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file, not a symlink`);
  }
  const canonical = await realpath(location.absolutePath);
  const relativePath = relative(repositoryRoot, canonical);
  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`${label} must resolve inside the repository`);
  }
  return location;
}

export async function assertCreationPath(repositoryRoot, gitPath, label) {
  const location = repositoryPath(repositoryRoot, gitPath, label);
  await assertNoSymlinkComponents(repositoryRoot, location.absolutePath, label);
  return location;
}

export async function readRepositoryFile(repositoryRoot, gitPath, label) {
  const location = await assertRegularRepositoryFile(repositoryRoot, gitPath, label);
  return { ...location, source: await readFile(location.absolutePath, "utf8") };
}

export function isIgnored(repositoryRoot, gitPath) {
  return (
    runGit(repositoryRoot, ["check-ignore", "--no-index", "--", gitPath], [0, 1])
      .status === 0
  );
}

export function isTracked(repositoryRoot, gitPath) {
  return (
    runGit(repositoryRoot, ["ls-files", "--error-unmatch", "--", gitPath], [0, 1])
      .status === 0
  );
}

export function isTrackedInHead(repositoryRoot, gitPath) {
  return (
    runGit(repositoryRoot, ["cat-file", "-e", `HEAD:${gitPath}`], [0, 1, 128])
      .status === 0
  );
}

export function assertIgnoredUntracked(repositoryRoot, gitPath, label) {
  if (!isIgnored(repositoryRoot, gitPath)) {
    throw new Error(`${label} must be ignored: ${gitPath}`);
  }
  if (isTracked(repositoryRoot, gitPath) || isTrackedInHead(repositoryRoot, gitPath)) {
    throw new Error(`${label} must not be tracked: ${gitPath}`);
  }
  const history = runGit(
    repositoryRoot,
    ["log", "--all", "--format=%H", "--", gitPath],
    [0, 128],
  ).stdout.trim();
  if (history) throw new Error(`${label} must not appear in reachable Git history`);
}

export function assertTrackable(repositoryRoot, gitPath, label) {
  if (isIgnored(repositoryRoot, gitPath)) {
    throw new Error(`${label} must not be ignored: ${gitPath}`);
  }
}

async function syncDirectory(path) {
  let directory;
  try {
    directory = await open(path, "r");
    await directory.sync();
  } finally {
    await directory?.close();
  }
}

export async function writeExclusive(path, source, mode = 0o644) {
  await mkdir(dirname(path), { recursive: true });
  let file;
  try {
    file = await open(path, "wx", mode);
    await file.writeFile(source);
    await file.sync();
  } finally {
    await file?.close();
  }
  await syncDirectory(dirname(path));
}

export async function writeExclusiveIdempotent(path, source, conflictLabel) {
  await mkdir(dirname(path), { recursive: true });
  const stagePath = resolve(dirname(path), `.${basename(path)}.exclusive-stage`);
  let targetExists = false;
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(`${conflictLabel} must be a regular file, not a symlink`);
    }
    const existing = await readFile(path, "utf8");
    if (existing !== source) {
      throw new Error(`${conflictLabel} already exists with different bytes`);
    }
    targetExists = true;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (targetExists) {
    const staged = await readFile(stagePath, "utf8").catch((error) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (staged !== undefined && staged !== source) {
      throw new Error(`${conflictLabel} has an unexpected exclusive-create stage`);
    }
    await unlinkDurable(stagePath);
    return "existing";
  }
  try {
    await writeExclusive(stagePath, source);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const metadata = await lstat(stagePath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(`${conflictLabel} exclusive-create stage is unsafe`);
    }
    if ((await readFile(stagePath, "utf8")) !== source) {
      throw new Error(`${conflictLabel} exclusive-create stage has unexpected bytes`);
    }
  }
  let result = "created";
  try {
    await link(stagePath, path);
    await syncDirectory(dirname(path));
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(`${conflictLabel} must be a regular file, not a symlink`);
    }
    if ((await readFile(path, "utf8")) !== source) {
      throw new Error(`${conflictLabel} already exists with different bytes`);
    }
    result = "existing";
  }
  await unlinkDurable(stagePath);
  return result;
}

export async function writeAtomic(path, source, temporaryPath) {
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(`atomic destination must be a regular file: ${path}`);
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  let temporary;
  try {
    temporary = await open(temporaryPath, "wx", 0o600);
    await temporary.writeFile(source);
    await temporary.sync();
    await temporary.close();
    temporary = undefined;
    await rename(temporaryPath, path);
    await syncDirectory(dirname(path));
  } finally {
    await temporary?.close();
    await unlink(temporaryPath).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

export async function renameDurable(sourcePath, destinationPath) {
  await rename(sourcePath, destinationPath);
  await syncDirectory(dirname(destinationPath));
  if (dirname(sourcePath) !== dirname(destinationPath)) {
    await syncDirectory(dirname(sourcePath));
  }
}

export async function unlinkDurable(path) {
  try {
    await unlink(path);
    await syncDirectory(dirname(path));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    if (error.code === "EPERM") return true;
    throw error;
  }
}

async function recoverDeadOwnerLock(path) {
  const recoveryPath = `${path}.stale-recovery`;
  try {
    await link(path, recoveryPath);
    await syncDirectory(dirname(path));
  } catch (error) {
    if (error.code === "ENOENT") {
      try {
        await lstat(recoveryPath);
      } catch (claimError) {
        if (claimError.code === "ENOENT") return;
        throw claimError;
      }
    } else if (error.code !== "EEXIST") {
      throw error;
    }
  }
  const before = await lstat(recoveryPath);
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new Error(`reconciliation lock recovery claim is unsafe: ${recoveryPath}`);
  }
  let owner;
  try {
    owner = JSON.parse(await readFile(recoveryPath, "utf8"));
  } catch {
    throw new Error(`reconciliation lock has malformed owner metadata: ${path}`);
  }
  if (
    owner.lock_version !== 1 ||
    owner.hostname !== hostname() ||
    !Number.isSafeInteger(owner.pid) ||
    owner.pid <= 0
  ) {
    throw new Error(
      `reconciliation lock owner cannot be safely recovered: ${path}; ` +
      `manual recovery must verify and remove ${recoveryPath}`,
    );
  }
  if (isProcessAlive(owner.pid)) {
    await unlinkDurable(recoveryPath);
    throw new Error(`reconciliation lock is already held: ${path}`);
  }
  try {
    const current = await lstat(path);
    if (before.dev === current.dev && before.ino === current.ino) {
      await unlinkDurable(path);
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await unlinkDurable(recoveryPath);
}

async function openExclusiveLock(path, ownerSource) {
  const ownerStage = resolve(
    dirname(path),
    `.${basename(path)}.owner-${process.pid}-${randomUUID()}`,
  );
  await writeExclusive(ownerStage, ownerSource, 0o600);
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (await pathExists(`${path}.stale-recovery`)) {
        await recoverDeadOwnerLock(path);
      }
      try {
        await link(ownerStage, path);
        await syncDirectory(dirname(path));
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        await recoverDeadOwnerLock(path);
        continue;
      }
      const acquired = await lstat(path);
      const staged = await lstat(ownerStage);
      if (await pathExists(`${path}.stale-recovery`)) {
        if (acquired.dev === staged.dev && acquired.ino === staged.ino) {
          await unlinkDurable(path);
        }
        await recoverDeadOwnerLock(path);
        continue;
      }
      return { dev: acquired.dev, ino: acquired.ino };
    }
    throw new Error(`reconciliation lock could not be acquired: ${path}`);
  } finally {
    await unlinkDurable(ownerStage);
  }
}

async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function releaseExclusiveLock(path, identity) {
  const current = await lstat(path);
  if (current.dev !== identity.dev || current.ino !== identity.ino) {
    throw new Error(`reconciliation lock ownership changed before release: ${path}`);
  }
  await unlinkDurable(path);
}

export async function withExclusiveLocks(paths, metadata, operation) {
  const ordered = [...new Set(paths)].sort();
  const locks = [];
  const owner = {
    lock_version: 1,
    hostname: hostname(),
    ...metadata,
    pid: process.pid,
  };
  const ownerSource = `${JSON.stringify(owner)}\n`;
  try {
    for (const path of ordered) {
      await mkdir(dirname(path), { recursive: true });
      const identity = await openExclusiveLock(path, ownerSource);
      locks.push({ identity, path });
    }
    return await operation();
  } finally {
    for (const { identity, path } of locks.reverse()) {
      await releaseExclusiveLock(path, identity);
    }
  }
}

export function headCommit(repositoryRoot) {
  return runGit(repositoryRoot, ["rev-parse", "HEAD"]).stdout.trim();
}

export function differsFromHead(repositoryRoot, gitPath) {
  if (!isTrackedInHead(repositoryRoot, gitPath)) return true;
  return runGit(repositoryRoot, ["diff", "--quiet", "HEAD", "--", gitPath], [0, 1])
    .status !== 0;
}

export function readFileAtCommit(repositoryRoot, commit, gitPath) {
  const result = runGit(
    repositoryRoot,
    ["show", `${commit}:${gitPath}`],
    [0, 128],
  );
  return result.status === 0 ? result.stdout : undefined;
}

export function candidateCommitsForPaths(repositoryRoot, gitPaths) {
  const result = runGit(repositoryRoot, [
    "log",
    "--all",
    "--format=%H",
    "--",
    ...gitPaths,
  ]).stdout;
  return [...new Set(result.split("\n").filter(Boolean))];
}
