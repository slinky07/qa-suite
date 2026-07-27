# QA-Suite repository instructions

## Sources of authority

- `qa-suite/` is the distributed QA skill and the behavior source of truth.
- `VERSION` is the release version source of truth.
- `.codex-plugin/plugin.json`, `.claude-plugin/plugin.json`,
  `.claude-plugin/marketplace.json`, and the repository-version statement in
  `README.md` must match `VERSION`.
- Release automation and version-only PRs must not edit `qa-suite/`. Feature
  PRs update the skill first and mirror its public contract into wrapper files
  only where needed.

### Maintainer evaluation authority exception

Issue #30 meta-testing is maintainer-only infrastructure that evaluates the
distributed skill without changing it:

- `scripts/evaluation/*.mjs` is maintainer-only evaluation infrastructure;
  within it, `scripts/evaluation/contracts.mjs` is the machine authority for
  evaluation data contracts and `scripts/evaluation/scoring.mjs` owns the
  explicitly non-qualifying preview math.
- `tests/evaluation/README.md` is the human-readable authority for the
  evaluation trust boundary and delivery sequence.

This narrow exception does not make either path a source of distributed lane
behavior. Evaluation infrastructure must not redefine a contract owned by
`qa-suite/`, and it must not be mirrored into that tree. The release archives
contain only `qa-suite/`, so both maintainer-only paths are deliberately
excluded from `qa-suite.skill` and `qa-suite-source.zip`.

## Change workflow

Use one issue, one isolated branch, and one PR. Start from refreshed `main`.
Preserve unrelated work. Run `node --test` and the checks relevant to the
changed surface before pushing. Human review remains the merge gate unless the
owner explicitly says otherwise.

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

The release check validates every manifest-referenced path and the complete
shipped Claude agent/command sets. A channel path may not disappear or drift
without failing CI.

Run the local release integrity check with:

```sh
node scripts/release/check.mjs --ref HEAD
```

The check must:

1. validate version parity;
2. build twice in separate temporary directories;
3. require byte-identical results across both builds and both asset names;
4. extract both assets and compare them with `qa-suite/` at the same Git ref;
5. fail on missing, extra, stale, or renamed content.

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

Then verify a fresh Codex installation:

```sh
codex plugin marketplace upgrade qa-suite
codex plugin remove qa-suite@qa-suite
codex plugin add qa-suite@qa-suite
codex plugin list --marketplace qa-suite
```

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
