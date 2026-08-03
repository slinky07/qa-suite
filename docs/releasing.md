# QA-Suite release process

This document is the detailed release authority referenced by `AGENTS.md`.
Read it before changing release automation, preparing a version, validating a
draft, publishing, or performing release recovery.

## Release artifact contract

The only published binary assets are:

- `qa-suite.skill`
- `qa-suite-source.zip`

Both names contain the same ZIP bytes. Each archive contains only the
`qa-suite/` tree from the exact release commit. Packaging must read the Git
object database, not the working tree. This excludes dirty and untracked files
by construction.

Supported channels intentionally differ:

| Channel | Delivered tree |
|---|---|
| Claude.ai | `qa-suite.skill`, containing only `qa-suite/` |
| Source download / local skill | `qa-suite-source.zip`, byte-identical to the `.skill` package |
| Claude Code | Tagged repository with `qa-suite/`, `.claude-plugin/`, `.claude/agents/`, and `.claude/commands/` |
| Codex | Tagged repository with `qa-suite/`, `.codex-plugin/`, and `.agents/plugins/marketplace.json` |

### Codex metadata ownership

Codex reads two schemas with different responsibilities:

- `.agents/plugins/marketplace.json` is the catalog. Its top-level `name` and
  `interface.displayName` label the catalog source; each plugin entry owns the
  catalog `name`, `source`, installation and authentication `policy`, and
  `category`.
- `.codex-plugin/plugin.json` is the plugin manifest. It owns the plugin
  version, description, publisher (`author` and `interface.developerName`),
  license, component paths, and install-surface `interface` metadata.

The Codex catalog intentionally does not repeat the manifest's version,
description, author, license, or other package metadata. Do not copy those
Claude marketplace fields into the Codex plugin entry. Metadata parity across
the two hosts means that each schema points to consistent package information;
it does not mean that `.agents/plugins/marketplace.json` mirrors
`.claude-plugin/marketplace.json`.

Inspect the resolved Codex listing without changing installation state:

```sh
codex plugin list --marketplace qa-suite --json
```

The release check validates every manifest-referenced path and the complete
shipped Claude agent/command sets. A channel path may not disappear or drift
without failing CI.

## Consumer install, upgrade, and rollback

### Verify the release input and active payload

Do not use a plugin's displayed version as proof of its installed bytes. Start
with one immutable release tag and retain its verified source archive:

```sh
qa_release_tag=vX.Y.Z
qa_release_evidence_dir="$(mktemp -d /tmp/qa-suite-consumer-verify.XXXXXX)"
gh release verify "$qa_release_tag" -R slinky07/qa-suite
gh release download "$qa_release_tag" -R slinky07/qa-suite \
  --pattern qa-suite-source.zip \
  --dir "$qa_release_evidence_dir"
```

The `gh release verify` result must cover `qa-suite-source.zip`. Retain its
attested digest. Obtain `verify-installed-payload.mjs` from an exact checkout
of the release tag, or extract the attested archive into a new isolated
temporary directory and run the copy it contains. When verifying an earlier
release that predates this script, use the verifier from the exact candidate
tag against the earlier release's attested archive. Do not run a verifier
copied from the active installation being tested.

Find the active skill tree without choosing it from a version label alone:

| Channel | Installed-root discovery |
|---|---|
| Claude Code | Run `claude plugin list --json`. Require exactly one enabled item whose `id` is `qa-suite@qa-suite`; append `/qa-suite` to that item's `installPath`. Stop if the result is missing or ambiguous. |
| Codex | Run `codex plugin list --marketplace qa-suite --json` and require exactly one installed `qa-suite` item. Locate the corresponding `<Codex home>/plugins/cache/qa-suite/qa-suite/<listed-version>/qa-suite` tree. Stop if more than one cache candidate could be active. The listed version locates a candidate; it does not verify it. |
| Claude or Codex local skill | Use the exact `qa-suite` directory configured as `$HOME/.claude/skills/qa-suite` or `$HOME/.agents/skills/qa-suite`. Stop if the host configuration does not identify one active directory. |
| Claude.ai | The host does not expose the uploaded skill tree. Verify the asset before upload, record the visible activation state, and mark post-upload byte identity `Observed only`. |

Compare the exposed active tree with the verified archive:

```sh
node /trusted-release/qa-suite/scripts/verify-installed-payload.mjs \
  --archive "$qa_release_evidence_dir/qa-suite-source.zip" \
  --installed-root /active-install/qa-suite
```

