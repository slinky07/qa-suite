import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  assertExternalReferenceInventory,
  assertExpectedReleaseState,
  selectReleaseByTag,
} from "../scripts/release/lib.mjs";

async function text(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

async function json(path) {
  return JSON.parse(await text(path));
}

function approvedReference(reference, path) {
  return {
    ...structuredClone(reference),
    id: "REF-0002",
    author: "Example Author",
    publisher: "Example Publisher",
    original_source_url: "https://example.com/reference",
    acquisition_date: "2026-07-30",
    classification: "public",
    provenance_status: "verified",
    license: {
      identifier: "Example-License-1.0",
      evidence: "https://example.com/reference/license",
      redistribution: "approved",
    },
    current_status: "active",
    retention: {
      decision: "retain-source",
      review_due: "2027-07-30",
      term: "Retain while the approved reference remains active.",
    },
    storage: {
      kind: "repository-git-lfs",
      locator: null,
      repository_path: path,
    },
    distribution: {
      decision: "approved",
      channels: ["tagged-repository"],
    },
    disposition: {
      decision: "retain-approved-reference",
      date: "2026-07-30",
      approver: "repository-owner",
      reason: "Synthetic approved reference for contract validation.",
    },
  };
}

function lfsEntry(reference, overrides = {}) {
  const path =
    overrides.path ?? reference.storage.repository_path;
  const content =
    overrides.content ??
    Buffer.from(
      `version https://git-lfs.github.com/spec/v1\noid sha256:${reference.sha256}\nsize 123\n`,
    );
  return {
    content,
    mode: overrides.mode ?? "100644",
    oid: overrides.oid ?? "a".repeat(40),
    path,
    type: overrides.type ?? "blob",
  };
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
  const releaseGuide = await text("docs/releasing.md");

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
  assert.match(releaseGuide, /\| Claude\.ai \|/);
  assert.match(releaseGuide, /\| Claude Code \|/);
  assert.match(releaseGuide, /\| Codex \|/);
});

test("controlled external references fail closed before distribution", async () => {
  const register = await json("docs/external-reference-register.json");
  const pendingReference = register.references[0];

  assert.doesNotThrow(() =>
    assertExternalReferenceInventory(register, [
      {
        mode: "100644",
        oid: "b".repeat(40),
        path: "README.md",
        type: "blob",
      },
    ]),
  );

  const unregisteredPdf = {
    content: Buffer.from("%PDF-1.7"),
    mode: "100644",
    oid: "c".repeat(40),
    path: "docs/unregistered.pdf",
    type: "blob",
  };
  assert.throws(
    () => assertExternalReferenceInventory(register, [unregisteredPdf]),
    /Uncontrolled external reference binary: docs\/unregistered\.pdf/,
  );
  assert.throws(
    () =>
      assertExternalReferenceInventory(register, [
        {
          ...unregisteredPdf,
          path: "docs/renamed-reference.bin",
        },
      ]),
    /Uncontrolled external reference binary: docs\/renamed-reference\.bin/,
  );

  const approved = approvedReference(
    pendingReference,
    "docs/external-reference-files/example.pdf",
  );
  const approvedRegister = {
    schema_version: 1,
    references: [pendingReference, approved],
  };
  assert.doesNotThrow(() =>
    assertExternalReferenceInventory(approvedRegister, [lfsEntry(approved)]),
  );

  assert.throws(
    () =>
      assertExternalReferenceInventory(approvedRegister, [
        lfsEntry(approved, { content: Buffer.from("%PDF-1.7") }),
      ]),
    /must be stored as a canonical Git LFS pointer/,
  );
  assert.throws(
    () =>
      assertExternalReferenceInventory(approvedRegister, [
        lfsEntry(approved, {
          content: Buffer.from(
            `version https://git-lfs.github.com/spec/v1\noid sha256:${"f".repeat(64)}\nsize 123\n`,
          ),
        }),
      ]),
    /Git LFS SHA-256 does not match the register/,
  );
  assert.throws(
    () =>
      assertExternalReferenceInventory(approvedRegister, [
        lfsEntry(approved, {
          content: Buffer.from(
            `version https://git-lfs.github.com/spec/v1\noid sha256:${approved.sha256}\nsize 123`,
          ),
        }),
      ]),
    /must be stored as a canonical Git LFS pointer/,
  );
  assert.throws(
    () =>
      assertExternalReferenceInventory(approvedRegister, [
        lfsEntry(approved, { content: Buffer.alloc(1024) }),
      ]),
    /Git LFS pointer must be smaller than 1024 bytes/,
  );
  assert.throws(
    () => assertExternalReferenceInventory(approvedRegister, []),
    /Stale external reference path is not tracked/,
  );
  assert.throws(
    () =>
      assertExternalReferenceInventory(approvedRegister, [
        lfsEntry(approved, { mode: "120000" }),
      ]),
    /non-executable regular Git LFS pointer/,
  );
});

