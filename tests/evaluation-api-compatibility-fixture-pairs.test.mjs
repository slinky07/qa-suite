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
const corpusDefinitions = [
  {
    lane: "api-qa",
    oraclePath: "tests/evaluation/oracles/api-evaluation-v1.json",
    suitePath: "tests/evaluation/suites/api-evaluation-v1.json",
  },
  {
    lane: "compatibility-qa",
    oraclePath:
      "tests/evaluation/oracles/compatibility-evaluation-v1.json",
    suitePath:
      "tests/evaluation/suites/compatibility-evaluation-v1.json",
  },
];
const corpora = await Promise.all(
  corpusDefinitions.map(async (definition) => ({
    ...definition,
    oracles: await readContract(
      definition.oraclePath,
      `${definition.lane} oracle set`,
    ),
    suite: await readContract(
      definition.suitePath,
      `${definition.lane} suite`,
    ),
  })),
);
const corpusByLane = new Map(
  corpora.map((corpus) => [corpus.lane, corpus]),
);

async function readContract(path, label) {
  return parseContractJson(
    await readFile(join(repositoryRoot, path), "utf8"),
    label,
  );
}

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

function pairedOracles(corpus) {
  const adversarial = corpus.oracles.find(
    ({ role }) => role === "adversarial",
  );
  const control = corpus.oracles.find(({ role }) => role === "control");
  assert.ok(adversarial);
  assert.ok(control);
  assert.equal(adversarial.pair_id, control.pair_id);
  return { adversarial, control };
}

function normalizeContext(source, ownCaseId, siblingCaseId) {
  assert.equal(source.includes(ownCaseId), true);
  assert.equal(source.includes(siblingCaseId), false);
  return source.replaceAll(ownCaseId, "fx_selected");
}

