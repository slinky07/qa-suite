#!/usr/bin/env node

import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  ASSET_CONTENT_TYPES,
  ASSET_NAMES,
  assertExpectedReleaseState,
  assertReleaseTag,
  assertRepository,
  assertVersionContract,
  runCommand,
  sha256,
  verifyArtifactSet,
} from "./lib.mjs";

function parseArguments(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (
      argument === "--repo" ||
      argument === "--tag" ||
      argument === "--ref" ||
      argument === "--artifacts" ||
      argument === "--evidence" ||
      argument === "--expected-state"
    ) {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`${argument} requires a value`);
      }
      options[argument.slice(2)] = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  for (const required of [
    "repo",
    "tag",
    "ref",
    "artifacts",
    "evidence",
    "expected-state",
  ]) {
    if (!options[required]) {
      throw new Error(`--${required} is required`);
    }
  }

  return options;
}

function remoteTagCommit(repository, tag) {
  let object = JSON.parse(
    runCommand("gh", [
      "api",
      `repos/${repository}/git/ref/tags/${tag}`,
    ]),
  ).object;

  for (let depth = 0; depth < 5 && object.type === "tag"; depth += 1) {
    object = JSON.parse(
      runCommand("gh", [
        "api",
        `repos/${repository}/git/tags/${object.sha}`,
      ]),
    ).object;
  }

  if (object.type !== "commit" || !/^[0-9a-f]{40}$/.test(object.sha)) {
    throw new Error(`${tag} does not resolve to a commit`);
  }

  return object.sha;
}

function releaseMetadata(repository, tag) {
  const output = runCommand("gh", [
    "api",
    `repos/${repository}/releases/tags/${tag}`,
  ]);
  return JSON.parse(output);
}

async function localAssets(artifactsDirectory) {
  const assets = new Map();
  for (const name of ASSET_NAMES) {
    const path = join(artifactsDirectory, name);
    assets.set(name, {
      name,
      path,
      size: (await stat(path)).size,
      digest: await sha256(path),
    });
  }
  return assets;
}

function assertRemoteMetadata(release, tag, expectedState, localByName) {
  if (release.tag_name !== tag) {
    throw new Error(`Release tag is ${release.tag_name}; expected ${tag}`);
  }
  assertExpectedReleaseState(release, expectedState);
  if (release.prerelease !== false) {
    throw new Error("Release must not be marked as a prerelease");
  }

  const observedNames = release.assets.map(({ name }) => name).sort();
  const expectedNames = [...ASSET_NAMES].sort();
  if (JSON.stringify(observedNames) !== JSON.stringify(expectedNames)) {
    throw new Error(
      `Release assets are ${observedNames.join(", ")}; expected ${expectedNames.join(", ")}`,
    );
  }

  for (const remoteAsset of release.assets) {
    const localAsset = localByName.get(remoteAsset.name);
    const expectedDigest = `sha256:${localAsset.digest}`;
    const expectedContentType = ASSET_CONTENT_TYPES.get(remoteAsset.name);

    if (remoteAsset.state !== "uploaded") {
      throw new Error(`${remoteAsset.name} state is ${remoteAsset.state}`);
    }
    if (remoteAsset.content_type !== expectedContentType) {
      throw new Error(
        `${remoteAsset.name} content type is ${remoteAsset.content_type}; expected ${expectedContentType}`,
      );
    }
    if (remoteAsset.size !== localAsset.size) {
      throw new Error(`${remoteAsset.name} size differs from the local build`);
    }
    if (remoteAsset.digest !== expectedDigest) {
      throw new Error(
        `${remoteAsset.name} digest is ${remoteAsset.digest}; expected ${expectedDigest}`,
      );
    }
  }
}

async function verifyFreshDownload(options, localByName) {
  const downloadDirectory = await mkdtemp(
    join(tmpdir(), "qa-suite-release-download-"),
  );

  try {
    runCommand("gh", [
      "release",
      "download",
      options.tag,
      "--repo",
      options.repo,
      "--dir",
      downloadDirectory,
    ]);

    const downloadedNames = (await readdir(downloadDirectory)).sort();
    const expectedNames = [...ASSET_NAMES].sort();
    if (JSON.stringify(downloadedNames) !== JSON.stringify(expectedNames)) {
      throw new Error(
        `Downloaded assets are ${downloadedNames.join(", ")}; expected ${expectedNames.join(", ")}`,
      );
    }

    for (const name of ASSET_NAMES) {
      const downloadedDigest = await sha256(join(downloadDirectory, name));
      if (downloadedDigest !== localByName.get(name).digest) {
        throw new Error(`${name} download differs from the local build`);
      }
    }

    await verifyArtifactSet(options.ref, downloadDirectory);
  } finally {
    await rm(downloadDirectory, { recursive: true, force: true });
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  assertRepository(options.repo);
  assertReleaseTag(options.tag);
  if (
    !["draft", "published", "draft-or-immutable"].includes(
      options["expected-state"],
    )
  ) {
    throw new Error(
      "--expected-state must be draft, published, or draft-or-immutable",
    );
  }
  const versionContract = assertVersionContract(options.ref, options.tag);
  const tagCommit = remoteTagCommit(options.repo, options.tag);
  if (tagCommit !== versionContract.commit) {
    throw new Error(
      `${options.tag} points to ${tagCommit}; expected ${versionContract.commit}`,
    );
  }
  const artifactsDirectory = resolve(options.artifacts);
  const localByName = await localAssets(artifactsDirectory);

  await verifyArtifactSet(options.ref, artifactsDirectory);
  const release = releaseMetadata(options.repo, options.tag);
  assertRemoteMetadata(
    release,
    options.tag,
    options["expected-state"],
    localByName,
  );
  await verifyFreshDownload(options, localByName);

  const evidence = {
    schema_version: 1,
    verified_at: new Date().toISOString(),
    repository: options.repo,
    release_id: release.id,
    release_url: release.html_url,
    tag: options.tag,
    tag_commit: tagCommit,
    commit: versionContract.commit,
    version: versionContract.version,
    draft: release.draft,
    immutable: release.immutable,
    assets: release.assets
      .map((asset) => ({
        name: asset.name,
        content_type: asset.content_type,
        state: asset.state,
        size: asset.size,
        digest: asset.digest,
      }))
      .sort((first, second) => first.name.localeCompare(second.name)),
  };

  await writeFile(
    resolve(options.evidence),
    `${JSON.stringify(evidence, null, 2)}\n`,
    { flag: "wx" },
  );

  console.log(
    `${release.draft ? "draft" : "immutable published"} release ${options.tag} passed remote verification`,
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
