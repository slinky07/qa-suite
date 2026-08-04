import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const verifier = new URL(
  "../qa-suite/scripts/verify-installed-payload.mjs",
  import.meta.url,
);

function git(args, cwd) {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

async function fixture(context, options = {}) {
  const root = await mkdtemp(join(tmpdir(), "qa-installed-payload-"));
  context.after(() => rm(root, { recursive: true, force: true }));

  const repository = join(root, "repository");
  const source = join(repository, "qa-suite");
  const installedRoot = join(root, "installed", "qa-suite");
  const archive = join(root, "qa-suite-source.zip");
  await mkdir(join(source, "nested"), { recursive: true });
  await writeFile(join(source, "SKILL.md"), "fixture skill\n");
  await writeFile(join(source, "nested", "file.txt"), "fixture file\n");
  await symlink("SKILL.md", join(source, "skill-link"));
  await symlink("nested", join(source, "directory-link"));
  if (options.reenteringSymlink === true) {
    await symlink(
      "../../qa-suite/SKILL.md",
      join(source, "nested", "reentry-link"),
    );
  }

  git(["init", "-q"], repository);
  git(["add", "qa-suite"], repository);
  git(
    [
      "-c",
      "user.name=QA fixture",
      "-c",
      "user.email=qa-fixture@example.com",
      "commit",
      "-qm",
      "fixture",
    ],
    repository,
  );
  git(
    [
      "archive",
      "--format=zip",
      "-0",
      `--output=${archive}`,
      "HEAD",
      "qa-suite",
    ],
    repository,
  );
  await cp(source, installedRoot, {
    recursive: true,
    verbatimSymlinks: true,
  });

  return { archive, installedRoot, root };
}

function runVerifier(archive, installedRoot) {
  return spawnSync(
    process.execPath,
    [
      verifier.pathname,
      "--archive",
      archive,
      "--installed-root",
      installedRoot,
    ],
    { encoding: "utf8" },
  );
}

function parseReport(result) {
  const output = result.status === 2 ? result.stderr : result.stdout;
  return JSON.parse(output);
}

test("verifier accepts an exact file, directory, and symlink tree", async (context) => {
  const { archive, installedRoot } = await fixture(context);
  const result = runVerifier(archive, installedRoot);
  const report = parseReport(result);
  const digest = createHash("sha256")
    .update(await readFile(archive))
    .digest("hex");

  assert.equal(result.status, 0, result.stderr);
  assert.equal(report.result, "match");
  assert.equal(report.archive_sha256, digest);
  assert.equal(report.expected_entries, 5);
  assert.equal(report.observed_entries, 5);
  assert.deepEqual(report.differences, []);
});

test("verifier reports changed file content", async (context) => {
  const { archive, installedRoot } = await fixture(context);
  await writeFile(join(installedRoot, "SKILL.md"), "changed\n");

  const result = runVerifier(archive, installedRoot);
  const report = parseReport(result);

  assert.equal(result.status, 1, result.stderr);
  assert.equal(report.result, "mismatch");
  assert.deepEqual(
    report.differences.map(({ path, difference }) => ({ path, difference })),
    [{ path: "SKILL.md", difference: "content" }],
  );
  assert.match(report.differences[0].expected_sha256, /^[0-9a-f]{64}$/);
  assert.match(report.differences[0].observed_sha256, /^[0-9a-f]{64}$/);
});

test("verifier reports missing and extra entries deterministically", async (context) => {
  const { archive, installedRoot } = await fixture(context);
  await rm(join(installedRoot, "nested", "file.txt"));
  await writeFile(join(installedRoot, "extra.txt"), "extra\n");

  const result = runVerifier(archive, installedRoot);
  const report = parseReport(result);

  assert.equal(result.status, 1, result.stderr);
  assert.deepEqual(
    report.differences.map(({ path, difference }) => ({ path, difference })),
    [
      { path: "extra.txt", difference: "extra" },
      { path: "nested/file.txt", difference: "missing" },
    ],
  );
});

test("verifier reports entry-type drift", async (context) => {
  const { archive, installedRoot } = await fixture(context);
  await rm(join(installedRoot, "SKILL.md"));
  await mkdir(join(installedRoot, "SKILL.md"));

  const result = runVerifier(archive, installedRoot);
  const report = parseReport(result);

  assert.equal(result.status, 1, result.stderr);
  assert.deepEqual(report.differences, [
    {
      path: "SKILL.md",
      difference: "type",
      expected_type: "file",
      observed_type: "directory",
    },
  ]);
});

test("verifier compares symlink targets without following them", async (context) => {
  const { archive, installedRoot } = await fixture(context);
  await rm(join(installedRoot, "skill-link"));
  await symlink("nested/file.txt", join(installedRoot, "skill-link"));

  const result = runVerifier(archive, installedRoot);
  const report = parseReport(result);

  assert.equal(result.status, 1, result.stderr);
  assert.deepEqual(report.differences, [
    {
      path: "skill-link",
      difference: "symlink-target",
      expected_target: "SKILL.md",
      observed_target: "nested/file.txt",
    },
  ]);
});

test("verifier rejects malformed and traversal archives", async (context) => {
  const { archive, installedRoot, root } = await fixture(context);
  const malformed = join(root, "malformed.zip");
  await writeFile(malformed, "not a ZIP archive");

  const malformedResult = runVerifier(malformed, installedRoot);
  const malformedReport = parseReport(malformedResult);
  assert.equal(malformedResult.status, 2);
  assert.equal(malformedReport.result, "error");
  assert.match(malformedReport.error, /too short|end-of-central-directory/);
  assert.match(malformedReport.archive_sha256, /^[0-9a-f]{64}$/);

  const unsafe = join(root, "unsafe.zip");
  const unsafeBytes = Buffer.from(await readFile(archive));
  const safeName = Buffer.from("qa-suite/SKILL.md");
  const unsafeName = Buffer.from("qa-suite/../badxx");
  assert.equal(safeName.length, unsafeName.length);
  let replacements = 0;
  let offset = 0;
  while ((offset = unsafeBytes.indexOf(safeName, offset)) !== -1) {
    unsafeName.copy(unsafeBytes, offset);
    replacements += 1;
    offset += unsafeName.length;
  }
  assert.equal(replacements, 2, "fixture must contain local and central names");
  await writeFile(unsafe, unsafeBytes);

  const unsafeResult = runVerifier(unsafe, installedRoot);
  const unsafeReport = parseReport(unsafeResult);
  assert.equal(unsafeResult.status, 2);
  assert.equal(unsafeReport.result, "error");
  assert.match(unsafeReport.error, /Unsafe or non-canonical ZIP entry path/);
});

test("verifier rejects symlinks that escape and lexically re-enter qa-suite", async (context) => {
  const { archive, installedRoot } = await fixture(context, {
    reenteringSymlink: true,
  });

  const result = runVerifier(archive, installedRoot);
  const report = parseReport(result);

  assert.equal(result.status, 2);
  assert.equal(report.result, "error");
  assert.match(report.error, /Symlink target escapes qa-suite/);
  assert.match(report.archive_sha256, /^[0-9a-f]{64}$/);
});

test("verifier rejects incomplete CLI arguments", () => {
  const result = spawnSync(process.execPath, [verifier.pathname, "--archive"], {
    encoding: "utf8",
  });
  const report = parseReport(result);

  assert.equal(result.status, 2);
  assert.equal(report.result, "error");
  assert.match(report.error, /Missing value for --archive/);
  assert.match(report.usage, /--archive.*--installed-root/);
});

test("consumer lifecycle docs require pinned identity and verified rollback", async () => {
  const [readme, releaseGuide, context] = await Promise.all([
    readFile(new URL("../README.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/releasing.md", import.meta.url), "utf8"),
    readFile(new URL("../qa-context.md", import.meta.url), "utf8"),
  ]);

  assert.match(readme, /installed flag or displayed version is not payload proof/i);
  assert.match(readme, /verify-installed-payload\.mjs/);
  assert.match(readme, /Rollback uses the same remove, pinned-marketplace add/);

  for (const contract of [
    /gh release verify/,
    /claude plugin marketplace add "slinky07\/qa-suite@\$qa_target_tag"/,
    /codex plugin marketplace add slinky07\/qa-suite --ref "\$qa_target_tag"/,
    /claude plugin list --json/,
    /codex plugin list --marketplace qa-suite --json/,
    /same remove, pinned-marketplace add, install/,
    /Roll back by\s+replacing it with the prior file/,
    /post-upload payload identity/,
    /qa_published_tag=vX\.Y\.Z/,
    /Both installed trees must match/,
    /v1\.4\.0/,
  ]) {
    assert.match(releaseGuide, contract);
  }
  assert.doesNotMatch(releaseGuide, /plugin marketplace upgrade qa-suite/);

  assert.match(context, /\*\*Intended audience:\*\* Developers and release operators/);
  assert.match(context, /\*\*Disposable test target:\*\* A fresh ephemeral/);
  assert.match(context, /pre-publication draft.*release-evidence\.json/);
  assert.match(context, /published release requires successful `gh release verify`/);
  assert.match(context, /gh release verify/);
  assert.match(context, /verify-installed-payload\.mjs/);
});
