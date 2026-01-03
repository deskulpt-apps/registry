import path from "node:path/posix";
import fs from "node:fs/promises";
import * as git from "./lib/git.ts";
import * as github from "./lib/github.ts";
import * as oras from "./lib/oras.ts";
import { die, tmpDir } from "./lib/utils.ts";
import { parsePublishPlan } from "./lib/schema.ts";
import {
  parseApiIndex,
  prependApiVersionsList,
  writeApiIndex,
  writeApiWidgetDetails,
} from "./lib/api.ts";

for (const varName of [
  "GHCR_REPO_PREFIX",
  "PUBLISH_PLAN_PATH",
  "API_DIR",
  "API_VERSION",
]) {
  if (process.env[varName] === undefined) {
    die(`Missing required environment variable: ${varName}`);
  }
}

const GHCR_REPO_PREFIX = process.env["GHCR_REPO_PREFIX"]!;
const PUBLISH_PLAN_PATH = process.env["PUBLISH_PLAN_PATH"]!;
const API_DIR = process.env["API_DIR"]!;
const API_VERSION = process.env["API_VERSION"]!;

await fs.mkdir(API_DIR, { recursive: true });
const apiIndex = await parseApiIndex(API_DIR);
if (apiIndex.api !== API_VERSION) {
  die(
    `Expected API version ${API_VERSION}, but current API version is ${apiIndex.api}`,
  );
}

const publishPlan = await parsePublishPlan(PUBLISH_PLAN_PATH);
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

  await cleanupTempDir();

  await github.attestProvenance({ name: remote, digest: pushResult.digest });
  console.log(`::notice::Attested: oci://${remote}@${pushResult.digest}`);

  let publishedAt = new Date().toISOString();
  const createdAt =
    pushResult.annotations?.["org.opencontainers.image.created"];
  if (createdAt !== undefined) {
    publishedAt = createdAt;
  }

  let entry = apiIndex.widgets.find(
    (e) => e.publisher === publisher && e.slug === slug,
  );

  writeApiWidgetDetails(API_DIR, publisher, slug, {
    publishedAt,
    digest: pushResult.digest,
    manifest,
  });
  console.log(`[${publisher}/${slug}] Details written`);

  prependApiVersionsList(API_DIR, publisher, slug, {
    version: widget.version,
    publishedAt,
  });
  console.log(`[${publisher}/${slug}] Versions list updated`);

  const isPrivate = publisher === "deskulpt-test";
  const isOfficial = publisher === "deskulpt";
  const authorNames = manifest.authors.map((author) =>
    typeof author === "string" ? author : author.name,
  );

  if (entry === undefined) {
    entry = {
      publisher,
      slug,
      version: manifest.version,
      name: manifest.name,
      description: manifest.description,
      authors: authorNames,
      private: isPrivate ? true : undefined,
      official: isOfficial ? true : undefined,
    };
    apiIndex.widgets.push(entry);
    continue;
  }

  entry.version = manifest.version;
  entry.name = manifest.name;
  entry.description = manifest.description;
  entry.authors = authorNames;
  entry.private = isPrivate ? true : undefined;
  entry.official = isOfficial ? true : undefined;
}

const now = new Date();
apiIndex.generatedAt = now.toISOString();

apiIndex.widgets.sort((a, b) => {
  if (a.publisher !== b.publisher) {
    return a.publisher.localeCompare(b.publisher);
  }
  return a.slug.localeCompare(b.slug);
});

await writeApiIndex(API_DIR, apiIndex);
console.log("Registry API index updated");
