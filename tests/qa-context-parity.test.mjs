import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const templateUrl = new URL(
  "../qa-suite/assets/qa-context-template.md",
  import.meta.url,
);
const exampleUrl = new URL("../examples/qa-context.example.md", import.meta.url);

function extractSectionHeadings(markdown) {
  return [...markdown.matchAll(/^##[ \t]+(.+?)[ \t]*$/gm)].map(
    ([, heading]) => heading,
  );
}

test("qa-context example section headings match the template", async () => {
  const [template, example] = await Promise.all([
    readFile(templateUrl, "utf8"),
    readFile(exampleUrl, "utf8"),
  ]);
  const templateHeadings = extractSectionHeadings(template);

  if (templateHeadings.length === 0) {
    throw new Error("qa-context template must define at least one section");
  }

  assert.deepEqual(extractSectionHeadings(example), templateHeadings);
});
