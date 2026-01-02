import path from "node:path/posix";
import fs from "node:fs/promises";
import * as git from "./lib/git.ts";
import * as github from "./lib/github.ts";
import * as oras from "./lib/oras.ts";
import { die, tmpDir } from "./lib/utils.ts";
import {
  parsePublishPlan,
  parseRegistryIndex,
  writeRegistryIndex,
} from "./lib/schema.ts";

for (const varName of [
  "GHCR_REPO_PREFIX",
  "PUBLISH_PLAN_PATH",
  "REGISTRY_DIR",
  "API_VERSION",
]) {
  if (process.env[varName] === undefined) {
    die(`Missing required environment variable: ${varName}`);
  }
}

const GHCR_REPO_PREFIX = process.env["GHCR_REPO_PREFIX"]!;
const PUBLISH_PLAN_PATH = process.env["PUBLISH_PLAN_PATH"]!;
const REGISTRY_DIR = process.env["REGISTRY_DIR"]!;
const API_VERSION = process.env["API_VERSION"]!;

const publishPlan = await parsePublishPlan(PUBLISH_PLAN_PATH);
const registryUpdatePlan = [];

for (const it of publishPlan) {
  const { publisher, slug, widget, manifest } = it;
  const { path: tempDir, cleanup: cleanupTempDir } = await tmpDir({
    unsafeCleanup: true,
  });
  console.log(`[${publisher}/${slug}] Working directory: ${tempDir}`);

  await git.checkoutRepoAtCommit(
    tempDir,
    widget.repo,
    widget.commit,
    widget.path,
  );

  console.log(`::group::[${publisher}/${slug}] Publishing widget...`);
  const widgetDir =
    widget.path === undefined ? tempDir : path.join(tempDir, widget.path);
  const remote = `${GHCR_REPO_PREFIX}/widgets/${publisher}/${slug}`;
  const pushResult = await oras.push({
    src: widgetDir,
    dst: remote,
    widget,
    manifest,
  });
  console.log(pushResult);
  console.log("::endgroup::");
  console.log(`::notice::Published: https://${remote}@${pushResult.digest}`);

  await github.attest({ name: remote, digest: pushResult.digest });
  console.log(`::notice::Attested: oci://${remote}@${pushResult.digest}`);

  let publishedAt = new Date().toISOString();
  const createdAt =
    pushResult.annotations?.["org.opencontainers.image.created"];
  if (createdAt !== undefined) {
    publishedAt = createdAt;
  }

  registryUpdatePlan.push({ ...it, publishedAt, digest: pushResult.digest });

  await cleanupTempDir();
}

const now = new Date();
await fs.mkdir(REGISTRY_DIR, { recursive: true });
const registryIndex = await parseRegistryIndex(REGISTRY_DIR);
registryIndex.api = API_VERSION;
registryIndex.generatedAt = now.toISOString();

console.log("Updating registry index...");

for (const it of registryUpdatePlan) {
  const { publisher, slug, widget, manifest, publishedAt, digest } = it;
  let entry = registryIndex.widgets.find(
    (e) => e.publisher === publisher && e.slug === slug,
  );

  const releaseData = {
    version: widget.version,
    publishedAt,
    digest,
  };

  const isPrivate = publisher === "deskulpt-test";

  if (entry === undefined) {
    entry = {
      publisher,
      slug,
      name: manifest.name,
      authors: manifest.authors,
      description: manifest.description,
      releases: [releaseData],
      private: isPrivate ? true : undefined,
    };
    registryIndex.widgets.push(entry);
    console.log(`::group::[${publisher}/${slug}] Added new entry`);
    console.log(entry);
    console.log("::endgroup::");
    continue;
  }

  entry.name = manifest.name;
  entry.authors = manifest.authors;
  entry.description = manifest.description;
  entry.releases.unshift(releaseData); // Prepend new release
  entry.private = isPrivate ? true : undefined;
  console.log(`::group::[${publisher}/${slug}] Updated entry`);
  console.log(entry);
  console.log("::endgroup::");
}

registryIndex.widgets.sort((a, b) => {
  if (a.publisher !== b.publisher) {
    return a.publisher.localeCompare(b.publisher);
  }
  return a.slug.localeCompare(b.slug);
});

await writeRegistryIndex(REGISTRY_DIR, registryIndex);
console.log("Registry index updated");
