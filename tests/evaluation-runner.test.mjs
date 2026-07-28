import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  lstat,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  CASE_DISCLOSURE_PATH,
  canonicalJson,
  validateCaseDisclosure,
} from "../scripts/evaluation/contracts.mjs";
import { bindClosedBobReport } from "../scripts/evaluation/bob-report-adapter.mjs";
import { materializeEntries } from "../scripts/evaluation/git-snapshot.mjs";
import {
  parseArguments,
  redactControllerSecrets,
} from "../scripts/evaluation/run-case.mjs";
import {
  closeCaseRun,
  prepareCaseRun,
} from "../scripts/evaluation/runner.mjs";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const caseIds = {
  selected: "fx_0123456789abcdef0123456789abcdef",
  other: "fx_fedcba9876543210fedcba9876543210",
};
const controllerProgramPaths = [
  "qa-suite/scripts/finding-ledger.mjs",
  "scripts/evaluation/bob-host-executor.mjs",
  "scripts/evaluation/bob-host-protocol.mjs",
  "scripts/evaluation/bob-report-adapter.mjs",
  "scripts/evaluation/contracts.mjs",
  "scripts/evaluation/git-snapshot.mjs",
  "scripts/evaluation/run-case.mjs",
  "scripts/evaluation/runner.mjs",
];
const suitePath = "tests/evaluation/suites/bob-evaluation-v1.json";
const runnerCli = join(
  repositoryRoot,
  "scripts",
  "evaluation",
  "run-case.mjs",
);

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function seal(character) {
  return `seal_${character.repeat(64)}`;
}

const commitments = {
  otherA: seal("3"),
  otherB: seal("4"),
  selectedA: seal("1"),
  selectedB: seal("2"),
};

function runGit(repository, arguments_) {
  return execFileSync("git", [
    "-c",
    "gc.auto=0",
    "-c",
    "maintenance.auto=false",
    "-C",
    repository,
    ...arguments_,
  ], {
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      LC_ALL: "C",
    },
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

async function write(path, value, mode = 0o644) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value, { mode });
  await chmod(path, mode);
}

async function copyControllerProgram(repository) {
  for (const path of controllerProgramPaths) {
    const target = join(repository, ...path.split("/"));
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(repositoryRoot, ...path.split("/")), target);
  }
}

function fixtureRoot(caseId) {
  return `tests/evaluation/fixtures/${caseId}`;
}

async function writeFixture(
  repository,
  caseId,
  {
    badHash = false,
    publicValue,
  } = {},
) {
  const root = fixtureRoot(caseId);
  const contextPath = `${root}/qa-context.md`;
  const binaryPath = `${root}/public/payload.bin`;
  const runPath = `${root}/public/run.sh`;
  const manifestPath = `${root}/fixture-manifest.json`;
  const context = Buffer.from(
    [
      "# Opaque evaluation context",
      "",
      "- **Report output folder:** QA/",
      "- **Platform:** web",
      "",
    ].join("\n"),
  );
  const binary = Buffer.from([0, 1, 2, 255, 0, 127]);
  const run = Buffer.from("#!/bin/sh\nexit 0\n");
  await write(join(repository, ...contextPath.split("/")), context);
  await write(join(repository, ...binaryPath.split("/")), binary);
  await write(join(repository, ...runPath.split("/")), run, 0o755);
  const files = [
    {
      mode: "100644",
      path: binaryPath,
      sha256: badHash ? "0".repeat(64) : digest(binary),
    },
    {
      mode: "100755",
      path: runPath,
      sha256: digest(run),
    },
    {
      mode: "100644",
      path: contextPath,
      sha256: digest(context),
    },
  ];
  if (publicValue !== undefined) {
    const neutralPath = `${root}/public/neutral.txt`;
    const neutral = Buffer.from(publicValue);
    await write(
      join(repository, ...neutralPath.split("/")),
      neutral,
    );
    files.push({
      mode: "100644",
      path: neutralPath,
      sha256: digest(neutral),
    });
    files.sort(({ path: left }, { path: right }) =>
      left.localeCompare(right),
    );
  }
  await write(
    join(repository, ...manifestPath.split("/")),
    canonicalJson({
      case_id: caseId,
      files,
      schema_version: 1,
    }),
  );
  return {
    contextPath,
    manifestPath,
  };
}

