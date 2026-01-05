import path from "node:path/posix";
import fs from "node:fs/promises";
import * as git from "./lib/git.ts";
import * as github from "./lib/github.ts";
import * as oras from "./lib/oras.ts";
import { ALL_COLLECTIONS, die, pushOrReplace, tmpDir } from "./lib/utils.ts";
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
  const { collection, publisher, slug, source, manifest } = it;
  const prefix = `[${publisher}/${slug}] [${collection}]`;

  const { path: tempDir, cleanup: cleanupTempDir } = await tmpDir({
    unsafeCleanup: true,
  });
  console.log(`${prefix} Working directory: ${tempDir}`);

  await git.checkoutRepoAtCommit(tempDir, source);

  const sourceDir =
    source.path === undefined ? tempDir : path.join(tempDir, source.path);
  const remote = `${GHCR_REPO_PREFIX}/${collection}/${publisher}/${slug}`;

  const publishWidget = async () => {
    console.log(`::group::${prefix} Publishing...`);
    const pushResult = await oras.pushWidget({
      dir: sourceDir,
      source,
      manifest,
      remote,
    });
    console.log(pushResult);
    console.log("::endgroup::");
    console.log(`::notice::Published: https://${remote}@${pushResult.digest}`);

    const attestResult = await github.attestProvenance({
      name: remote,
      digest: pushResult.digest,
    });
    console.log(`::notice::Attested: oci://${remote}@${pushResult.digest}`);
    console.log(attestResult); // TODO: Replace with more useful information

    let publishedAt = new Date().toISOString();
    const createdAt =
      pushResult.annotations?.["org.opencontainers.image.created"];
    if (createdAt !== undefined) {
      publishedAt = createdAt;
    }

    await writeApiWidgetDetails(API_DIR, publisher, slug, {
      publishedAt,
      digest: pushResult.digest,
      manifest,
    });
    console.log(`${prefix} Details written`);

    return { publishedAt };
  };

  let publishResult;
  if (collection === "widgets") {
    publishResult = await publishWidget();
  } else {
    console.warn(`::warning::${prefix} Plugin publishing not supported yet`);
    await cleanupTempDir();
    continue;
  }

  await cleanupTempDir();

  await prependApiVersionsList(API_DIR, collection, publisher, slug, {
    version: manifest.version,
    publishedAt: publishResult.publishedAt,
  });
  console.log(`${prefix} Versions list updated`);

  const isPrivate = publisher === "deskulpt-test";
  const isOfficial = publisher === "deskulpt";
  const authorNames = manifest.authors.map((author) =>
    typeof author === "string" ? author : author.name,
  );

  const entry = {
    publisher,
    slug,
    version: manifest.version,
    name: manifest.name,
    description: manifest.description,
    authors: authorNames,
    private: isPrivate ? true : undefined,
    official: isOfficial ? true : undefined,
  };

  let entryIndex = apiIndex[collection].findIndex(
    (e) => e.publisher === publisher && e.slug === slug,
  );

  if (collection === "widgets") {
    pushOrReplace(apiIndex.widgets, entryIndex, entry);
  } else {
    // TODO: Add the plugins case when supported
  }
}

const now = new Date();
apiIndex.generatedAt = now.toISOString();

for (const collection of ALL_COLLECTIONS) {
  apiIndex[collection].sort((a, b) => {
    if (a.publisher !== b.publisher) {
      return a.publisher.localeCompare(b.publisher);
    }
    return a.slug.localeCompare(b.slug);
  });
}

await writeApiIndex(API_DIR, apiIndex);
console.log("Registry API index updated");