function sealedTokens(oracles) {
  return new Set(
    oracles.flatMap((oracle) => [
      oracle.pair_id,
      oracle.canary_token,
      oracle.role === "adversarial"
        ? oracle.assertions.expected_defects[0].id
        : oracle.assertions.control_budget.id,
    ]),
  );
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
      if (!Number.isInteger(port) || port < 1 || port > 65_535) {
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

function smokeGate(checkId) {
  return {
    blocking_evidence: [],
    checklist: [
      {
        evidence: [],
        id: checkId,
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

const laneExpectations = {
  "api-qa": {
    criterion: "API-01",
    evidence: {
      kind: "request-response",
      path: "QA/evidence/delivery-retry.json",
    },
    findingId: "API-01-FINDING",
    flowId: "flow_delivery_retry",
    priority: "P1",
    severity: "S2",
    surfaceId: "surface_delivery_api",
  },
  "compatibility-qa": {
    criterion: "COMPAT-01",
    evidence: {
      kind: "screenshot",
      path: "QA/evidence/message-composer-375.png",
    },
    findingId: "COMPAT-01-FINDING",
    flowId: "flow_message_send",
    priority: "P0",
    severity: "S1",
    surfaceId: "surface_message_composer",
  },
};

function laneResult(lane, role) {
  const expected = laneExpectations[lane];
  const failed = role === "adversarial";
  const findings = failed
    ? [
        {
          classification: "governed",
          criteria: [expected.criterion],
          evidence: [expected.evidence],
          id: expected.findingId,
          priority: expected.priority,
          severity: expected.severity,
          surface_id: expected.surfaceId,
        },
      ]
    : [];
  const severityCounts = { S1: 0, S2: 0, S3: 0, S4: 0 };
  if (failed) severityCounts[expected.severity] = 1;
  return {
    blocking_evidence: [],
    checklist: [],
    findings,
    flows: [
      {
        core: true,
        effectiveness: !failed,
        evidence: [expected.evidence],
        finding_ids: failed ? [expected.findingId] : [],
        id: expected.flowId,
        state: failed ? "Fail" : "Pass",
      },
    ],
    not_tested: [],
    observations: [],
    verdict: {
      blocker: null,
      severity_counts: severityCounts,
      state: failed ? "No-Go" : "Go",
    },
  };
}

function normalizedCase(corpus, oracle) {
  const suiteCase = corpus.suite.cases.find(
    ({ id }) => id === oracle.case_id,
  );
  assert.ok(suiteCase);
  return {
    case_id: oracle.case_id,
    completion_status: "completed",
    lane: corpus.lane,
    lane_result: laneResult(corpus.lane, oracle.role),
    schema_version: 1,
    smoke_gate: smokeGate(suiteCase.smoke_checks[0]),
    subject_commit: "0123456789abcdef0123456789abcdef01234567",
  };
}

test("API and compatibility declarations seal exact role-neutral fixture bytes", async () => {
  for (const corpus of corpora) {
    assert.equal(validateSuite(corpus.suite), corpus.suite);
    assert.equal(
      validateOracleSet(corpus.oracles, corpus.suite),
      corpus.oracles,
    );
    assert.equal(
      corpus.suite.cases.some((suiteCase) =>
        Object.hasOwn(suiteCase, "report_identifiers")
      ),
      false,
    );

    const suiteSource = await readFile(
      join(repositoryRoot, corpus.suitePath),
      "utf8",
    );
    assert.doesNotMatch(suiteSource, /"role"\s*:/u);
    assert.doesNotMatch(suiteSource, /"pair_id"\s*:/u);
    assert.equal(suiteSource.includes(corpus.oraclePath), false);

    const seals = sealedTokens(corpus.oracles);
    for (const suiteCase of corpus.suite.cases) {
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
        if (declaration.path.endsWith("/public/findings.jsonl")) {
          assert.equal(bytes.byteLength, 0);
        }
        selectedBytes += bytes.toString("utf8");
      }

      for (const seal of seals) {
        assert.equal(selectedBytes.includes(seal), false);
      }
      for (const sibling of corpus.suite.cases) {
        if (sibling.id !== suiteCase.id) {
          assert.equal(selectedBytes.includes(sibling.id), false);
        }
      }
      for (const forbidden of [
        /\badversarial\b/iu,
        /(?<!-)\bcontrol\b/iu,
        /\bexpected[_ -]?defect\b/iu,
        /\bpair[_ -]?id\b/iu,
        /\boracle\b/iu,
        /seal_[0-9a-f]{64}/u,
      ]) {
        assert.equal(forbidden.test(selectedBytes), false);
      }
    }
  }
});

test("API retry keeps valid status and schema while one mutation outcome diverges", async () => {
  const corpus = corpusByLane.get("api-qa");
  assert.ok(corpus);
  const pair = pairedOracles(corpus);
  const roots = {
    adversarial: fixtureRoot(pair.adversarial.case_id),
    control: fixtureRoot(pair.control.case_id),
  };

  for (const path of [
    "public/api-contract.json",
    "public/findings.jsonl",
  ]) {
    assert.equal(
      await readFile(join(roots.adversarial, path), "utf8"),
      await readFile(join(roots.control, path), "utf8"),
    );
  }
  const contexts = await Promise.all(
    [pair.adversarial, pair.control].map(async (oracle) =>
      normalizeContext(
        await readFile(
          join(fixtureRoot(oracle.case_id), "qa-context.md"),
          "utf8",
        ),
        oracle.case_id,
        oracle.role === "adversarial"
          ? pair.control.case_id
          : pair.adversarial.case_id,
      )
    ),
  );
  assert.equal(contexts[0], contexts[1]);

  const adversarialServer = await readFile(
    join(roots.adversarial, "public/server.mjs"),
    "utf8",
  );
  const controlServer = await readFile(
    join(roots.control, "public/server.mjs"),
    "utf8",
  );
  assert.equal(
    controlServer.replace(
      "const reuseDeliveryOnRetry = true;",
      "const reuseDeliveryOnRetry = false;",
    ),
    adversarialServer,
  );
  assert.equal(
    (controlServer.match(/const reuseDeliveryOnRetry = true;/gu) ?? [])
      .length,
    1,
  );
  assert.equal(
    (adversarialServer.match(/const reuseDeliveryOnRetry = false;/gu) ?? [])
      .length,
    1,
  );

  const contract = await readContract(
    repositoryPath(
      join(roots.adversarial, "public/api-contract.json"),
    ),
    "Delivery Queue API contract",
  );
  assert.equal(contract.create_delivery.requirement_id, "API-01");
  assert.equal(
    contract.create_delivery.retry_outcome,
    "An identical retry returns the original delivery ID and leaves exactly one queued delivery.",
  );

  const results = {};
  for (const [role, oracle] of Object.entries(pair)) {
    const running = await startFixture(oracle.case_id);
    try {
      const request = {
        body: JSON.stringify({ recipient: "fixture@example.invalid" }),
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "retry-01",
        },
        method: "POST",
      };
      const firstResponse = await fetch(
        `${running.url}/api/deliveries`,
        request,
      );
      const first = await firstResponse.json();
      const retryResponse = await fetch(
        `${running.url}/api/deliveries`,
        request,
      );
      const retry = await retryResponse.json();
      const listResponse = await fetch(
        `${running.url}/api/deliveries`,
      );
      const list = await listResponse.json();

      assert.equal(
        firstResponse.status,
        contract.create_delivery.first_status,
      );
      assert.equal(
        retryResponse.status,
        contract.create_delivery.retry_status,
      );
      assert.equal(listResponse.status, contract.list_deliveries.status);
      for (const envelope of [first, retry]) {
        assert.deepEqual(Object.keys(envelope), ["delivery"]);
        assert.deepEqual(
          Object.keys(envelope.delivery).sort(),
          ["id", "recipient", "state"],
        );
        assert.equal(typeof envelope.delivery.id, "string");
        assert.equal(
          envelope.delivery.recipient,
          "fixture@example.invalid",
        );
        assert.equal(envelope.delivery.state, "queued");
      }
      assert.deepEqual(Object.keys(list), ["deliveries"]);
      assert.equal(Array.isArray(list.deliveries), true);
      for (const delivery of list.deliveries) {
        assert.deepEqual(
          Object.keys(delivery).sort(),
          ["id", "recipient", "state"],
        );
      }
      results[role] = { first, list, retry };
    } finally {
      await stopFixture(running.child);
    }
  }

  assert.notEqual(
    results.adversarial.first.delivery.id,
    results.adversarial.retry.delivery.id,
  );
  assert.equal(results.adversarial.list.deliveries.length, 2);
  assert.equal(
    results.control.first.delivery.id,
    results.control.retry.delivery.id,
  );
  assert.equal(results.control.list.deliveries.length, 1);
});

function messageComposerHarness(compact) {
  let submit;
  const form = {
    addEventListener(name, listener) {
      assert.equal(name, "submit");
      submit = listener;
    },
  };
  const action = { disabled: false };
  const status = { textContent: "Draft ready." };
  const elements = new Map([
    ["#message-form", form],
    ["#send-message", action],
    ["#message-status", status],
  ]);
  return {
    action,
    documentObject: {
      querySelector: (selector) => elements.get(selector) ?? null,
    },
    status,
    submit() {
      let prevented = false;
      submit({
        preventDefault() {
          prevented = true;
        },
      });
      assert.equal(prevented, true);
    },
    windowObject: {
      matchMedia(query) {
        assert.equal(query, "(max-width: 480px)");
        return { matches: compact };
      },
    },
  };
}

function exerciseComposer(module, compact) {
  const harness = messageComposerHarness(compact);
  module.mountMessageComposer(
    harness.documentObject,
    harness.windowObject,
  );
  harness.submit();
  return harness;
}

test("both pages render while only one declared target loses its primary action", async () => {
  const corpus = corpusByLane.get("compatibility-qa");
  assert.ok(corpus);
  const pair = pairedOracles(corpus);
  const roots = {
    adversarial: fixtureRoot(pair.adversarial.case_id),
    control: fixtureRoot(pair.control.case_id),
  };

  for (const path of [
    "public/findings.jsonl",
    "public/index.html",
    "public/server.mjs",
    "public/styles.css",
    "public/support-matrix.json",
  ]) {
    assert.equal(
      await readFile(join(roots.adversarial, path), "utf8"),
      await readFile(join(roots.control, path), "utf8"),
    );
  }
  const contexts = await Promise.all(
    [pair.adversarial, pair.control].map(async (oracle) =>
      normalizeContext(
        await readFile(
          join(fixtureRoot(oracle.case_id), "qa-context.md"),
          "utf8",
        ),
        oracle.case_id,
        oracle.role === "adversarial"
          ? pair.control.case_id
          : pair.adversarial.case_id,
      )
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
      "const compactTargetCompletes = true;",
      "const compactTargetCompletes = false;",
    ),
    adversarialApp,
  );
  assert.equal(
    (controlApp.match(/const compactTargetCompletes = true;/gu) ?? [])
      .length,
    1,
  );
  assert.equal(
    (adversarialApp.match(/const compactTargetCompletes = false;/gu) ?? [])
      .length,
    1,
  );

  const matrix = await readContract(
    repositoryPath(
      join(roots.adversarial, "public/support-matrix.json"),
    ),
    "Message Composer support matrix",
  );
  assert.equal(matrix.requirement.id, "COMPAT-01");
  assert.deepEqual(
    matrix.targets.map(({ id }) => id),
    ["chromium-1024", "chromium-375"],
  );

  const modules = {};
  for (const [role, oracle] of Object.entries(pair)) {
    const running = await startFixture(oracle.case_id);
    try {
      const response = await fetch(`${running.url}/`);
      assert.equal(response.status, 200);
      assert.match(
        await response.text(),
        /<title>Message Composer<\/title>/u,
      );
    } finally {
      await stopFixture(running.child);
    }
    modules[role] = await import(
      `${pathToFileURL(
        join(fixtureRoot(oracle.case_id), "public/app.mjs"),
      ).href}?case=${oracle.case_id}`
    );
  }

  const adversarialWide = exerciseComposer(modules.adversarial, false);
  assert.equal(adversarialWide.status.textContent, "Message sent.");
  assert.equal(adversarialWide.action.disabled, false);
  const adversarialCompact = exerciseComposer(modules.adversarial, true);
  assert.equal(adversarialCompact.status.textContent, "Sending…");
  assert.equal(adversarialCompact.action.disabled, true);

  for (const compact of [false, true]) {
    const completed = exerciseComposer(modules.control, compact);
    assert.equal(completed.status.textContent, "Message sent.");
    assert.equal(completed.action.disabled, false);
  }
});

test("both sealed pairs produce deterministic zero-positive non-qualifying previews", () => {
  for (const corpus of corpora) {
    const input = {
      normalizedCases: corpus.oracles.map((oracle) =>
        normalizedCase(corpus, oracle)
      ),
      oracles: corpus.oracles,
      suite: corpus.suite,
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
    assert.deepEqual(preview.aggregate.detection, {
      denominator: 1,
      numerator: 1,
    });
    assert.deepEqual(preview.aggregate.finding_precision, {
      denominator: 1,
      numerator: 1,
    });
    assert.equal(preview.aggregate.control_positives, 0);

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

    const serialized = canonicalJson(preview);
    assert.equal(
      serialized,
      canonicalJson(previewSuite(structuredClone(input))),
    );
    for (const seal of sealedTokens(corpus.oracles)) {
      assert.equal(serialized.includes(seal), false);
    }
  }
});
