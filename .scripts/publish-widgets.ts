import path from "node:path/posix";
import * as git from "./lib/git.ts";
import * as github from "./lib/github.ts";
import * as oras from "./lib/oras.ts";
import * as tmp from "./lib/tmp.ts";
import { WidgetsApi } from "./lib/api.ts";
import { die } from "./lib/utils.ts";
import { parsePublishPlan } from "./lib/schema.ts";

for (const varName of [
  "GITHUB_REPOSITORY",
  "GITHUB_REPOSITORY_OWNER",
  "PUBLISH_PLAN_PATH",
  "API_DIR",
]) {
  if (process.env[varName] === undefined) {
    die(`Missing required environment variable: ${varName}`);
  }
}

const GITHUB_REPOSITORY = process.env["GITHUB_REPOSITORY"]!;
const GITHUB_REPOSITORY_OWNER = process.env["GITHUB_REPOSITORY_OWNER"]!;
const PUBLISH_PLAN_PATH = process.env["PUBLISH_PLAN_PATH"]!;
const API_DIR = process.env["API_DIR"]!;

const api = new WidgetsApi(API_DIR);
await api.init();

const publishPlan = await parsePublishPlan(PUBLISH_PLAN_PATH);

for (const it of publishPlan) {
  const { publisher, slug, source, manifest } = it;
  if (it.collection !== "widgets") {
    continue;
  }
  const prefix = `[${publisher}/${slug}]`;

  const tempDir = await tmp.dir({ unsafeCleanup: true });
  console.log(`${prefix} Working directory: ${tempDir.path}`);

  await git.checkoutRepoAtCommit(tempDir.path, source);

  const sourceDir =
    source.path === undefined
      ? tempDir.path
      : path.join(tempDir.path, source.path);
  const remote = `ghcr.io/${GITHUB_REPOSITORY_OWNER.toLowerCase()}/widgets/${publisher}/${slug}`;

  const bundler = new oras.WidgetBundler(sourceDir, source, manifest);

  console.log(`::group::${prefix} Bundling...`);
  const bundleResult = await bundler.bundle();
  console.log(bundleResult);
  console.log("::endgroup::");

  let publishedAt = new Date().toISOString();
  const createdAt =
    bundleResult.annotations?.["org.opencontainers.image.created"];
  if (createdAt !== undefined) {
    publishedAt = createdAt;
  }

  await api.update({
    publisher,
    slug,
    source,
    sourceDir,
    manifest,
    publishedAt,
    digest: bundleResult.digest,
  });

  await bundler.push(remote);
  console.log(`::notice::${prefix} Published: https://${remote}`);

  await tempDir.cleanup();

  if (process.env["SKIP_ATTESTATION"] !== "1") {
    const attestationId = await github.attestProvenance({
      name: remote,
      digest: bundleResult.digest,
    });
    console.log(
      `::notice::${prefix} Attested: https://github.com/${GITHUB_REPOSITORY}/attestations/${attestationId}`,
    );
  }
}

await api.flush();
console.log("Registry API index updated");