The dependency-free verifier reads the stored Git ZIP without extracting it.
It requires one canonical top-level `qa-suite/` tree, rejects unsafe paths,
unsafe symlinks, unsupported entry types, malformed bounds, checksum failures,
and non-stored compression, and never follows installed symlink directories.
It compares every directory, file, and symlink. A missing or extra path, entry
type change, file SHA-256 change, or symlink-target change exits `1`. Invalid
arguments, input, or archive structure exit `2`. Only an exact match exits `0`.
Retain the JSON result and require its `archive_sha256` to equal the digest
reported by `gh release verify`.

### Pinned plugin replacement

Record the last-known-good tag, its attested archive digest, the active
installed-root path, and a successful verifier result before changing a
plugin. Use the same installation scope throughout the Claude Code commands;
`user` is shown below. Run these operations only against the disposable target
declared in `qa-context.md` during release QA.

Claude Code replacement to a target tag:

```sh
qa_target_tag=vX.Y.Z
claude plugin uninstall qa-suite@qa-suite --scope user --keep-data
claude plugin marketplace remove qa-suite --scope user
claude plugin marketplace add "slinky07/qa-suite@$qa_target_tag" --scope user
claude plugin install qa-suite@qa-suite --scope user
```

Codex replacement to a target tag:

```sh
qa_target_tag=vX.Y.Z
codex plugin remove qa-suite@qa-suite
codex plugin marketplace remove qa-suite
codex plugin marketplace add slinky07/qa-suite --ref "$qa_target_tag"
codex plugin add qa-suite@qa-suite
```

Restart the affected Claude Code or Codex host after replacement, discover the
active root again, and run the installed-payload verifier. A marketplace update
or upgrade against a moving source is not a substitute for this pinned flow.

To test repeatability, run the same remove, pinned-marketplace add, install,
restart, discovery, and verification sequence again with the same target tag
and verified archive. Both runs must exit `0` with the same archive digest and
no differences.

To roll back, repeat the same channel sequence with the recorded prior tag.
Use the retained prior `qa-suite-source.zip`, restart, rediscover the active
root, and require an exact verifier match to that prior archive. Do not edit a
cache in place or move a release tag.

For a local-skill installation, stage each verified archive in a new empty
directory and activate that complete tree; never overlay it on the old tree.
Retain the prior directory until the replacement passes. Rollback reactivates
the retained prior tree, or a fresh extraction of the retained prior archive,
then runs the same verifier against it.

For Claude.ai, retain both the prior and candidate attested `.skill` files.
Upgrade by replacing the uploaded skill with the candidate. Roll back by
replacing it with the prior file. Record the visible activation result, but do
not report exact post-upload payload identity because the host exposes no
installed bytes to the verifier.

### Disposable release rehearsal

The release rehearsal uses a fresh ephemeral CI runner or OS account with
isolated Claude and Codex configuration roots. It must not read or change the
owner's installed plugins.

For the v1.5.0 candidate:

1. Download and verify the published `v1.4.0` assets. Obtain the candidate
   archive from the successful draft workflow's retained artifact and bind it
   to the frozen tag through `release-evidence.json`. Record both tags, commit
   SHAs, and archive digests. After publication, repeat candidate acquisition
   with `gh release verify` and a fresh release download.
2. Install pinned `v1.4.0`, restart, discover the active root, and verify it
   against the v1.4.0 archive.
3. Replace it with the pinned candidate, restart, and verify the candidate
   archive.
4. Repeat the candidate replacement with identical inputs and verify again.
5. Roll back to pinned `v1.4.0`, restart, and verify the prior archive.
6. Reinstall the pinned candidate and verify it once more.

Retain host and CLI versions, commands, installed-root discovery output,
verifier JSON, and restart/activation results. A missing or ambiguous active
root, unavailable mutation-isolated target, verifier mismatch, or failed
rollback leaves the deployment confirmation unresolved.

### External-reference binary gate

The controlled-reference policy and canonical register live at
`docs/external-references.md` and `docs/external-reference-register.json`.
Release validation reads both from the exact Git ref and scans the complete
tree, not the working copy or only `qa-suite/`. This whole-tree check matters
because Claude Code and Codex consume tagged repository paths.

Document binaries fail closed unless one register entry identifies the exact
path and SHA-256, proves provenance and redistribution rights, and allowlists
every channel that would carry it. Repository storage is Git LFS only; a raw
binary is rejected even if registered. Every tracked reference requires the
`tagged-repository` channel. A reference below `qa-suite/` also requires
`claude-ai` and `source-archive`, covering both byte-identical generated
assets. Pending, unlicensed, duplicate, mismatched, or unregistered references
stop release construction.

