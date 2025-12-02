import path from "node:path/posix";
import fs from "node:fs/promises";
import * as git from "./lib/git.ts";
import * as oras from "./lib/oras.ts";
import { die } from "./lib/utils.ts";
import {
  parsePublishPlan,
  parseRegistryIndex,
  writeRegistryIndex,
} from "./lib/schema.ts";

for (const varName of [
  "GHCR_REPO_PREFIX",
  "PUBLISH_PLAN_PATH",
  "REGISTRY_DIR",
]) {
  if (process.env[varName] === undefined) {
    die(`Missing required environment variable: ${varName}`);
  }
}

const GHCR_REPO_PREFIX = process.env["GHCR_REPO_PREFIX"]!;
const PUBLISH_PLAN_PATH = process.env["PUBLISH_PLAN_PATH"]!;
const REGISTRY_DIR = process.env["REGISTRY_DIR"]!;

const TEMP_DIR = path.resolve("temp");

const publishPlan = await parsePublishPlan(PUBLISH_PLAN_PATH);
const registryUpdatePlan = [];

for (const it of publishPlan) {
  const { handle, id, widget, manifest } = it;
  await fs.rm(TEMP_DIR, { recursive: true, force: true });
  await git.checkoutRepoAtCommit(
    TEMP_DIR,
    widget.repo,
    widget.commit,
    widget.path,
  );

  console.log(`::group::[${handle}/${id}] Publishing widget...`);
  const widgetDir =
    widget.path === undefined ? TEMP_DIR : path.join(TEMP_DIR, widget.path);
  const remote = `${GHCR_REPO_PREFIX}/${handle}/${id}`;
  const pushResult = await oras.push({
    src: widgetDir,
    dst: remote,
    widget,
    manifest,
  });
  console.log(pushResult);
  console.log("::endgroup::");
  console.log(`::notice::Published: https://${remote}@${pushResult.digest}`);

  registryUpdatePlan.push({ ...it, digest: pushResult.digest });
}

const now = new Date();
await fs.mkdir(REGISTRY_DIR, { recursive: true });
const registryIndex = await parseRegistryIndex(REGISTRY_DIR);
registryIndex.generated = now.toISOString();

console.log("Updating registry index...");

for (const it of registryUpdatePlan) {
  const { handle, id, widget, manifest, digest } = it;
  let entry = registryIndex.widgets.find(
    (e) => e.handle === handle && e.id === id,
  );

  if (entry === undefined) {
    entry = {
      handle,
      id,
      name: manifest.name,
      authors: JSON.stringify(manifest.authors),
      description: manifest.description,
      versions: [[widget.version, digest]],
    };
    registryIndex.widgets.push(entry);
    console.log(`::group::[${handle}/${id}] Added new entry`);
    console.log(entry);
    console.log("::endgroup::");
    continue;
  }

  entry.name = manifest.name;
  entry.authors = JSON.stringify(manifest.authors);
  entry.description = manifest.description;
  entry.versions.unshift([widget.version, digest]); // Prepend new version
  console.log(`::group::[${handle}/${id}] Updated entry`);
  console.log(entry);
  console.log("::endgroup::");
}

registryIndex.widgets.sort((a, b) => {
  if (a.handle !== b.handle) {
    return a.handle.localeCompare(b.handle);
  }
  return a.id.localeCompare(b.id);
});

await writeRegistryIndex(REGISTRY_DIR, registryIndex);
console.log("Registry index updated");
