import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  assertExpectedReleaseState,
  selectReleaseByTag,
} from "../scripts/release/lib.mjs";

async function text(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

async function json(path) {
  return JSON.parse(await text(path));
}

test("VERSION is the single release version authority", async () => {
  const version = (await text("VERSION")).trim();
  assert.match(version, /^\d+\.\d+\.\d+$/);

  const codexPlugin = await json(".codex-plugin/plugin.json");
  const claudePlugin = await json(".claude-plugin/plugin.json");
  const claudeMarketplace = await json(".claude-plugin/marketplace.json");
  const readme = await text("README.md");

  assert.equal(codexPlugin.version, version);
  assert.equal(claudePlugin.version, version);
  assert.equal(claudeMarketplace.plugins[0].version, version);
  assert.match(
    readme,
    new RegExp(`Repository package version: \`v${version.replaceAll(".", "\\.")}\`\\.`),
  );
});

test("release scripts are valid JavaScript", () => {
  for (const path of [
    "scripts/release/lib.mjs",
    "scripts/release/check.mjs",
    "scripts/release/lookup-release.mjs",
    "scripts/release/verify-remote.mjs",
  ]) {
    execFileSync(process.execPath, ["--check", path], { stdio: "pipe" });
  }
});

test("packaging reads the exact Git tree and mirrors both asset names", async () => {
  const library = await text("scripts/release/lib.mjs");

  assert.match(library, /git", \[\s*"archive"/);
  assert.match(library, /commit,\s*"qa-suite"/);
  assert.match(library, /--format=zip",\s*"-0"/);
  assert.match(library, /env: \{ TZ: "UTC" \}/);
  assert.match(
    library,
    /export const ASSET_NAMES = \["qa-suite\.skill", "qa-suite-source\.zip"\]/,
  );
  assert.match(library, /copyFile\(skillPath, sourcePath/);
  assert.doesNotMatch(library, /--clobber/);
});

test("every supported distribution channel has a checked contract", async () => {
  const library = await text("scripts/release/lib.mjs");
  const agents = await text("AGENTS.md");

  for (const channel of [
    "claude_ai",
    "source_archive",
    "local_skill",
    "claude_code",
    "codex",
  ]) {
    assert.match(library, new RegExp(`${channel}:`));
  }

  assert.match(library, /Claude Code agent tree/);
  assert.match(library, /Claude Code command tree/);
  assert.match(library, /\.agents\/plugins\/marketplace\.json/);
  assert.match(agents, /\| Claude\.ai \|/);
  assert.match(agents, /\| Claude Code \|/);
  assert.match(agents, /\| Codex \|/);
});

test("workflows pin actions and separate validation from release authority", async () => {
  const integrity = await text(".github/workflows/release-integrity.yml");
  const draftRelease = await text(".github/workflows/draft-release.yml");
  const publishRelease = await text(".github/workflows/publish-release.yml");
  const workflows = `${integrity}\n${draftRelease}\n${publishRelease}`;
  const uses = [...workflows.matchAll(/uses:\s+\S+@(\S+)/g)];

  assert.ok(uses.length >= 10);
  for (const use of uses) {
    assert.match(use[1], /^[0-9a-f]{40}$/);
  }

  assert.match(integrity, /permissions:\s*\n\s+contents: read/);
  assert.match(integrity, /node scripts\/release\/check\.mjs/);
  assert.match(draftRelease, /attestations: write/);
  assert.match(draftRelease, /contents: write/);
  assert.match(draftRelease, /id-token: write/);
  assert.match(draftRelease, /--draft/);
  assert.match(draftRelease, /--verify-tag/);
  assert.match(draftRelease, /--fail-on-no-commits/);
  assert.match(draftRelease, /gh release upload/);
  assert.match(draftRelease, /lookup-release\.mjs/);
  assert.match(draftRelease, /verify-remote\.mjs/);
  assert.match(draftRelease, /persist-credentials: false/);
  assert.doesNotMatch(draftRelease, /workflow_dispatch/);
  assert.match(draftRelease, /queue: max/);
  assert.doesNotMatch(publishRelease, /immutable-releases/);
  assert.match(publishRelease, /git\/ref\/tags\/\$\{RELEASE_TAG\}/);
  assert.match(publishRelease, /expected-state draft-or-immutable/);
  assert.match(publishRelease, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(publishRelease, /automation_commit/);
  assert.match(publishRelease, /--ref "\$\{RELEASE_TAG\}"/);
  assert.match(publishRelease, /lookup-release\.mjs/);
  assert.match(publishRelease, /already published and immutable/);
  assert.match(publishRelease, /--draft=false/);
  assert.match(publishRelease, /expected-state published/);
  assert.match(publishRelease, /source-digest/);
  assert.match(publishRelease, /source-ref "refs\/heads\/main"/);
  assert.doesNotMatch(workflows, /--clobber/);
  assert.doesNotMatch(workflows, /releases\/tags\/\$\{RELEASE_TAG\}/);
  assert.doesNotMatch(draftRelease, /--draft=false/);

  const draftVerifier = draftRelease.slice(
    draftRelease.indexOf("  verify:"),
  );
  const publicationValidator = publishRelease.slice(
    publishRelease.indexOf("  validate:"),
    publishRelease.indexOf("  publish:"),
  );
  const publishedVerifier = publishRelease.slice(
    publishRelease.indexOf("  verify:"),
  );
  assert.match(draftVerifier, /contents: write/);
  assert.match(publicationValidator, /contents: write/);
  assert.match(publishedVerifier, /contents: read/);

  const firstTagCheck = publishRelease.indexOf(
    'tagged_commit="$(resolve_tag_commit)"',
  );
  const publication = publishRelease.indexOf("--draft=false");
  const secondTagCheck = publishRelease.indexOf(
    'tagged_commit="$(resolve_tag_commit)"',
    firstTagCheck + 1,
  );
  assert.ok(firstTagCheck > 0 && firstTagCheck < publication);
  assert.ok(secondTagCheck > publication);

  for (const path of [
    ".claude/agents/**",
    ".claude/commands/**",
    ".agents/plugins/marketplace.json",
    "scripts/evaluation/**",
  ]) {
    assert.equal(integrity.split(`- "${path}"`).length - 1, 2);
  }
});

test("paginated release lookup selects drafts without the tag endpoint", () => {
  const draft = {
    id: 123,
    tag_name: "v1.2.0",
    draft: true,
  };

  assert.equal(
    selectReleaseByTag([[draft], []], "v1.2.0"),
    draft,
  );
  assert.equal(
    selectReleaseByTag([[]], "v1.2.0", { allowMissing: true }),
    null,
  );
  assert.throws(
    () => selectReleaseByTag([[]], "v1.2.0"),
    /was not found/,
  );
  assert.throws(
    () => selectReleaseByTag([[draft], [draft]], "v1.2.0"),
    /Multiple releases/,
  );
});

test("publication retries accept only draft or immutable exact-state candidates", () => {
  assert.doesNotThrow(() =>
    assertExpectedReleaseState(
      { draft: true, immutable: false },
      "draft-or-immutable",
    ),
  );
  assert.doesNotThrow(() =>
    assertExpectedReleaseState(
      { draft: false, immutable: true },
      "draft-or-immutable",
    ),
  );
  assert.throws(
    () =>
      assertExpectedReleaseState(
        { draft: false, immutable: false },
        "draft-or-immutable",
      ),
    /must be a draft or an immutable published release/,
  );
  assert.throws(
    () =>
      assertExpectedReleaseState(
        { draft: true, immutable: false },
        "published",
      ),
    /still a draft/,
  );
});

test("remote verification checks API metadata and a fresh download", async () => {
  const verifier = await text("scripts/release/verify-remote.mjs");

  assert.match(verifier, /"gh", \[\s*"api"/);
  assert.match(verifier, /"release",\s*"download"/);
  assert.match(verifier, /remoteAsset\.content_type/);
  assert.match(verifier, /remoteAsset\.digest/);
  assert.match(verifier, /verifyArtifactSet\(options\.ref, downloadDirectory\)/);
});

test("AGENTS.md preserves the human publication gate and recovery rules", async () => {
  const agents = await text("AGENTS.md");

  assert.match(agents, /gh release create --draft\s+--verify-tag/);
  assert.match(agents, /gh api/);
  assert.match(agents, /paginated Releases API/);
  assert.match(agents, /does not expose draft releases/);
  assert.match(agents, /gh release download/);
  assert.match(agents, /gh workflow run publish-release\.yml -f tag=vX\.Y\.Z/);
  assert.match(agents, /gh run download <run-id>/);
  assert.match(agents, /never uses `--clobber`/);
  assert.match(agents, /owner-admin gate/);
  assert.match(agents, /draft releases only to tokens with write access/);
  assert.match(agents, /Verification after publication remains read-only/);
  assert.match(agents, /must see `true` before dispatching/);
  assert.match(agents, /`GITHUB_TOKEN` cannot read/);
  assert.match(
    agents,
    /reviewed release automation from the dispatched\s+`main` commit/,
  );
  assert.match(agents, /failed only because of a release-automation defect/);
  assert.match(agents, /retain replacement validation\s+evidence/);
  assert.match(
    agents,
    /recovery path accepts\s+only the exact immutable\s+release/,
  );
  assert.match(
    agents,
    /Do\s+not\s+move the tag,\s+overwrite\s+assets, or publish/,
  );
  assert.match(agents, /scripts\/evaluation\/contracts\.mjs/);
  assert.match(agents, /deliberately\s+excluded from `qa-suite\.skill`/);
});