The current `REF-0001` record is metadata-only and distribution-excluded. Its
local PDF is not a release input and must remain outside Git. An untracked or
ignored working-copy file cannot enter the exact-ref build, but that local fact
is not a substitute for the controlled register and deny-by-default guard.

Run the local release integrity check with:

```sh
node scripts/release/check.mjs --ref HEAD
```

The check must:

1. validate version parity;
2. validate controlled external references across the exact Git tree;
3. build twice in separate temporary directories;
4. require byte-identical results across both builds and both asset names;
5. extract both assets and compare them with `qa-suite/` at the same Git ref;
6. fail on missing, extra, stale, renamed, or uncontrolled binary content.

Generated archives and evidence are ignored. Never commit them.

## Release procedure

Prepare a release PR that changes `VERSION`, all versioned plugin manifests,
and the README release notes. Do not edit `qa-suite/` in that PR.

Merging a `VERSION` change to `main` runs
`.github/workflows/draft-release.yml`. Separate least-privilege jobs:

1. validates the exact merged commit;
2. creates the matching annotated `v<version>` tag if it does not exist;
3. builds and attests both artifacts;
4. creates a draft GitHub Release with `gh release create --draft
   --verify-tag`;
5. checks the authenticated, paginated Releases API with `gh api` and selects
   the exact tag (the release-by-tag endpoint does not expose draft releases);
6. downloads the assets into a fresh directory with `gh release download`;
7. rechecks names, media types, digests, bytes, and archive/tree parity;
8. retains machine-readable evidence as a workflow artifact.

The workflow never uses `--clobber` and never publishes the draft. A retry may
upload a missing asset only after every existing asset matches the exact local
build. A mismatch or extra asset fails closed.

GitHub exposes draft releases only to tokens with write access to repository
contents. The draft-verification and pre-publication validation jobs therefore
declare `contents: write` even though those steps only query metadata and
download assets. Verification after publication remains read-only.

Immutable releases are required before publication. Enabling and confirming
this one-time repository setting is an owner-admin gate:

```sh
gh api --method PUT repos/slinky07/qa-suite/immutable-releases
gh api repos/slinky07/qa-suite/immutable-releases --jq .enabled
```

The authenticated owner must see `true` before dispatching the publication
workflow. A workflow `GITHUB_TOKEN` cannot read this administration endpoint,
so the workflow deliberately does not substitute a weaker or broader secret
for the owner-admin check.

After the draft workflow succeeds, inspect its logs and retained evidence:

```sh
gh run list --workflow draft-release.yml --limit 5
gh run view <run-id> --log
gh run download <run-id> \
  --name release-evidence-vX.Y.Z \
  --dir /tmp/qa-suite-release-evidence-vX.Y.Z
jq . /tmp/qa-suite-release-evidence-vX.Y.Z/release-evidence.json
```

Normally the draft workflow must succeed before publication. If it created the
exact draft and then failed only because of a release-automation defect, repair
the automation through a PR. The publication workflow must then run from the
repaired `main`, repeat all candidate checks, and retain replacement validation
evidence before it may publish.

Publish only through the verification workflow:

```sh
gh workflow run publish-release.yml -f tag=vX.Y.Z
gh run list --workflow publish-release.yml --limit 5
gh run watch <run-id>
gh release view vX.Y.Z
gh release verify vX.Y.Z
```

Then use a fresh disposable host configuration to verify both plugin channels
against the newly published immutable tag:

```sh
qa_published_tag=vX.Y.Z
codex plugin marketplace add slinky07/qa-suite --ref "$qa_published_tag"
codex plugin add qa-suite@qa-suite
claude plugin marketplace add "slinky07/qa-suite@$qa_published_tag" --scope user
claude plugin install qa-suite@qa-suite --scope user
```

Restart each host. Discover each active root with the channel-specific
procedure above and run `verify-installed-payload.mjs` against a fresh
`qa-suite-source.zip` download whose digest is covered by the successful
`gh release verify`. Both installed trees must match before release
verification is complete.

The publication workflow runs reviewed release automation from the dispatched
`main` commit while rebuilding the package only from the requested tag. This
allows a verifier defect to be repaired without moving a frozen release tag or
changing its payload. It rechecks the mutable draft immediately before
publication, publishes it, then rechecks the immutable release and provenance.
If a workflow run fails after GitHub has already published the release, rerun
it with the same tag. The recovery path accepts only the exact immutable
release, skips republication, and regenerates the retained evidence. If a tag
or release points at the wrong commit, stop. Do not move the tag, overwrite
assets, or publish. Fix the process through a new PR and obtain explicit owner
approval before deleting any remote release or tag.
