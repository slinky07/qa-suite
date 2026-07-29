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
const subjectCommit = "0123456789abcdef0123456789abcdef01234567";

async function readContract(path, label) {
  return parseContractJson(
    await readFile(join(repositoryRoot, path), "utf8"),
    label,
  );
}

const performanceSuite = await readContract(
  "tests/evaluation/suites/performance-evaluation-v1.json",
  "performance suite",
);
const performanceOracles = await readContract(
  "tests/evaluation/oracles/performance-evaluation-v1.json",
  "performance oracle set",
);
const securitySuite = await readContract(
  "tests/evaluation/suites/security-evaluation-v1.json",
  "security suite",
);
const securityOracles = await readContract(
  "tests/evaluation/oracles/security-evaluation-v1.json",
  "security oracle set",
);
const corpora = [
  {
    oracles: performanceOracles,
    suite: performanceSuite,
  },
  {
    oracles: securityOracles,
    suite: securitySuite,
  },
];

function fixtureRoot(caseId) {
  return join(
    repositoryRoot,
    "tests/evaluation/fixtures",
    caseId,
  );
}

async function collectFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(filePath));
    } else if (entry.isFile()) {
      files.push(filePath);
    } else {
      throw new Error(`unsupported fixture entry ${filePath}`);
    }
  }
  return files.sort();
}

function repositoryPath(filePath) {
  return relative(repositoryRoot, filePath).split(sep).join("/");
}

function oracleTokens(oracles) {
  return oracles.flatMap((oracle) => [
    oracle.pair_id,
    oracle.canary_token,
    oracle.role === "adversarial"
      ? oracle.assertions.expected_defects[0].id
      : oracle.assertions.control_budget.id,
  ]);
}

function pairRoles(oracles) {
  const adversarial = oracles.find(({ role }) => role === "adversarial");
  const control = oracles.find(({ role }) => role === "control");
  assert.ok(adversarial);
  assert.ok(control);
  return { adversarial, control };
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
    return {
      child,
      origin: `http://127.0.0.1:${port}`,
    };
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

function smokeGate() {
  return {
    blocking_evidence: [],
    checklist: [
      {
        evidence: [],
        id: "check_service_startup",
        state: "Pass",
      },
    ],
    findings: [],
    flows: [],
    not_tested: [],
    observations: [],
    verdict: {
      blocker: null,
      severity_counts: null,
      state: "Go",
    },
  };
}

function specialistResult({ lane, role }) {
  const finding = lane === "performance-qa"
    ? {
        classification: "governed",
        criteria: ["PERF-WEB-02"],
        evidence: [
          {
            kind: "measurement",
            path: "QA/evidence/journey-brief-p95.json",
          },
        ],
        id: "PERF-01",
        priority: "P1",
        severity: "S3",
        surface_id: "surface_journey_brief",
      }
    : {
        classification: "governed",
        criteria: ["forwarded-header-trust"],
        evidence: [
          {
            kind: "report-reference",
            path: "QA/2026-07-29-1200-security-forwarding-boundary.md",
          },
        ],
        id: "SEC-01",
        priority: "P1",
        severity: "S3",
        surface_id: "surface_forwarding_boundary",
      };
  const findings = role === "adversarial" ? [finding] : [];
  return {
    blocking_evidence: [],
    checklist: [],
    findings,
    flows: [],
    not_tested: [],
    observations: [],
    verdict: {
      blocker: null,
      severity_counts: {
        S1: 0,
        S2: 0,
        S3: findings.length,
        S4: 0,
      },
      state: findings.length === 0 ? "Go" : "Go with findings",
    },
  };
}

function normalizedCase(oracle, suite) {
  return {
    case_id: oracle.case_id,
    completion_status: "completed",
    lane: suite.lane,
    lane_result: specialistResult({
      lane: suite.lane,
      role: oracle.role,
    }),
    schema_version: 1,
    smoke_gate: smokeGate(),
    subject_commit: subjectCommit,
  };
}

test("pair declarations seal exact role-neutral local fixture bytes", async () => {
  const allCaseIds = corpora.flatMap(({ suite }) =>
    suite.cases.map(({ id }) => id)
  );
  const allSeals = corpora.flatMap(({ oracles }) => oracleTokens(oracles));
  for (const seal of allSeals) {
    const body = seal.slice("seal_".length);
    assert.equal(body.length, 64);
    assert.equal(body, body.slice(0, 2).repeat(32));
  }

  for (const { oracles, suite } of corpora) {
    assert.equal(validateSuite(suite), suite);
    assert.equal(validateOracleSet(oracles, suite), oracles);
    assert.equal(
      suite.cases.some((suiteCase) =>
        Object.hasOwn(suiteCase, "report_identifiers")
      ),
      false,
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
        const filePath = join(repositoryRoot, declaration.path);
        const metadata = await lstat(filePath);
        const bytes = await readFile(filePath);
        assert.equal(metadata.isFile(), true);
        assert.equal(metadata.isSymbolicLink(), false);
        assert.equal(
          (metadata.mode & 0o111) === 0 ? "100644" : "100755",
          declaration.mode,
        );
        assert.equal(sha256(bytes), declaration.sha256);
        if (declaration.path.endsWith("/public/findings.jsonl")) {
          assert.equal(bytes.length, 0);
        }
        selectedBytes += bytes.toString("utf8");
      }

      for (const seal of allSeals) {
        assert.equal(selectedBytes.includes(seal), false);
      }
      for (const otherCaseId of allCaseIds) {
        if (otherCaseId !== suiteCase.id) {
          assert.equal(selectedBytes.includes(otherCaseId), false);
        }
      }
      for (const forbidden of [
        /\badversarial\b/iu,
        /(?<!-)\bcontrol\b/iu,
        /\bexpected[_ -]?defect\b/iu,
        /\boracle\b/iu,
        /\bpair[_ -]?id\b/iu,
        /seal_[0-9a-f]{64}/u,
      ]) {
        assert.equal(forbidden.test(selectedBytes), false);
      }
      for (const secretShape of [
        /-----BEGIN [A-Z ]+ PRIVATE KEY-----/u,
        /\bapi[_-]?key\s*[:=]/iu,
        /\bpassword\s*[:=]/iu,
      ]) {
        assert.equal(secretShape.test(selectedBytes), false);
      }
    }
  }
});