test("controlled reference approvals validate identity, paths, and channels", async () => {
  const register = await json("docs/external-reference-register.json");
  const pendingReference = register.references[0];
  const approved = approvedReference(
    pendingReference,
    "docs/external-reference-files/example.pdf",
  );

  const pendingWithPath = {
    ...structuredClone(pendingReference),
    retention: {
      decision: "retain-source",
      review_due: "2027-07-30",
      term: "Synthetic pending source retention.",
    },
    storage: {
      kind: "repository-git-lfs",
      locator: null,
      repository_path: "docs/external-reference-files/pending.pdf",
    },
  };
  assert.throws(
    () =>
      assertExternalReferenceInventory(
        { schema_version: 1, references: [pendingWithPath] },
        [lfsEntry(pendingWithPath)],
      ),
    /pending or rejected provenance and cannot be distributed|must prove provenance/,
  );

  const unsafePath = {
    ...structuredClone(approved),
    storage: {
      ...approved.storage,
      repository_path: "../outside.pdf",
    },
  };
  assert.throws(
    () =>
      assertExternalReferenceInventory(
        { schema_version: 1, references: [unsafePath] },
        [],
      ),
    /not a safe normalized repository path/,
  );

  const uppercaseDigest = {
    ...structuredClone(approved),
    sha256: approved.sha256.toUpperCase(),
  };
  assert.throws(
    () =>
      assertExternalReferenceInventory(
        { schema_version: 1, references: [uppercaseDigest] },
        [],
      ),
    /64 lowercase hex characters/,
  );

  const packaged = approvedReference(
    pendingReference,
    "qa-suite/references/external/example.pdf",
  );
  assert.throws(
    () =>
      assertExternalReferenceInventory(
        { schema_version: 1, references: [packaged] },
        [lfsEntry(packaged)],
      ),
    /must allowlist claude-ai/,
  );

  const duplicate = {
    ...structuredClone(approved),
    id: "REF-0003",
  };
  assert.throws(
    () =>
      assertExternalReferenceInventory(
        { schema_version: 1, references: [approved, duplicate] },
        [lfsEntry(approved)],
      ),
    /Duplicate external reference path/,
  );

  const restricted = {
    ...structuredClone(approved),
    classification: "restricted",
  };
  assert.throws(
    () =>
      assertExternalReferenceInventory(
        { schema_version: 1, references: [restricted] },
        [lfsEntry(restricted)],
      ),
    /must be public before repository distribution/,
  );
});

test("reference lineage and derived authority links remain auditable", async () => {
  const register = await json("docs/external-reference-register.json");
  const pendingReference = register.references[0];

  const missingRetention = structuredClone(pendingReference);
  delete missingRetention.retention;
  assert.throws(
    () =>
      assertExternalReferenceInventory(
        { schema_version: 1, references: [missingRetention] },
        [],
      ),
    /expected .*retention/,
  );

  const missingReviewDue = {
    ...structuredClone(pendingReference),
    retention: {
      ...pendingReference.retention,
      review_due: null,
    },
  };
  assert.throws(
    () =>
      assertExternalReferenceInventory(
        { schema_version: 1, references: [missingReviewDue] },
        [],
      ),
    /non-final status requires a review due date/,
  );

  const invalidCalendarDate = {
    ...structuredClone(pendingReference),
    review_date: "2026-99-99",
  };
  assert.throws(
    () =>
      assertExternalReferenceInventory(
        { schema_version: 1, references: [invalidCalendarDate] },
        [],
      ),
    /not a valid calendar date/,
  );

  const disposed = {
    ...approvedReference(
      pendingReference,
      "docs/external-reference-files/disposed.pdf",
    ),
    current_status: "disposed",
    storage: {
      kind: "metadata-only",
      locator: null,
      repository_path: null,
    },
    distribution: {
      decision: "excluded",
      channels: [],
    },
    retention: {
      decision: "dispose-source",
      review_due: null,
      term: "Source disposed by reviewed decision; retain the register record.",
    },
  };
  assert.doesNotThrow(() =>
    assertExternalReferenceInventory(
      { schema_version: 1, references: [disposed] },
      [],
    ),
  );

  const missingAuthority = {
    ...structuredClone(pendingReference),
    derived_authorities: [
      {
        locator: "section 2",
        path: "docs/adr/9999-derived-rule.md",
        rationale: "Synthetic missing authority.",
        treatment: "adopted",
      },
    ],
  };
  assert.throws(
    () =>
      assertExternalReferenceInventory(
        { schema_version: 1, references: [missingAuthority] },
        [],
      ),
    /derived authority is not tracked/,
  );

  const vagueLocator = {
    ...structuredClone(missingAuthority),
    derived_authorities: [
      {
        ...missingAuthority.derived_authorities[0],
        locator: "somewhere near the middle",
      },
    ],
  };
  assert.throws(
    () =>
      assertExternalReferenceInventory(
        { schema_version: 1, references: [vagueLocator] },
        [],
      ),
    /must be an exact source locator/,
  );

  const missingLineageTarget = {
    ...structuredClone(pendingReference),
    supersession_history: [
      {
        action: "supersedes",
        date: "2026-07-30",
        reason: "Synthetic unresolved lineage.",
        reference_id: "REF-9999",
      },
    ],
  };
  assert.throws(
    () =>
      assertExternalReferenceInventory(
        { schema_version: 1, references: [missingLineageTarget] },
        [],
      ),
    /supersession target is not registered/,
  );
});

