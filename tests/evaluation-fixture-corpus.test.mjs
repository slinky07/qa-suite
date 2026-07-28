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
  fixtureManifestDeclarationDigest,
  parseContractJson,
  sha256,
  validateFixtureManifest,
  validateOracleSet,
  validateSuite,
} from "../scripts/evaluation/contracts.mjs";
import { validateProject } from "../qa-suite/scripts/finding-ledger.mjs";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);
const suitePath =
  "tests/evaluation/suites/bob-evaluation-v1.json";
const oraclePath =
  "tests/evaluation/oracles/bob-evaluation-v1.json";
const expectedControlIds = [
  "control_add_note",
  "control_compact_cards",
  "control_note_text",
  "control_note_title",
  "control_show_timestamps",
];
const informationArchitectureCriteria = [
  "IA-01",
  "IA-02",
  "IA-03",
  "IA-04",
  "IA-05",
  "IA-06",
  "IA-07",
  "H8",
];

async function regularFileMetadata(path, label) {
  const metadata = await lstat(path);
  assert.equal(metadata.isFile(), true, `${label} must be a regular file`);
  assert.equal(
    metadata.isSymbolicLink(),
    false,
    `${label} must not be a symlink`,
  );
  return metadata;
}

async function readRegularFile(path, label, encoding) {
  await regularFileMetadata(path, label);
  return readFile(path, encoding);
}

async function readContract(path, label) {
  return parseContractJson(
    await readRegularFile(join(repositoryRoot, path), label, "utf8"),
    label,
  );
}

async function collectRegularFiles(directory) {
  const metadata = await lstat(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`fixture contains unsupported directory ${directory}`);
  }
  const files = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectRegularFiles(path));
    } else if (entry.isFile()) {
      files.push(path);
    } else {
      throw new Error(`fixture contains unsupported entry ${path}`);
    }
  }
  return files;
}

function repositoryPath(path) {
  return relative(repositoryRoot, path).split(sep).join("/");
}

function declaredMode(metadata) {
  return (metadata.mode & 0o111) === 0 ? "100644" : "100755";
}

function attributeValues(source, attribute) {
  return [
    ...source.matchAll(new RegExp(`${attribute}="([^"]+)"`, "gu")),
  ].map((match) => match[1]);
}

function layoutKind(source) {
  const formStart = source.indexOf('<form id="note-form">');
  const formEnd = source.indexOf("</form>", formStart);
  const preferences = source.indexOf(
    "<legend>Display preferences</legend>",
  );
  const primaryAction = source.indexOf('id="add-note"');
  if (
    formStart < preferences &&
    preferences < primaryAction &&
    primaryAction < formEnd
  ) {
    return "interleaved";
  }
  if (
    formStart < primaryAction &&
    primaryAction < formEnd &&
    formEnd < preferences
  ) {
    return "separated";
  }
  return "unknown";
}

function splitDisplayPreferences(source, label) {
  assert.equal(source.includes("\r"), false, `${label} must use LF`);
  assert.equal(source.endsWith("\n"), true, `${label} must end with LF`);

  const lines = source.slice(0, -1).split("\n");
  const legend = "<legend>Display preferences</legend>";
  const legendIndexes = lines
    .map((line, index) => line.trim() === legend ? index : -1)
    .filter((index) => index !== -1);
  assert.equal(
    legendIndexes.length,
    1,
    `${label} must contain one Display preferences group`,
  );

  const legendIndex = legendIndexes[0];
  const openingIndex = legendIndex - 1;
  const opening = /^( *)<fieldset class="panel">$/u.exec(
    lines[openingIndex] ?? "",
  );
  assert.ok(opening, `${label} preferences must use the panel fieldset`);
  const indent = opening[1];
  assert.equal(lines[legendIndex], `${indent}  ${legend}`);

  const closingIndexes = lines
    .map((line, index) =>
      index > legendIndex && line === `${indent}</fieldset>` ? index : -1,
    )
    .filter((index) => index !== -1);
  assert.equal(
    closingIndexes.length,
    1,
    `${label} must contain one preferences fieldset close`,
  );
  const closingIndex = closingIndexes[0];
  assert.equal(lines[openingIndex - 1], "");
  assert.notEqual(lines[openingIndex - 2], "");
  assert.equal(lines[closingIndex + 1], "");
  assert.notEqual(lines[closingIndex + 2], "");

  const block = lines
    .slice(openingIndex, closingIndex + 1)
    .map((line) => {
      assert.ok(
        line === "" || line.startsWith(indent),
        `${label} preferences indentation is inconsistent`,
      );
      return line === "" ? line : line.slice(indent.length);
    })
    .join("\n");
  const remainder = [
    ...lines.slice(0, openingIndex - 1),
    ...lines.slice(closingIndex + 1),
  ].join("\n") + "\n";
  return { block, remainder };
}

