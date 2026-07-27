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

function gitFiles(commit) {
  return new Set(
    runCommand("git", ["ls-tree", "-r", "--name-only", commit])
      .trim()
      .split("\n")
      .filter(Boolean),
  );
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

  const channels = assertDistributionChannels(commit);

  if (expectedTag !== undefined) {
    assertReleaseTag(expectedTag);
    if (expectedTag !== `v${version}`) {
      throw new Error(
        `Release tag ${expectedTag} does not match VERSION ${version}`,
      );
    }
  }

  return { commit, version, channels };
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
