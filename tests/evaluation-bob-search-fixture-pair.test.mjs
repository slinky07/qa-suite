import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  dirname,
  join,
  resolve,
} from "node:path";
import { test } from "node:test";
import {
  fileURLToPath,
  pathToFileURL,
} from "node:url";
import {
  parseContractJson,
  validateOracleSet,
  validateSuite,
} from "../scripts/evaluation/contracts.mjs";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);
const suitePath =
  "tests/evaluation/suites/bob-evaluation-v1.json";
const oraclePath =
  "tests/evaluation/oracles/bob-evaluation-v1.json";
const expectedControlIds = [
  "control_apply_filters",
  "control_edit_filters",
  "control_project_query",
  "control_project_status",
  "control_search_help",
];

async function readContract(path, label) {
  return parseContractJson(
    await readFile(join(repositoryRoot, path), "utf8"),
    label,
  );
}

function attributeValues(source, attribute) {
  return [
    ...source.matchAll(new RegExp(`${attribute}="([^"]+)"`, "gu")),
  ].map((match) => match[1]);
}

function normalizeContext(source, ownCaseId, siblingCaseId) {
  assert.equal(source.includes(ownCaseId), true);
  assert.equal(source.includes(siblingCaseId), false);
  return source.split(ownCaseId);
}

function splitEditAction(source, label) {
  assert.equal(source.includes("\r"), false, `${label} must use LF`);
  assert.equal(source.endsWith("\n"), true, `${label} must end with LF`);

  const lines = source.slice(0, -1).split("\n");
  const openingIndexes = lines
    .map((line, index) =>
      line.trim() === '<div class="edit-filter-action">' ? index : -1,
    )
    .filter((index) => index !== -1);
  assert.equal(
    openingIndexes.length,
    1,
    `${label} must contain one Edit filters action`,
  );

  const openingIndex = openingIndexes[0];
  const opening = /^( *)<div class="edit-filter-action">$/u.exec(
    lines[openingIndex],
  );
  assert.ok(opening);
  const indent = opening[1];
  const closingIndex = lines.findIndex(
    (line, index) =>
      index > openingIndex && line === `${indent}</div>`,
  );
  assert.notEqual(closingIndex, -1, `${label} action must close`);
  assert.equal(lines[openingIndex - 1], "");
  assert.equal(lines[closingIndex + 1], "");

  const block = lines
    .slice(openingIndex, closingIndex + 1)
    .map((line) => line.slice(indent.length))
    .join("\n");
  const remainder = [
    ...lines.slice(0, openingIndex - 1),
    ...lines.slice(closingIndex + 1),
  ].join("\n") + "\n";
  return { block, remainder };
}

function editActionPlacement(source) {
  const disclosureStart = source.indexOf('<details id="search-help"');
  const disclosureEnd = source.indexOf("</details>", disclosureStart);
  const action = source.indexOf('<div class="edit-filter-action">');
  if (
    disclosureStart !== -1 &&
    action > disclosureStart &&
    action < disclosureEnd
  ) {
    return "inside-disclosure";
  }
  if (action !== -1 && action < disclosureStart) {
    return "direct";
  }
  return "unknown";
}