function normalizeContext(source, ownCaseId, siblingCaseId) {
  assert.equal(source.includes(ownCaseId), true);
  assert.equal(source.includes(siblingCaseId), false);
  return source.split(ownCaseId);
}

function fakeNode(tagName = "div") {
  const children = [];
  const classes = new Set();
  const listeners = new Map();
  return {
    checked: false,
    children,
    classList: {
      contains: (name) => classes.has(name),
      toggle(name, force) {
        const enabled = force ?? !classes.has(name);
        if (enabled) classes.add(name);
        else classes.delete(name);
        return enabled;
      },
    },
    className: "",
    focused: false,
    hidden: false,
    tagName,
    textContent: "",
    value: "",
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    append(...nodes) {
      children.push(...nodes);
    },
    emit(type) {
      const event = {
        defaultPrevented: false,
        preventDefault() {
          this.defaultPrevented = true;
        },
      };
      listeners.get(type)?.(event);
      return event;
    },
    focus() {
      this.focused = true;
    },
    prepend(node) {
      children.unshift(node);
    },
    querySelectorAll(selector) {
      return children.flatMap((child) => [
        ...(child.tagName === selector ? [child] : []),
        ...child.querySelectorAll(selector),
      ]);
    },
  };
}

function pocketNotesHarness() {
  const elements = {
    compact: fakeNode("input"),
    empty: fakeNode("p"),
    form: fakeNode("form"),
    list: fakeNode("div"),
    note: fakeNode("textarea"),
    status: fakeNode("p"),
    timestamps: fakeNode("input"),
    title: fakeNode("input"),
  };
  const selectors = new Map([
    ["#note-form", elements.form],
    ["#note-title", elements.title],
    ["#note-text", elements.note],
    ["#compact-cards", elements.compact],
    ["#show-timestamps", elements.timestamps],
    ["#notes-list", elements.list],
    ["#empty-state", elements.empty],
    ["#status", elements.status],
  ]);
  return {
    document: {
      createElement: (tagName) => fakeNode(tagName),
      querySelector: (selector) => selectors.get(selector) ?? null,
    },
    elements,
  };
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
      rejectPort(
        new Error(`fixture server exited ${code}: ${stderr}`),
      );
    });
  });
}

