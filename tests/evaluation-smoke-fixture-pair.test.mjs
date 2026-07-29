import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  lstat,
  readFile,
  readdir,
} from "node:fs/promises";
import {
  dirname,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { test } from "node:test";
import {
  fileURLToPath,
  pathToFileURL,
} from "node:url";
import {
  canonicalJson,
  parseContractJson,
  sha256,
  validateFixtureManifest,
  validateOracleSet,
  validateSuite,
} from "../scripts/evaluation/contracts.mjs";
import { previewSuite } from "../scripts/evaluation/scoring.mjs";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);
const suite = await readContract(
  "tests/evaluation/suites/smoke-evaluation-v1.json",
  "smoke suite",
);
const oracles = await readContract(
  "tests/evaluation/oracles/smoke-evaluation-v1.json",
  "smoke oracle set",
);
const adversarial = oracles.find(({ role }) => role === "adversarial");
const control = oracles.find(({ role }) => role === "control");
assert.ok(adversarial);
assert.ok(control);

async function readContract(path, label) {
  return parseContractJson(
    await readFile(join(repositoryRoot, path), "utf8"),
    label,
  );
}

function fixtureRoot(caseId) {
  return join(repositoryRoot, "tests/evaluation/fixtures", caseId);
}

async function collectFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(path));
    } else if (entry.isFile()) {
      files.push(path);
    } else {
      throw new Error(`unsupported fixture entry ${path}`);
    }
  }
  return files.sort();
}

function repositoryPath(path) {
  return relative(repositoryRoot, path).split(sep).join("/");
}

function waitForPort(child) {
  return new Promise((resolvePort, rejectPort) => {
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(
      () => rejectPort(new Error(`fixture server timed out: ${stderr}`)),
      5_000,
    );
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      const newline = stdout.indexOf("\n");
      if (newline === -1) return;
      const port = Number(stdout.slice(0, newline));
      clearTimeout(timeout);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        rejectPort(new Error(`fixture returned invalid port ${stdout}`));
        return;
      }
      resolvePort(port);
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      rejectPort(error);
    });
    child.once("exit", (code) => {
      if (stdout.includes("\n")) return;
      clearTimeout(timeout);
      rejectPort(new Error(`fixture server exited ${code}: ${stderr}`));
    });
  });
}