function fakeNode(tagName = "div") {
  const listeners = new Map();
  return {
    children: [],
    className: "",
    focused: false,
    hidden: false,
    open: false,
    tagName,
    textContent: "",
    value: "",
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    append(...nodes) {
      this.children.push(...nodes);
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
    replaceChildren(...nodes) {
      this.children.splice(0, this.children.length, ...nodes);
    },
  };
}

function projectFinderHarness() {
  const elements = {
    editFilters: fakeNode("button"),
    filterPanel: fakeNode("section"),
    form: fakeNode("form"),
    liveStatus: fakeNode("p"),
    noResults: fakeNode("div"),
    projectStatus: fakeNode("select"),
    query: fakeNode("input"),
    resultCount: fakeNode("p"),
    resultList: fakeNode("div"),
    searchHelp: fakeNode("details"),
  };
  elements.projectStatus.value = "all";
  const selectors = new Map([
    ["#filter-panel", elements.filterPanel],
    ["#filter-form", elements.form],
    ["#project-query", elements.query],
    ["#project-status", elements.projectStatus],
    ["#edit-filters", elements.editFilters],
    ["#result-count", elements.resultCount],
    ["#results-list", elements.resultList],
    ["#no-results", elements.noResults],
    ["#search-help", elements.searchHelp],
    ["#status", elements.liveStatus],
  ]);
  return {
    document: {
      createElement: (tagName) => fakeNode(tagName),
      querySelector: (selector) => selectors.get(selector) ?? null,
    },
    elements,
  };
}

function submitFilters(elements) {
  const event = elements.form.emit("submit");
  assert.equal(event.defaultPrevented, true);
  assert.equal(elements.filterPanel.hidden, true);
}

const suite = await readContract(suitePath, "Bob suite");
const oracles = await readContract(oraclePath, "Bob oracle set");

function projectFinderPair() {
  const adversarial = oracles.find(
    (oracle) =>
      oracle.role === "adversarial" &&
      oracle.assertions.expected_defects.some(
        ({ surface_id }) =>
          surface_id === "surface_filter_workspace",
      ),
  );
  assert.ok(adversarial);
  const control = oracles.find(
    (oracle) =>
      oracle.role === "control" &&
      oracle.pair_id === adversarial.pair_id,
  );
  assert.ok(control);
  const caseById = new Map(
    suite.cases.map((suiteCase) => [suiteCase.id, suiteCase]),
  );
  const adversarialCase = caseById.get(adversarial.case_id);
  const controlCase = caseById.get(control.case_id);
  assert.ok(adversarialCase);
  assert.ok(controlCase);
  return {
    adversarial,
    adversarialCase,
    cases: [adversarialCase, controlCase],
    control,
    controlCase,
  };
}

test("the Project Finder pair differs only by recovery-action placement", async () => {
  assert.equal(validateSuite(suite), suite);
  assert.equal(validateOracleSet(oracles, suite), oracles);
  const pair = projectFinderPair();
  const sourceByCase = new Map();
  const contextByCase = new Map();

  for (const suiteCase of pair.cases) {
    const root = join(
      repositoryRoot,
      "tests/evaluation/fixtures",
      suiteCase.id,
    );
    sourceByCase.set(
      suiteCase.id,
      await readFile(join(root, "public/index.html"), "utf8"),
    );
    contextByCase.set(
      suiteCase.id,
      await readFile(join(repositoryRoot, suiteCase.qa_context), "utf8"),
    );
  }

  const adversarialRoot = join(
    repositoryRoot,
    "tests/evaluation/fixtures",
    pair.adversarialCase.id,
    "public",
  );
  const controlRoot = join(
    repositoryRoot,
    "tests/evaluation/fixtures",
    pair.controlCase.id,
    "public",
  );
  for (const filename of ["app.mjs", "server.mjs", "styles.css"]) {
    assert.equal(
      await readFile(join(adversarialRoot, filename), "utf8"),
      await readFile(join(controlRoot, filename), "utf8"),
    );
  }

  const adversarialHtml = splitEditAction(
    sourceByCase.get(pair.adversarialCase.id),
    pair.adversarialCase.id,
  );
  const controlHtml = splitEditAction(
    sourceByCase.get(pair.controlCase.id),
    pair.controlCase.id,
  );
  assert.equal(adversarialHtml.block, controlHtml.block);
  assert.equal(adversarialHtml.remainder, controlHtml.remainder);
  assert.deepEqual(
    normalizeContext(
      contextByCase.get(pair.adversarialCase.id),
      pair.adversarialCase.id,
      pair.controlCase.id,
    ),
    normalizeContext(
      contextByCase.get(pair.controlCase.id),
      pair.controlCase.id,
      pair.adversarialCase.id,
    ),
  );

  for (const source of sourceByCase.values()) {
    assert.deepEqual(
      [...new Set(attributeValues(source, "data-control-id"))].sort(),
      expectedControlIds,
    );
    assert.deepEqual(
      [...new Set(attributeValues(source, "data-surface-id"))],
      ["surface_filter_workspace"],
    );
    for (const id of [
      "apply-filters",
      "edit-filters",
      "filter-form",
      "filter-panel",
      "no-results",
      "project-query",
      "project-status",
      "result-count",
      "results-heading",
      "results-list",
      "search-help",
      "status",
    ]) {
      assert.equal(
        [...source.matchAll(new RegExp(`id="${id}"`, "gu"))].length,
        1,
      );
    }
    assert.equal(source.includes('for="project-query"'), true);
    assert.equal(source.includes('for="project-status"'), true);
    assert.match(
      source,
      /<button[\s\S]+id="apply-filters"[\s\S]+type="submit"/u,
    );
    assert.match(
      source,
      /<button[\s\S]+id="edit-filters"[\s\S]+type="button"/u,
    );
    assert.equal(source.includes("<summary"), true);
    assert.equal(source.includes('role="status"'), true);
    assert.equal(source.includes('aria-live="polite"'), true);
    assert.equal(/\btabindex=/u.test(source), false);
  }

  assert.equal(
    editActionPlacement(sourceByCase.get(pair.adversarial.case_id)),
    "inside-disclosure",
  );
  assert.equal(
    editActionPlacement(sourceByCase.get(pair.control.case_id)),
    "direct",
  );
});

test("both Project Finder modules filter, recover, and restore", async () => {
  const pair = projectFinderPair();
  for (const suiteCase of pair.cases) {
    const oracle = oracles.find(
      ({ case_id }) => case_id === suiteCase.id,
    );
    assert.ok(oracle);
    const appPath = join(
      repositoryRoot,
      "tests/evaluation/fixtures",
      suiteCase.id,
      "public/app.mjs",
    );
    const app = await import(
      `${pathToFileURL(appPath).href}?case=${suiteCase.id}`
    );
    assert.deepEqual(
      app.filterProjects(
        [
          { name: "Atlas Mobile", status: "active" },
          { name: "Beacon Design System", status: "planning" },
        ],
        { query: " ATLAS ", status: "active" },
      ),
      [{ name: "Atlas Mobile", status: "active" }],
    );

    const { document, elements } = projectFinderHarness();
    app.mountProjectFinder(document);
    assert.equal(elements.resultList.children.length, 4);
    assert.equal(elements.resultCount.textContent, "4 projects");
    assert.equal(elements.noResults.hidden, true);

    elements.query.value = "Atlas";
    elements.projectStatus.value = "active";
    submitFilters(elements);
    assert.equal(elements.resultList.children.length, 1);
    assert.equal(
      elements.resultList.children[0].children[0].textContent,
      "Atlas Mobile",
    );
    assert.equal(elements.resultCount.textContent, "1 project");
    assert.equal(elements.liveStatus.textContent, "1 project shown.");
    assert.equal(elements.searchHelp.open, false);

    if (oracle.role === "adversarial") {
      elements.searchHelp.open = true;
    }
    elements.editFilters.emit("click");
    assert.equal(elements.filterPanel.hidden, false);
    assert.equal(elements.query.focused, true);
    assert.equal(
      elements.liveStatus.textContent,
      "Filters ready to edit.",
    );

    elements.query.value = "missing";
    elements.projectStatus.value = "all";
    submitFilters(elements);
    assert.equal(elements.resultList.children.length, 0);
    assert.equal(elements.resultCount.textContent, "0 projects");
    assert.equal(elements.noResults.hidden, false);
    assert.equal(elements.searchHelp.open, false);
    assert.equal(
      elements.liveStatus.textContent,
      "No projects matched the current filters.",
    );

    if (oracle.role === "adversarial") {
      elements.searchHelp.open = true;
    }
    elements.editFilters.emit("click");
    elements.query.value = "";
    submitFilters(elements);
    assert.equal(elements.resultList.children.length, 4);
    assert.equal(elements.resultCount.textContent, "4 projects");
    assert.equal(elements.noResults.hidden, true);
  }
});