async function makeTreeWritable(path) {
  let metadata;
  try {
    metadata = await lstat(path);
  } catch {
    return;
  }
  if (metadata.isDirectory() && !metadata.isSymbolicLink()) {
    try {
      await chmod(path, 0o700);
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    let entries;
    try {
      entries = await readdir(path);
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      await makeTreeWritable(join(path, entry));
    }
  } else if (!metadata.isSymbolicLink()) {
    try {
      await chmod(path, 0o600);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

async function createHarness(
  t,
  {
    badManifest = false,
    fixtureLeakValue,
    programMismatch = false,
    subjectDirectoryDepth = 0,
    subjectFileCount = 0,
    subjectSymlink = false,
  } = {},
) {
  const base = await mkdtemp(join(tmpdir(), "qa-suite-eval-runner-"));
  const repository = join(base, "repository");
  const laneParent = join(base, "lanes");
  const stateParent = join(base, "state");
  await mkdir(repository);
  await mkdir(laneParent);
  await mkdir(stateParent);
  t.after(async () => {
    await makeTreeWritable(laneParent);
    await makeTreeWritable(stateParent);
    await rm(base, { force: true, recursive: true });
  });

  runGit(repository, ["init", "--quiet"]);
  await copyControllerProgram(repository);
  if (programMismatch) {
    await write(
      join(repository, "scripts", "evaluation", "runner.mjs"),
      "export const mismatchedController = true;\n",
    );
  }
  await write(
    join(repository, "qa-suite", "SKILL.md"),
    "subject version one\n",
  );
  const selected = await writeFixture(repository, caseIds.selected, {
    badHash: badManifest,
    publicValue: fixtureLeakValue,
  });
  const other = await writeFixture(repository, caseIds.other);
  const suite = {
    cases: [
      {
        fixture_manifest: selected.manifestPath,
        id: caseIds.selected,
        oracle_commitments: [
          commitments.selectedA,
          commitments.selectedB,
        ],
        qa_context: selected.contextPath,
        report_identifiers: {
          core_flow_ids: [
            "flow_00112233445566778899aabbccddeeff_01",
          ],
          surface_id: "surface_00112233445566778899aabbccddeeff",
        },
        smoke_checks: ["check_primary"],
      },
      {
        fixture_manifest: other.manifestPath,
        id: caseIds.other,
        oracle_commitments: [
          commitments.otherA,
          commitments.otherB,
        ],
        qa_context: other.contextPath,
        report_identifiers: {
          core_flow_ids: [
            "flow_ffeeddccbbaa99887766554433221100_01",
          ],
          surface_id: "surface_ffeeddccbbaa99887766554433221100",
        },
        smoke_checks: ["check_primary"],
      },
    ],
    id: "bob-evaluation-v1",
    lane: "bob-qa",
    schema_version: 1,
  };
  await write(
    join(repository, ...suitePath.split("/")),
    canonicalJson(suite),
  );
  runGit(repository, ["add", "--all"]);
  runGit(repository, [
    "-c",
    "user.name=QA Suite",
    "-c",
    "user.email=qa-suite@example.invalid",
    "commit",
    "--quiet",
    "--no-gpg-sign",
    "-m",
    "controller",
  ]);
  const controllerCommit = runGit(repository, ["rev-parse", "HEAD"]);

  await write(
    join(repository, "qa-suite", "SKILL.md"),
    "subject version two\n",
  );
  if (subjectDirectoryDepth > 0) {
    await write(
      join(
        repository,
        "qa-suite",
        ...Array.from(
          { length: subjectDirectoryDepth },
          (_, index) => `depth-${index}`,
        ),
        "deep.txt",
      ),
      "deep\n",
    );
  }
  for (let index = 0; index < subjectFileCount; index += 1) {
    await write(
      join(
        repository,
        "qa-suite",
        "generated",
        `${String(index).padStart(4, "0")}.txt`,
      ),
      `${index}\n`,
    );
  }
  if (subjectSymlink) {
    const linkPath = join(repository, "qa-suite", "references", "linked.md");
    await mkdir(dirname(linkPath), { recursive: true });
    await symlink("../SKILL.md", linkPath);
  }
  runGit(repository, ["add", "--all"]);
  runGit(repository, [
    "-c",
    "user.name=QA Suite",
    "-c",
    "user.email=qa-suite@example.invalid",
    "commit",
    "--quiet",
    "--no-gpg-sign",
    "-m",
    "subject",
  ]);
  const subjectCommit = runGit(repository, ["rev-parse", "HEAD"]);

  return {
    base,
    controllerCommit,
    laneParent,
    repository,
    stateParent,
    subjectCommit,
  };
}

async function prepare(
  harness,
  { writableRoots = ["QA"] } = {},
) {
  return prepareCaseRun({
    caseId: caseIds.selected,
    controllerRef: harness.controllerCommit,
    laneParent: harness.laneParent,
    repositoryPath: harness.repository,
    stateParent: harness.stateParent,
    subjectRef: harness.subjectCommit,
    suitePath,
    writableRoots,
  });
}

async function relativePaths(root) {
  const paths = [];
  async function visit(directory, prefix = "") {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      paths.push(path);
      if (entry.isDirectory()) {
        await visit(join(directory, entry.name), path);
      }
    }
  }
  await visit(root);
  return paths.sort();
}

test("prepare freezes independent commits into a neutral single-case root", async (t) => {
  const harness = await createHarness(t);
  await write(
    join(
      harness.repository,
      ...fixtureRoot(caseIds.selected).split("/"),
      "public",
      "payload.bin",
    ),
    Buffer.from("working-tree poison"),
  );
  await write(
    join(harness.repository, "untracked-secret.txt"),
    commitments.selectedA,
  );

  const result = await prepare(harness);

  assert.equal(result.controller_commit, harness.controllerCommit);
  assert.equal(result.subject_commit, harness.subjectCommit);
  assert.equal(result.preparation.qualification, "not-evidence");
  assert.equal(result.preparation.result, null);
  assert.equal(result.preparation.verification_status, "unverified");
  assert.equal(result.qualification, "not-evidence");
  assert.equal(result.result, null);
  assert.equal(result.verification_status, "unverified");
  assert.deepEqual(result.claims, result.preparation.claims);
  assert.deepEqual(result.preparation.claims, {
    adapter_status: "not-run",
    artifact_inventory: "not-closed",
    context_isolation: "not-attested",
    execution_isolation: "not-attested",
    fixture_opacity: "not-attested",
    input_integrity: "verified",
    method_order: "unverified_by_report",
    network_isolation: "not-attested",
    state_authentication: "not-attested",
  });

  const paths = await relativePaths(result.lane_root);
  assert.ok(paths.includes(CASE_DISCLOSURE_PATH));
  assert.ok(paths.includes("QA"));
  assert.ok(paths.includes("qa-suite/SKILL.md"));
  assert.ok(
    paths.includes(`${fixtureRoot(caseIds.selected)}/public/payload.bin`),
  );
  assert.equal(paths.some((path) => path.endsWith("fixture-manifest.json")), false);
  assert.equal(paths.some((path) => path.includes(caseIds.other)), false);
  assert.equal(paths.some((path) => path === ".git"), false);
  assert.equal(paths.some((path) => path.includes("journal.jsonl")), false);

  assert.equal(
    await readFile(join(result.lane_root, "qa-suite", "SKILL.md"), "utf8"),
    "subject version two\n",
  );
  assert.deepEqual(
    await readFile(
      join(
        result.lane_root,
        ...fixtureRoot(caseIds.selected).split("/"),
        "public",
        "payload.bin",
      ),
    ),
    Buffer.from([0, 1, 2, 255, 0, 127]),
  );

  const disclosureSource = await readFile(
    join(result.lane_root, CASE_DISCLOSURE_PATH),
    "utf8",
  );
  const disclosure = JSON.parse(disclosureSource);
  assert.equal(validateCaseDisclosure(disclosure), disclosure);
  assert.deepEqual(Object.keys(disclosure).sort(), [
    "case_id",
    "lane",
    "mission",
    "qa_context",
    "run_id",
    "schema_version",
    "subject_commit",
    "subject_root",
    "writable_roots",
  ]);
  for (const value of [
    ...Object.values(commitments),
    caseIds.other,
    "flow_00112233445566778899aabbccddeeff_01",
    harness.repository,
    "report_identifiers",
    "surface_00112233445566778899aabbccddeeff",
    suitePath,
  ]) {
    assert.equal(disclosureSource.includes(value), false);
  }
  assert.notEqual(dirname(result.state_path), result.lane_root);
  assert.equal((await stat(result.lane_root)).mode & 0o777, 0o555);
  assert.equal(
    (await stat(
      join(
        result.lane_root,
        ...fixtureRoot(caseIds.selected).split("/"),
        "public",
        "run.sh",
      ),
    )).mode & 0o777,
    0o555,
  );
});

test("CLI serializes non-qualification at the actual top level", async (t) => {
  const harness = await createHarness(t);
  const prepared = JSON.parse(
    execFileSync(
      process.execPath,
      [
        runnerCli,
        "prepare",
        "--repository",
        harness.repository,
        "--controller-ref",
        harness.controllerCommit,
        "--subject-ref",
        harness.subjectCommit,
        "--suite",
        suitePath,
        "--case",
        caseIds.selected,
        "--state-parent",
        harness.stateParent,
        "--lane-parent",
        harness.laneParent,
        "--writable-root",
        "QA",
      ],
      { encoding: "utf8" },
    ),
  );
  assert.equal(prepared.verification_status, "unverified");
  assert.equal(prepared.qualification, "not-evidence");
  assert.equal(prepared.result, null);
  assert.equal(prepared.claims.fixture_opacity, "not-attested");
  await write(join(prepared.lane_root, "QA", "report.md"), "Go\n");

  const closed = JSON.parse(
    execFileSync(
      process.execPath,
      [runnerCli, "close", "--state", prepared.state_path],
      { encoding: "utf8" },
    ),
  );
  assert.equal(closed.verification_status, "unverified");
  assert.equal(closed.qualification, "not-evidence");
  assert.equal(closed.result, null);
  assert.equal(closed.claims.state_authentication, "not-attested");
});

test("close inventories only regular artifacts and stays non-qualifying", async (t) => {
  const harness = await createHarness(t);
  const prepared = await prepare(harness);
  const qaRoot = join(prepared.lane_root, "QA");
  await write(join(qaRoot, "report.md"), "Go\n");
  await write(
    join(qaRoot, "evidence", "capture.bin"),
    Buffer.from([65, 0, 66, 255]),
    0o600,
  );

  const result = await closeCaseRun({ statePath: prepared.state_path });

  assert.equal(result.closure.qualification, "not-evidence");
  assert.equal(result.closure.result, null);
  assert.equal(result.closure.verification_status, "unverified");
  assert.equal(result.qualification, "not-evidence");
  assert.equal(result.result, null);
  assert.equal(result.verification_status, "unverified");
  assert.deepEqual(result.claims, result.closure.claims);
  assert.equal(result.closure.claims.artifact_inventory, "closed");
  assert.equal(result.closure.claims.method_order, "unverified_by_report");
  assert.equal(result.closure.artifact_snapshot_root, "artifacts");
  assert.equal(
    result.artifact_snapshot_path,
    join(dirname(prepared.state_path), "artifacts"),
  );
  assert.deepEqual(
    result.closure.artifacts.map(({ path }) => path),
    ["QA/evidence/capture.bin", "QA/report.md"],
  );
  assert.deepEqual(
    result.closure.artifacts.map(({ mode }) => mode),
    ["0400", "0400"],
  );
  assert.equal(
    await readFile(
      join(result.artifact_snapshot_path, "QA", "report.md"),
      "utf8",
    ),
    "Go\n",
  );
  assert.equal(
    (await stat(result.artifact_snapshot_path)).mode & 0o777,
    0o500,
  );
  assert.match(result.closure.artifact_tree_sha256, /^[0-9a-f]{64}$/);
  assert.match(result.closure.workspace_tree_sha256, /^[0-9a-f]{64}$/);
  const journal = await readFile(
    join(dirname(prepared.state_path), "journal.jsonl"),
    "utf8",
  );
  const journalEntries = journal
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    journalEntries.map(({ event }) => event),
    ["prepared", "close_started", "closed"],
  );
  assert.equal(
    journalEntries.at(-1).payload_sha256,
    digest(canonicalJson(result.closure)),
  );
  assert.deepEqual(
    JSON.parse(await readFile(result.closed_path, "utf8")),
    result.closure,
  );
  await assert.rejects(
    () =>
      readFile(
        join(dirname(prepared.state_path), "closed.pending.json"),
      ),
    /ENOENT/u,
  );
  await assert.rejects(
    () => closeCaseRun({ statePath: prepared.state_path }),
    /EEXIST|exist/u,
  );
});

test("closed consumers use the captured snapshot, not mutable lane bytes", async (t) => {
  const harness = await createHarness(t);
  const prepared = await prepare(harness);
  const liveArtifact = join(prepared.lane_root, "QA", "report.md");
  await write(liveArtifact, "captured\n");

  const result = await closeCaseRun({ statePath: prepared.state_path });
  const capturedArtifact = join(
    result.artifact_snapshot_path,
    "QA",
    "report.md",
  );
  const acceptedDigest = result.closure.artifacts[0].sha256;

  await chmod(liveArtifact, 0o600);
  await writeFile(liveArtifact, "changed after close\n");
  assert.equal(await readFile(capturedArtifact, "utf8"), "captured\n");
  assert.equal(digest(await readFile(capturedArtifact)), acceptedDigest);
  assert.equal(
    (await stat(capturedArtifact)).mode & 0o777,
    0o400,
  );
});

test("closed Bob report metadata enters the non-qualifying binding seam", async (t) => {
  const harness = await createHarness(t);
  const prepared = await prepare(harness);
  const reportPath =
    "QA/2026-07-28-0415-bob-qa-primary-surface.md";
  await write(
    join(prepared.lane_root, ...reportPath.split("/")),
    "Go\n\nOpaque historical report shape.\n",
  );

  const closed = await closeCaseRun({ statePath: prepared.state_path });
  const binding = bindClosedBobReport({ closure: closed.closure });

  assert.equal(binding.binding.report.path, reportPath);
  assert.equal(
    binding.binding.report.sha256,
    digest("Go\n\nOpaque historical report shape.\n"),
  );
  assert.equal(binding.claims.report_content, "not-read");
  assert.equal(binding.claims.report_structure, "not-parsed");
  assert.equal(binding.verification_status, "unverified");
  assert.equal(binding.qualification, "not-evidence");
  assert.equal(binding.result, null);
});

test("close rejects immutable input mutation", async (t) => {
  const harness = await createHarness(t);
  const prepared = await prepare(harness);
  const subject = join(prepared.lane_root, "qa-suite", "SKILL.md");
  await chmod(subject, 0o600);
  await writeFile(subject, "tampered\n");
  await chmod(subject, 0o444);

  await assert.rejects(
    () => closeCaseRun({ statePath: prepared.state_path }),
    /immutable lane input changed/u,
  );
  await assert.rejects(
    () => readFile(join(dirname(prepared.state_path), "closed.json")),
    /ENOENT/u,
  );
});

test("close rejects undeclared outputs outside writable roots", async (t) => {
  const harness = await createHarness(t);
  const prepared = await prepare(harness);
  await chmod(prepared.lane_root, 0o755);
  await writeFile(join(prepared.lane_root, "escaped.log"), "unexpected\n");
  await chmod(prepared.lane_root, 0o555);

  await assert.rejects(
    () => closeCaseRun({ statePath: prepared.state_path }),
    /escaped writable roots/u,
  );
});

test("close rejects symlinks and hardlinks", async (t) => {
  const symlinkHarness = await createHarness(t);
  const symlinkPrepared = await prepare(symlinkHarness);
  await symlink(
    "../qa-suite/SKILL.md",
    join(symlinkPrepared.lane_root, "QA", "linked.md"),
  );
  await assert.rejects(
    () => closeCaseRun({ statePath: symlinkPrepared.state_path }),
    /symbolic link/u,
  );

  const hardlinkHarness = await createHarness(t);
  const hardlinkPrepared = await prepare(hardlinkHarness);
  await link(
    join(hardlinkPrepared.lane_root, "qa-suite", "SKILL.md"),
    join(hardlinkPrepared.lane_root, "QA", "linked.md"),
  );
  await assert.rejects(
    () => closeCaseRun({ statePath: hardlinkPrepared.state_path }),
    /standalone regular file/u,
  );
});

test("close rejects public commitment leakage in artifact bytes", async (t) => {
  const harness = await createHarness(t);
  const prepared = await prepare(harness);
  await write(
    join(prepared.lane_root, "QA", "report.md"),
    `Go\n${commitments.otherA}\n`,
  );

  await assert.rejects(
    () => closeCaseRun({ statePath: prepared.state_path }),
    /controller-value-leak/u,
  );
});

test("close never repeats confidential values from artifact paths", async (t) => {
  const harness = await createHarness(t);
  const prepared = await prepare(harness);
  const confidentialValue = commitments.otherB;
  await write(
    join(prepared.lane_root, "QA", `${confidentialValue}.md`),
    "opaque\n",
  );

  await assert.rejects(
    () => closeCaseRun({ statePath: prepared.state_path }),
    (error) => {
      assert.equal(error.message.includes(confidentialValue), false);
      assert.match(error.message, /controller-value-leak/u);
      return true;
    },
  );
});

test("close scans confidential values in empty artifact directories", async (t) => {
  const harness = await createHarness(t);
  const prepared = await prepare(harness);
  const confidentialValue = commitments.selectedB;
  await mkdir(
    join(prepared.lane_root, "QA", confidentialValue),
  );

  await assert.rejects(
    () => closeCaseRun({ statePath: prepared.state_path }),
    (error) => {
      assert.equal(error.message.includes(confidentialValue), false);
      assert.match(error.message, /controller-value-leak/u);
      return true;
    },
  );
});

test("close enforces artifact depth and size before reading bytes", async (t) => {
  const deepHarness = await createHarness(t);
  const deepPrepared = await prepare(deepHarness);
  const deepSegments = Array.from(
    { length: 32 },
    (_, index) => `d${index}`,
  );
  await write(
    join(deepPrepared.lane_root, "QA", ...deepSegments, "report.md"),
    "too deep\n",
  );
  await assert.rejects(
    () => closeCaseRun({ statePath: deepPrepared.state_path }),
    /exceeds depth/u,
  );

  const largeHarness = await createHarness(t);
  const largePrepared = await prepare(largeHarness);
  await write(
    join(largePrepared.lane_root, "QA", "large.bin"),
    Buffer.alloc(16 * 1024 * 1024 + 1),
  );
  await assert.rejects(
    () => closeCaseRun({ statePath: largePrepared.state_path }),
    /exceeds 16777216 bytes/u,
  );
});

test("prepare rejects manifest drift and unsupported subject links", async (t) => {
  const badManifest = await createHarness(t, { badManifest: true });
  await assert.rejects(
    () => prepare(badManifest),
    /differs from its manifest/u,
  );

  const linkedSubject = await createHarness(t, { subjectSymlink: true });
  await assert.rejects(
    () => prepare(linkedSubject),
    /regular blob with mode 100644 or 100755/u,
  );
});

test("prepare rejects other case identities without disclosing them", async (t) => {
  const harness = await createHarness(t, {
    fixtureLeakValue: caseIds.other,
  });

  await assert.rejects(
    () => prepare(harness),
    (error) => {
      assert.equal(error.message.includes(caseIds.other), false);
      assert.match(error.message, /controller-value-leak/u);
      return true;
    },
  );
});

test("prepare accepts only the qa-context report root as writable", async (t) => {
  const harness = await createHarness(t);

  await assert.rejects(
    () => prepare(harness, { writableRoots: ["QA", "EXTRA"] }),
    /writable roots must equal path-sha256:/u,
  );
});

test("prepare rejects oversized subject trees before blob reads", async (t) => {
  const harness = await createHarness(t, {
    subjectFileCount: 2_048,
  });

  await assert.rejects(
    () => prepare(harness),
    /exceeds 2048 entries|exceeds 2048 files/u,
  );
});

test("prepare rejects excessive Git path depth before blob reads", async (t) => {
  const harness = await createHarness(t, {
    subjectDirectoryDepth: 32,
  });

  await assert.rejects(
    () => prepare(harness),
    /frozen input exceeds depth 32/u,
  );
});

test("materialization rejects excessive unique parent nodes before writes", async (t) => {
  const harness = await createHarness(t);
  const destination = join(harness.base, "materialized");
  await mkdir(destination);
  const objectId = runGit(harness.repository, [
    "rev-parse",
    `${harness.subjectCommit}:qa-suite/SKILL.md`,
  ]);
  const entries = Array.from({ length: 2_048 }, (_, index) => ({
    mode: "100644",
    object_id: objectId,
    path: [
      `root-${index}`,
      "a",
      "b",
      "c",
      "d",
      "e",
      "f",
      "g",
      "h",
      "file.txt",
    ].join("/"),
  }));

  await assert.rejects(
    () =>
      materializeEntries({
        commit: harness.subjectCommit,
        destination,
        entries,
        repositoryPath: harness.repository,
      }),
    /entries exceed 16384 materialized nodes/u,
  );
  assert.deepEqual(await readdir(destination), []);
});

test("prepare rejects controller program drift", async (t) => {
  const harness = await createHarness(t, { programMismatch: true });

  await assert.rejects(
    () => prepare(harness),
    /differs from controller commit/u,
  );
});

test("close rejects a tampered hash-chain journal", async (t) => {
  const harness = await createHarness(t);
  const prepared = await prepare(harness);
  const journalPath = join(dirname(prepared.state_path), "journal.jsonl");
  const event = JSON.parse(await readFile(journalPath, "utf8"));
  event.sequence = 2;
  await writeFile(journalPath, `${JSON.stringify(event)}\n`);

  await assert.rejects(
    () => closeCaseRun({ statePath: prepared.state_path }),
    /sequence is not monotonic|sha256 does not match/u,
  );
});

test("single-case disclosure rejects extra, overlapping, and multiple roots", () => {
  const disclosure = {
    case_id: caseIds.selected,
    lane: "bob-qa",
    mission: "discovery",
    qa_context: `${fixtureRoot(caseIds.selected)}/qa-context.md`,
    run_id: `run_${"a".repeat(32)}`,
    schema_version: 1,
    subject_commit: "b".repeat(40),
    subject_root: "qa-suite",
    writable_roots: ["QA"],
  };
  assert.equal(validateCaseDisclosure(disclosure), disclosure);
  assert.throws(
    () => validateCaseDisclosure({ ...disclosure, role: "control" }),
    /fields are/u,
  );
  assert.throws(
    () =>
      validateCaseDisclosure({
        ...disclosure,
        writable_roots: ["qa-suite/output"],
      }),
    /overlaps immutable input/u,
  );
  assert.throws(
    () =>
      validateCaseDisclosure({
        ...disclosure,
        writable_roots: ["QA", "QA/evidence"],
      }),
    /at most 1 item/u,
  );
  assert.throws(
    () =>
      validateCaseDisclosure({
        ...disclosure,
        writable_roots: ["QA", "EXTRA"],
      }),
    /at most 1 item/u,
  );
});

test("CLI parser rejects missing, duplicate, and unknown arguments", () => {
  assert.throws(() => parseArguments([]), /command is required/u);
  assert.throws(
    () => parseArguments(["prepare", "--unknown", "value"]),
    /unknown prepare option/u,
  );
  assert.throws(
    () =>
      parseArguments([
        "prepare",
        "--case",
        caseIds.selected,
        "--case",
        caseIds.other,
      ]),
    /provided only once/u,
  );
  assert.throws(
    () =>
      parseArguments([
        "prepare",
        "--writable-root",
        "QA",
        "--writable-root",
        "EXTRA",
      ]),
    /writable-root may be provided only once/u,
  );
  assert.throws(
    () => parseArguments(["close", "--state"]),
    /requires exactly/u,
  );
  assert.deepEqual(
    parseArguments(["close", "--state", "/tmp/state.json"]),
    {
      command: "close",
      values: { statePath: "/tmp/state.json" },
    },
  );
  assert.equal(
    redactControllerSecrets(
      `failure for ${commitments.selectedA}`,
    ),
    "failure for <redacted-controller-value>",
  );
});