async function startFixture(caseId) {
  const child = spawn(
    process.execPath,
    [join(fixtureRoot(caseId), "public/server.mjs"), "0"],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  try {
    const port = await waitForPort(child);
    return { child, url: `http://127.0.0.1:${port}` };
  } catch (error) {
    if (child.exitCode === null) child.kill("SIGTERM");
    throw error;
  }
}

async function stopFixture(child) {
  if (child.exitCode !== null) return;
  await new Promise((resolveStop, rejectStop) => {
    const timeout = setTimeout(
      () => rejectStop(new Error("fixture server did not stop")),
      5_000,
    );
    child.once("exit", () => {
      clearTimeout(timeout);
      resolveStop();
    });
    child.kill("SIGTERM");
  });
}

function exerciseRecovery(module) {
  let submit;
  const form = {
    addEventListener(name, listener) {
      assert.equal(name, "submit");
      submit = listener;
    },
  };
  const action = { disabled: false };
  const status = { textContent: "Ready to start recovery." };
  const elements = new Map([
    ["#recovery-form", form],
    ["#start-recovery", action],
    ["#recovery-status", status],
  ]);
  module.mountRecoveryConsole({
    querySelector: (selector) => elements.get(selector) ?? null,
  });
  submit({ preventDefault() {} });
  return { action, status };
}

function laneResult(role) {
  const failedEvidence = [{
    kind: "screenshot",
    path: "QA/evidence/recovery-action.png",
  }];
  const failed = role === "adversarial";
  return {
    blocking_evidence: failed ? failedEvidence : [],
    checklist: [
      {
        evidence: [],
        id: "check_app_startup",
        state: "Pass",
      },
      {
        evidence: failed ? failedEvidence : [],
        id: "check_recovery_action",
        state: failed ? "Fail" : "Pass",
      },
    ],
    findings: [],
    flows: [],
    not_tested: [],
    observations: [],
    verdict: {
      blocker: null,
      severity_counts: null,
      state: failed ? "No-Go" : "Go",
    },
  };
}

function normalizedCase(oracle) {
  return {
    case_id: oracle.case_id,
    completion_status: "completed",
    lane: "smoke-qa",
    lane_result: laneResult(oracle.role),
    schema_version: 1,
    smoke_gate: null,
    subject_commit: "0123456789abcdef0123456789abcdef01234567",
  };
}

test("smoke declarations seal exact role-neutral fixture bytes", async () => {
  assert.equal(validateSuite(suite), suite);
  assert.equal(validateOracleSet(oracles, suite), oracles);

  const seals = new Set(
    oracles.flatMap((oracle) => [
      oracle.pair_id,
      oracle.canary_token,
      oracle.role === "adversarial"
        ? oracle.assertions.expected_defects[0].id
        : oracle.assertions.control_budget.id,
    ]),
  );
  for (const suiteCase of suite.cases) {
    const manifest = await readContract(
      suiteCase.fixture_manifest,
      `${suiteCase.id} manifest`,
    );
    assert.equal(validateFixtureManifest(manifest, suiteCase), manifest);
    const actualPaths = [
      ...await collectFiles(join(fixtureRoot(suiteCase.id), "public")),
      join(repositoryRoot, suiteCase.qa_context),
    ].map(repositoryPath).sort();
    assert.deepEqual(
      manifest.files.map(({ path }) => path),
      actualPaths,
    );

    let selectedBytes = "";
    for (const declaration of manifest.files) {
      const path = join(repositoryRoot, declaration.path);
      const metadata = await lstat(path);
      const bytes = await readFile(path);
      assert.equal(metadata.isFile(), true);
      assert.equal(metadata.isSymbolicLink(), false);
      assert.equal(
        (metadata.mode & 0o111) === 0 ? "100644" : "100755",
        declaration.mode,
      );
      assert.equal(sha256(bytes), declaration.sha256);
      selectedBytes += bytes.toString("utf8");
    }
    for (const seal of seals) {
      assert.equal(selectedBytes.includes(seal), false);
    }
    for (const sibling of suite.cases) {
      if (sibling.id !== suiteCase.id) {
        assert.equal(selectedBytes.includes(sibling.id), false);
      }
    }
    for (const forbidden of [
      /\badversarial\b/iu,
      /(?<!-)\bcontrol\b/iu,
      /\bexpected[_ -]?defect\b/iu,
      /\bpair[_ -]?id\b/iu,
      /seal_[0-9a-f]{64}/u,
    ]) {
      assert.equal(forbidden.test(selectedBytes), false);
    }
  }
});

test("both fixtures start cleanly while only one recovery action completes", async () => {
  const roots = {
    adversarial: fixtureRoot(adversarial.case_id),
    control: fixtureRoot(control.case_id),
  };
  for (const path of [
    "public/findings.jsonl",
    "public/index.html",
    "public/server.mjs",
  ]) {
    assert.equal(
      await readFile(join(roots.adversarial, path), "utf8"),
      await readFile(join(roots.control, path), "utf8"),
    );
  }
  const contexts = await Promise.all(
    [adversarial, control].map(async (oracle) =>
      (await readFile(
        join(fixtureRoot(oracle.case_id), "qa-context.md"),
        "utf8",
      )).replaceAll(oracle.case_id, "fx_selected")
    ),
  );
  assert.equal(contexts[0], contexts[1]);

  const adversarialApp = await readFile(
    join(roots.adversarial, "public/app.mjs"),
    "utf8",
  );
  const controlApp = await readFile(
    join(roots.control, "public/app.mjs"),
    "utf8",
  );
  assert.equal(
    controlApp.replace(
      "const recoveryCompletes = true;",
      "const recoveryCompletes = false;",
    ),
    adversarialApp,
  );
  assert.equal(
    (controlApp.match(/const recoveryCompletes = true;/gu) ?? []).length,
    1,
  );
  assert.equal(
    (adversarialApp.match(/const recoveryCompletes = false;/gu) ?? []).length,
    1,
  );

  const modules = {};
  for (const [role, oracle] of Object.entries({ adversarial, control })) {
    modules[role] = await import(
      pathToFileURL(
        join(fixtureRoot(oracle.case_id), "public/app.mjs"),
      ).href
    );
    const running = await startFixture(oracle.case_id);
    try {
      const response = await fetch(`${running.url}/`);
      assert.equal(response.status, 200);
      assert.match(await response.text(), /<title>Recovery Console<\/title>/u);
    } finally {
      await stopFixture(running.child);
    }
  }

  const stuck = exerciseRecovery(modules.adversarial);
  assert.equal(stuck.status.textContent, "Starting recovery…");
  assert.equal(stuck.action.disabled, true);
  const completed = exerciseRecovery(modules.control);
  assert.equal(completed.status.textContent, "Recovery completed.");
  assert.equal(completed.action.disabled, false);
});

test("the sealed smoke pair produces a non-qualifying exact preview", () => {
  const input = {
    normalizedCases: oracles.map(normalizedCase),
    oracles,
    suite,
  };
  const preview = previewSuite(input);
  const pair = preview.pairs[0];

  assert.equal(preview.completion_status, "complete");
  assert.equal(preview.preview_assertions, "met");
  assert.deepEqual(pair.detection, { denominator: 1, numerator: 1 });
  assert.equal(pair.control_positives, 0);
  assert.equal(pair.control_budget_met, true);
  assert.equal(pair.preview_assertions, "met");
  assert.equal(preview.cases[0].detection.status, "matched");
  assert.equal(preview.cases[1].control.budget_met, true);

  for (const output of [
    preview,
    preview.aggregate,
    pair,
    ...preview.cases,
  ]) {
    assert.equal(output.verification_status, "unverified");
    assert.equal(output.qualification, "not-evidence");
    assert.equal(output.result, null);
  }
  assert.equal(
    canonicalJson(preview),
    canonicalJson(previewSuite(structuredClone(input))),
  );
});