async function startFixture(caseId) {
  const serverPath = join(
    repositoryRoot,
    "tests/evaluation/fixtures",
    caseId,
    "public/server.mjs",
  );
  for (const path of await collectRegularFiles(dirname(serverPath))) {
    await regularFileMetadata(path, repositoryPath(path));
  }
  const child = spawn(process.execPath, [serverPath, "0"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let port;
  try {
    port = await waitForPort(child);
  } catch (error) {
    if (child.exitCode === null) child.kill("SIGTERM");
    throw error;
  }
  return {
    child,
    url: `http://127.0.0.1:${port}`,
  };
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

const suite = await readContract(suitePath, "Bob suite");
const oracles = await readContract(oraclePath, "Bob oracle set");

test("committed Bob fixture declarations match every selected byte", async () => {
  assert.equal(validateSuite(suite), suite);
  assert.equal(validateOracleSet(oracles, suite), oracles);
  const controlOracle = oracles.find(({ role }) => role === "control");
  assert.deepEqual(
    controlOracle.assertions.control_budget.criteria_any_of,
    informationArchitectureCriteria,
  );

  const sealTokens = new Set();
  for (const oracle of oracles) {
    sealTokens.add(oracle.pair_id);
    sealTokens.add(oracle.canary_token);
    sealTokens.add(
      oracle.role === "adversarial"
        ? oracle.assertions.expected_defects[0].id
        : oracle.assertions.control_budget.id,
    );
  }

  for (const suiteCase of suite.cases) {
    const manifest = await readContract(
      suiteCase.fixture_manifest,
      `${suiteCase.id} manifest`,
    );
    assert.equal(
      validateFixtureManifest(manifest, suiteCase),
      manifest,
    );

    const publicRoot = join(
      repositoryRoot,
      "tests/evaluation/fixtures",
      suiteCase.id,
      "public",
    );
    const actualPaths = [
      ...await collectRegularFiles(publicRoot),
      join(repositoryRoot, suiteCase.qa_context),
    ].map(repositoryPath).sort();
    assert.deepEqual(
      manifest.files.map(({ path }) => path),
      actualPaths,
    );

    let selectedBytes = "";
    for (const declaration of manifest.files) {
      const absolutePath = join(repositoryRoot, declaration.path);
      const metadata = await regularFileMetadata(
        absolutePath,
        declaration.path,
      );
      const bytes = await readFile(absolutePath);
      assert.equal(declaredMode(metadata), declaration.mode);
      assert.equal(sha256(bytes), declaration.sha256);
      selectedBytes += bytes.toString("utf8");
    }

    const project = await validateProject({
      context: suiteCase.qa_context,
      repository: repositoryRoot,
    });
    assert.deepEqual(project.rows, []);
    assert.equal(
      project.ledgerGitPath,
      `tests/evaluation/fixtures/${suiteCase.id}/public/findings.jsonl`,
    );

    for (const token of sealTokens) {
      assert.equal(selectedBytes.includes(token), false);
    }
    for (const otherCase of suite.cases) {
      if (otherCase.id !== suiteCase.id) {
        assert.equal(selectedBytes.includes(otherCase.id), false);
      }
    }
    for (const forbidden of [
      /\badversarial\b/iu,
      /\bcanary[_ -]?token\b/iu,
      /\bclean fixture\b/iu,
      /\bcluttered\b/iu,
      /\bcontrol[_ -]?budget\b/iu,
      /\bexpected[_ -]?defect\b/iu,
      /\bpair[_ -]?id\b/iu,
    ]) {
      assert.equal(forbidden.test(selectedBytes), false);
    }

    const declarationDigest = fixtureManifestDeclarationDigest(
      manifest,
      suiteCase,
    );
    assert.equal(
      declarationDigest.verification_status,
      "unverified",
    );
    assert.equal(declarationDigest.qualification, "not-evidence");
  }
});

test("the pair has equal capabilities and one sealed layout variable", async () => {
  const sourceByCase = new Map();
  const contextByCase = new Map();
  for (const suiteCase of suite.cases) {
    const root = join(
      repositoryRoot,
      "tests/evaluation/fixtures",
      suiteCase.id,
      "public",
    );
    sourceByCase.set(
      suiteCase.id,
      await readRegularFile(
        join(root, "index.html"),
        `${suiteCase.id} index`,
        "utf8",
      ),
    );
    contextByCase.set(
      suiteCase.id,
      await readRegularFile(
        join(repositoryRoot, suiteCase.qa_context),
        `${suiteCase.id} context`,
        "utf8",
      ),
    );
  }

  const [firstCase, secondCase] = suite.cases;
  const firstRoot = join(
    repositoryRoot,
    "tests/evaluation/fixtures",
    firstCase.id,
    "public",
  );
  const secondRoot = join(
    repositoryRoot,
    "tests/evaluation/fixtures",
    secondCase.id,
    "public",
  );
  for (const filename of ["app.mjs", "server.mjs", "styles.css"]) {
    assert.equal(
      await readRegularFile(
        join(firstRoot, filename),
        `${firstCase.id} ${filename}`,
        "utf8",
      ),
      await readRegularFile(
        join(secondRoot, filename),
        `${secondCase.id} ${filename}`,
        "utf8",
      ),
    );
  }

  const firstHtml = splitDisplayPreferences(
    sourceByCase.get(firstCase.id),
    firstCase.id,
  );
  const secondHtml = splitDisplayPreferences(
    sourceByCase.get(secondCase.id),
    secondCase.id,
  );
  assert.equal(firstHtml.block, secondHtml.block);
  assert.equal(firstHtml.remainder, secondHtml.remainder);
  assert.deepEqual(
    normalizeContext(
      contextByCase.get(firstCase.id),
      firstCase.id,
      secondCase.id,
    ),
    normalizeContext(
      contextByCase.get(secondCase.id),
      secondCase.id,
      firstCase.id,
    ),
  );

  for (const source of sourceByCase.values()) {
    assert.deepEqual(
      [...new Set(attributeValues(source, "data-control-id"))].sort(),
      expectedControlIds,
    );
    assert.deepEqual(
      [...new Set(attributeValues(source, "data-surface-id"))],
      ["surface_note_board"],
    );
    for (const id of [
      "add-note",
      "compact-cards",
      "empty-state",
      "note-form",
      "notes-list",
      "note-title",
      "note-text",
      "show-timestamps",
      "status",
    ]) {
      assert.equal(
        [...source.matchAll(new RegExp(`id="${id}"`, "gu"))].length,
        1,
      );
    }
    for (const id of [
      "note-title",
      "note-text",
      "compact-cards",
      "show-timestamps",
    ]) {
      assert.equal(source.includes(`for="${id}"`), true);
    }
    assert.match(
      source,
      /<button[\s\S]+id="add-note"[\s\S]+type="submit"/u,
    );
    assert.equal(/\btabindex=/u.test(source), false);
    assert.equal(source.includes('role="status"'), true);
  }

  const oracleByRole = new Map(
    oracles.map((oracle) => [oracle.role, oracle]),
  );
  assert.equal(
    layoutKind(sourceByCase.get(oracleByRole.get("adversarial").case_id)),
    "interleaved",
  );
  assert.equal(
    layoutKind(sourceByCase.get(oracleByRole.get("control").case_id)),
    "separated",
  );
});

test("both fixture modules execute the declared user flows", async () => {
  for (const suiteCase of suite.cases) {
    const appPath = join(
      repositoryRoot,
      "tests/evaluation/fixtures",
      suiteCase.id,
      "public/app.mjs",
    );
    await regularFileMetadata(appPath, `${suiteCase.id} app`);
    const app = await import(
      `${pathToFileURL(appPath).href}?flow=${suiteCase.id}`
    );
    const harness = pocketNotesHarness();
    const { elements } = harness;
    app.mountPocketNotes(harness.document);

    elements.title.value = "Release";
    elements.note.value = "Review the release checklist.";
    const submit = elements.form.emit("submit");
    assert.equal(submit.defaultPrevented, true);
    assert.equal(elements.list.children.length, 1);
    const [card] = elements.list.children;
    assert.equal(card.tagName, "article");
    assert.equal(card.children[0].textContent, "Release");
    assert.equal(
      card.children[1].textContent,
      "Review the release checklist.",
    );
    const timestamp = card.children[2];
    assert.equal(timestamp.tagName, "time");
    assert.equal(timestamp.hidden, true);
    assert.equal(timestamp.textContent.length > 0, true);
    assert.equal(elements.empty.hidden, true);
    assert.equal(elements.status.textContent, "Added note “Release”.");
    assert.equal(elements.title.value, "");
    assert.equal(elements.note.value, "");
    assert.equal(elements.title.focused, true);

    elements.timestamps.checked = true;
    elements.timestamps.emit("change");
    assert.equal(timestamp.hidden, false);
    assert.equal(
      elements.status.textContent,
      "Display preferences updated.",
    );

    elements.compact.checked = true;
    elements.compact.emit("change");
    assert.equal(elements.list.classList.contains("compact-cards"), true);

    elements.timestamps.checked = false;
    elements.timestamps.emit("change");
    elements.compact.checked = false;
    elements.compact.emit("change");
    assert.equal(timestamp.hidden, true);
    assert.equal(elements.list.classList.contains("compact-cards"), false);
  }
});

test("both standalone fixtures serve and implement the same core behavior", async () => {
  const fixedTime = new Date("2026-07-27T12:00:00.000Z");
  const expectedNote = {
    created_at: fixedTime.toISOString(),
    note: "Review the release checklist.",
    title: "Release",
  };

  for (const suiteCase of suite.cases) {
    const publicRoot = join(
      repositoryRoot,
      "tests/evaluation/fixtures",
      suiteCase.id,
      "public",
    );
    const appPath = join(publicRoot, "app.mjs");
    await regularFileMetadata(appPath, `${suiteCase.id} app`);
    const app = await import(
      `${pathToFileURL(appPath).href}?case=${suiteCase.id}`
    );
    assert.deepEqual(
      app.createNote(
        {
          note: " Review the release checklist. ",
          title: " Release ",
        },
        fixedTime,
      ),
      expectedNote,
    );
    assert.deepEqual(
      app.normalizeDisplayPreferences({
        compactCards: 1,
        showTimestamps: 0,
      }),
      {
        compact_cards: true,
        show_timestamps: false,
      },
    );
    assert.throws(
      () => app.createNote({ note: "", title: "" }, fixedTime),
      /title and note are required/u,
    );

    const running = await startFixture(suiteCase.id);
    try {
      const response = await fetch(`${running.url}/`);
      assert.equal(response.status, 200);
      assert.equal(
        response.headers.get("x-content-type-options"),
        "nosniff",
      );
      assert.match(
        response.headers.get("content-security-policy") ?? "",
        /connect-src 'none'/u,
      );
      assert.equal(
        await response.text(),
        await readRegularFile(
          join(publicRoot, "index.html"),
          `${suiteCase.id} index`,
          "utf8",
        ),
      );

      const script = await fetch(`${running.url}/app.mjs`);
      assert.equal(script.status, 200);
      assert.equal(
        await script.text(),
        await readRegularFile(
          appPath,
          `${suiteCase.id} app`,
          "utf8",
        ),
      );

      const missing = await fetch(`${running.url}/missing`);
      assert.equal(missing.status, 404);
    } finally {
      await stopFixture(running.child);
    }
  }
});