test("reference policy and release automation share one exact-ref contract", async () => {
  const agents = await text("AGENTS.md");
  const policy = await text("docs/external-references.md");
  const decision = await text(
    "docs/adr/0001-controlled-external-references.md",
  );
  const releaseGuide = await text("docs/releasing.md");
  const releaseLibrary = await text("scripts/release/lib.mjs");
  const integrity = await text(".github/workflows/release-integrity.yml");

  assert.match(agents, /docs\/external-references\.md/);
  assert.match(policy, /evidence inputs,\s+not executable QA-Suite authority/);
  assert.match(policy, /REF-####/);
  assert.match(policy, /repository-git-lfs/);
  assert.match(decision, /External references are controlled evidence inputs/);
  assert.match(decision, /exact page or\s+section/);
  assert.match(releaseGuide, /scans the complete\s+tree/);
  assert.match(releaseLibrary, /assertExternalReferenceContract\(commit\)/);

  for (const path of [
    "docs/external-reference-register.json",
    "docs/external-references.md",
    "docs/external-reference-files/**",
    "docs/adr/0001-controlled-external-references.md",
  ]) {
    assert.equal(integrity.split(`- "${path}"`).length - 1, 2);
  }
});

test("Codex catalog and plugin manifest keep distinct metadata ownership", async () => {
  const marketplace = await json(".agents/plugins/marketplace.json");
  const plugin = await json(".codex-plugin/plugin.json");
  const entry = marketplace.plugins[0];

  assert.equal(marketplace.name, plugin.name);
  assert.equal(entry.name, plugin.name);
  assert.deepEqual(
    Object.keys(entry).sort(),
    ["category", "name", "policy", "source"],
  );
  assert.equal(entry.source.source, "local");
  assert.equal(entry.source.path, "./");
  assert.deepEqual(entry.policy, {
    authentication: "ON_INSTALL",
    installation: "AVAILABLE",
  });
  assert.equal(typeof entry.category, "string");

  for (const field of [
    "version",
    "description",
    "author",
    "license",
    "displayName",
    "homepage",
    "repository",
    "keywords",
    "interface",
  ]) {
    assert.equal(Object.hasOwn(entry, field), false);
  }

  assert.equal(typeof plugin.version, "string");
  assert.equal(typeof plugin.description, "string");
  assert.equal(typeof plugin.author?.name, "string");
  assert.equal(typeof plugin.license, "string");
  assert.equal(typeof plugin.interface?.displayName, "string");
  assert.equal(typeof plugin.interface?.developerName, "string");
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
  for (const workflow of [integrity, draftRelease, publishRelease]) {
    assert.match(workflow, /run: node --test/);
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

test("release guide preserves the human publication gate and recovery rules", async () => {
  const agents = await text("AGENTS.md");
  const releaseGuide = await text("docs/releasing.md");

  assert.match(agents, /docs\/releasing\.md/);
  assert.match(releaseGuide, /gh release create --draft\s+--verify-tag/);
  assert.match(releaseGuide, /gh api/);
  assert.match(releaseGuide, /paginated Releases API/);
  assert.match(releaseGuide, /does not expose draft releases/);
  assert.match(releaseGuide, /gh release download/);
  assert.match(
    releaseGuide,
    /gh workflow run publish-release\.yml -f tag=vX\.Y\.Z/,
  );
  assert.match(releaseGuide, /gh run download <run-id>/);
  assert.match(releaseGuide, /never uses `--clobber`/);
  assert.match(releaseGuide, /owner-admin gate/);
  assert.match(releaseGuide, /draft releases only to tokens with write access/);
  assert.match(
    releaseGuide,
    /Verification after publication remains read-only/,
  );
  assert.match(releaseGuide, /must see `true` before dispatching/);
  assert.match(releaseGuide, /`GITHUB_TOKEN` cannot read/);
  assert.match(
    releaseGuide,
    /reviewed release automation from the dispatched\s+`main` commit/,
  );
  assert.match(
    releaseGuide,
    /failed only because of a release-automation defect/,
  );
  assert.match(releaseGuide, /retain replacement validation\s+evidence/);
  assert.match(
    releaseGuide,
    /recovery path accepts\s+only the exact immutable\s+release/,
  );
  assert.match(
    releaseGuide,
    /Do\s+not\s+move the tag,\s+overwrite\s+assets, or publish/,
  );
  assert.match(agents, /scripts\/evaluation\/contracts\.mjs/);
  assert.match(
    agents,
    /deliberately\s+excluded\s+from\s+`qa-suite\.skill`/,
  );
});
