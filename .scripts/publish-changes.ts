import path from "node:path/posix";
import fs from "node:fs/promises";
import * as git from "./lib/git.ts";
import * as github from "./lib/github.ts";
import * as oras from "./lib/oras.ts";
import * as tmp from "./lib/tmp.ts";
import { ALL_COLLECTIONS, die, pushOrReplace } from "./lib/utils.ts";
import { parsePublishPlan } from "./lib/schema.ts";
import {
  parseApiIndex,
  prependApiVersionsList,
  writeApiIndex,
  writeApiWidgetDetails,
} from "./lib/api.ts";

for (const varName of [
  "GITHUB_REPOSITORY",
  "GITHUB_REPOSITORY_OWNER",
  "PUBLISH_PLAN_PATH",
  "API_DIR",
  "API_VERSION",
]) {
  if (process.env[varName] === undefined) {
    die(`Missing required environment variable: ${varName}`);
  }
}

const GITHUB_REPOSITORY = process.env["GITHUB_REPOSITORY"]!;
const GITHUB_REPOSITORY_OWNER = process.env["GITHUB_REPOSITORY_OWNER"]!;
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

  const tempDir = await tmp.dir({ unsafeCleanup: true });
  console.log(`${prefix} Working directory: ${tempDir.path}`);

  await git.checkoutRepoAtCommit(tempDir.path, source);

  const sourceDir =
    source.path === undefined
      ? tempDir.path
      : path.join(tempDir.path, source.path);
  const remote = `ghcr.io/${GITHUB_REPOSITORY_OWNER.toLowerCase()}/${collection}/${publisher}/${slug}`;

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
    console.log(`::notice::${prefix} Published: https://${remote}`);

    if (process.env["SKIP_ATTESTATION"] !== "1") {
      const attestationId = await github.attestProvenance({
        name: remote,
        digest: pushResult.digest,
      });
      console.log(
        `::notice::${prefix} Attested: https://github.com/${GITHUB_REPOSITORY}/attestations/${attestationId}`,
      );
    }

    let publishedAt = new Date().toISOString();
    const createdAt =
      pushResult.annotations?.["org.opencontainers.image.created"];
    if (createdAt !== undefined) {
      publishedAt = createdAt;
    }

    await writeApiWidgetDetails(API_DIR, publisher, slug, {
      publishedAt,
      digest: pushResult.digest,
      source,
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
    await tempDir.cleanup();
    continue;
  }

  await tempDir.cleanup();

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