test("performance pair keeps endpoints fast while one user task is sequential", async () => {
  const { adversarial, control } = pairRoles(performanceOracles);
  const adversarialRoot = fixtureRoot(adversarial.case_id);
  const controlRoot = fixtureRoot(control.case_id);
  for (const sharedPath of [
    "public/findings.jsonl",
    "public/performance-budget.md",
    "public/server.mjs",
  ]) {
    assert.equal(
      await readFile(join(adversarialRoot, sharedPath), "utf8"),
      await readFile(join(controlRoot, sharedPath), "utf8"),
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

  const adversarialWorkflow = await readFile(
    join(adversarialRoot, "public/workflow.mjs"),
    "utf8",
  );
  const controlWorkflow = await readFile(
    join(controlRoot, "public/workflow.mjs"),
    "utf8",
  );
  assert.equal(
    controlWorkflow.replace(
      'const dispatchMode = "concurrent";',
      'const dispatchMode = "sequential";',
    ),
    adversarialWorkflow,
  );
  assert.equal(
    (adversarialWorkflow.match(/const dispatchMode = "sequential";/gu) ?? [])
      .length,
    1,
  );
  assert.equal(
    (controlWorkflow.match(/const dispatchMode = "concurrent";/gu) ?? [])
      .length,
    1,
  );

  const measurements = {};
  for (const [role, oracle] of Object.entries({ adversarial, control })) {
    const module = await import(
      pathToFileURL(
        join(fixtureRoot(oracle.case_id), "public/workflow.mjs"),
      ).href
    );
    const running = await startFixture(oracle.case_id);
    try {
      const health = await fetch(`${running.origin}/health`);
      assert.equal(health.status, 200);
      assert.deepEqual(await health.json(), { status: "ready" });
      measurements[role] = await module.buildJourneyBrief(running.origin);
    } finally {
      await stopFixture(running.child);
    }
  }

  assert.deepEqual(
    measurements.adversarial.endpoint_service_times_ms,
    [100, 100, 100, 100],
  );
  assert.deepEqual(
    measurements.control.endpoint_service_times_ms,
    [100, 100, 100, 100],
  );
  assert.equal(
    measurements.adversarial.endpoint_service_times_ms.every(
      (value) => value <= 200
    ),
    true,
  );
  assert.equal(
    measurements.control.endpoint_service_times_ms.every(
      (value) => value <= 200
    ),
    true,
  );
  assert.equal(measurements.adversarial.critical_path_ms, 400);
  assert.equal(measurements.control.critical_path_ms, 100);
  assert.equal(measurements.adversarial.critical_path_ms > 250, true);
  assert.equal(measurements.control.critical_path_ms <= 250, true);
  assert.equal(
    measurements.adversarial.elapsed_ms > measurements.control.elapsed_ms,
    true,
  );
});

test("security pair passes local hygiene while one trust guide conflicts", async () => {
  const { adversarial, control } = pairRoles(securityOracles);
  const adversarialRoot = fixtureRoot(adversarial.case_id);
  const controlRoot = fixtureRoot(control.case_id);
  for (const sharedPath of [
    "public/findings.jsonl",
    "public/server.mjs",
  ]) {
    assert.equal(
      await readFile(join(adversarialRoot, sharedPath), "utf8"),
      await readFile(join(controlRoot, sharedPath), "utf8"),
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

  const adversarialGuide = await readFile(
    join(adversarialRoot, "public/deployment.md"),
    "utf8",
  );
  const controlGuide = await readFile(
    join(controlRoot, "public/deployment.md"),
    "utf8",
  );
  assert.equal(
    controlGuide.replace(
      "Accept forwarded client identity headers only from the named edge proxy.",
      "Accept forwarded client identity headers from every network peer.",
    ),
    adversarialGuide,
  );
  assert.equal(
    (adversarialGuide.match(/from every network peer\./gu) ?? []).length,
    1,
  );
  assert.equal(
    (controlGuide.match(/only from the named edge proxy\./gu) ?? []).length,
    1,
  );
  assert.match(contexts[0], /Direct internet clients .* are untrusted\./u);
  assert.equal(adversarialGuide.includes("from every network peer."), true);
  assert.equal(
    controlGuide.includes("only from the named edge proxy."),
    true,
  );

  for (const oracle of [adversarial, control]) {
    const running = await startFixture(oracle.case_id);
    try {
      const response = await fetch(`${running.origin}/`);
      assert.equal(response.status, 200);
      assert.match(await response.text(), /<title>Status Board<\/title>/u);
      assert.equal(
        response.headers.get("content-security-policy"),
        "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
      );
      assert.equal(response.headers.get("x-frame-options"), "DENY");
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
      assert.equal(
        response.headers.get("strict-transport-security"),
        "max-age=31536000; includeSubDomains",
      );
      assert.equal(response.headers.get("access-control-allow-origin"), null);
      assert.equal(
        (await fetch(`${running.origin}/debug`)).status,
        404,
      );
    } finally {
      await stopFixture(running.child);
    }
  }
});

test("both sealed pairs produce exact non-qualifying zero-positive previews", () => {
  for (const { oracles, suite } of corpora) {
    const input = {
      normalizedCases: oracles.map((oracle) =>
        normalizedCase(oracle, suite)
      ),
      oracles,
      suite,
    };
    const preview = previewSuite(input);
    const pair = preview.pairs[0];

    assert.equal(preview.completion_status, "complete");
    assert.equal(preview.preview_assertions, "met");
    assert.deepEqual(pair.detection, {
      denominator: 1,
      numerator: 1,
    });
    assert.deepEqual(pair.finding_precision, {
      denominator: 1,
      numerator: 1,
    });
    assert.equal(pair.control_positives, 0);
    assert.equal(pair.control_budget_met, true);
    assert.equal(pair.preview_assertions, "met");

    for (const output of [
      preview,
      preview.aggregate,
      pair,
      ...preview.cases,
    ]) {
      assert.equal(output.verification_status, "unverified");
      assert.equal(output.qualification, "not-evidence");
      assert.equal(output.result, null);
      assert.equal(output.confidentiality, "controller-secret");
    }
    const serialized = canonicalJson(preview);
    assert.equal(
      serialized,
      canonicalJson(previewSuite(structuredClone(input))),
    );
    for (const seal of oracleTokens(oracles)) {
      assert.equal(serialized.includes(seal), false);
    }
  }
});
