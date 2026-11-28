import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const flat = (text) => text.replace(/\s+/g, " ");

const contexts = [
  "qa-suite/assets/qa-context-template.md",
  "examples/qa-context.example.md",
  "qa-context.md",
];

function section(markdown, heading) {
  const start = markdown.indexOf(`${heading}\n`);
  assert.notEqual(start, -1, `missing ${heading}`);
  const rest = markdown.slice(start + heading.length + 1);
  const next = rest.search(/^#{2,3} /m);
  return next === -1 ? rest : rest.slice(0, next);
}

test("every qa-context surface exposes approved design reviews as an intent input", async () => {
  for (const path of contexts) {
    const intent = section(await read(path), "## Architecture & intent inputs");
    assert.match(intent, /^- \*\*Approved design reviews:\*\*\s+\S+/m, path);
  }
});

test("Bob treats approved design reviews as level-one stated intent", async () => {
  const bob = flat(await read("qa-suite/references/agents/bob-qa.md"));
  assert.match(bob, /1\. Project Architecture & intent inputs: design docs, approved design reviews,/);
  assert.match(bob, /Treat ADRs, design docs, approved design reviews,/);
  assert.match(bob, /stated-intent docs \(design docs, approved design reviews, ADRs, acceptance criteria\) are fair game/);
});

test("Bob gates, scopes, and isolates design-review oracles", async () => {
  const rules = flat(section(await read("qa-suite/references/agents/bob-qa.md"), "### Approved design reviews"));
  const required = [
    "only when its status is `Approved` or `Approved with fixes`",
    "A draft, a proposal, or a `Not approved` review is not an oracle",
    "each required fix is part of the expected result",
    "Ignore its notes about implementation source",
    "Cite the review path, its approved revision or date, and the item number",
    "only for the screens and states that it names",
    "do not choose one. Record the conflict with both citations",
    "labels as sample data is not a finding",
  ];
  for (const phrase of required) {
    assert.ok(rules.includes(phrase), `missing rule: ${phrase}`);
  }
});

test("setup prefills only approved design reviews", async () => {
  const skill = flat(await read("qa-suite/SKILL.md"));
  assert.match(skill, /Prefill a design review as an approved design review only when its status is `Approved` or `Approved with fixes`\./);
});
