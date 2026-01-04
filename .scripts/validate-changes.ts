import path from "node:path/posix";
import deepEqual from "fast-deep-equal";
import semver from "semver";
import spdxParse from "spdx-expression-parse";
import spdxSatisfies from "spdx-satisfies";
import * as git from "./lib/git.ts";
import * as oras from "./lib/oras.ts";
import { die, tmpDir } from "./lib/utils.ts";
import { exec } from "./lib/process.ts";
import { parseWidgetManifest } from "./lib/manifest.ts";
import {
  PublishPlan,
  SAFE_IDENTIFIER_REGEX,
  parseSources,
  writePublishPlan,
} from "./lib/schema.ts";

for (const varName of [
  "BASE_SHA",
  "HEAD_SHA",
  "CHANGED_PUBLISHERS",
  "PUBLISH_PLAN_PATH",
]) {
  if (process.env[varName] === undefined) {
    die(`Missing required environment variable: ${varName}`);
  }
}

const BASE_SHA = process.env["BASE_SHA"]!;
const HEAD_SHA = process.env["HEAD_SHA"]!;
const CHANGED_PUBLISHERS = process.env["CHANGED_PUBLISHERS"]!;
const PUBLISH_PLAN_PATH = process.env["PUBLISH_PLAN_PATH"]!;
const LICENSE_DETECTION_SCRIPT = process.env["LICENSE_DETECTION_SCRIPT"];

const changedPublishers = CHANGED_PUBLISHERS.trim()
  .split(/\s+/)
  .filter(Boolean);
if (changedPublishers.length === 0) {
  console.log("No publishers provided, skipping validation");
  process.exit(0);
}

const ACCEPTED_LICENSES = ["Apache-2.0", "BSD-3-Clause", "MIT"];

function extractSpdx(spdx: string) {
  const spdxIds = new Set<string>();
  const parsed = spdxParse(spdx);

  const nodeIsLicenseInfo = (
    node: spdxParse.Info,
  ): node is spdxParse.LicenseInfo =>
    (node as spdxParse.LicenseInfo).license !== undefined;

  const nodeIsConjunctionInfo = (
    node: spdxParse.Info,
  ): node is spdxParse.ConjunctionInfo =>
    (node as spdxParse.ConjunctionInfo).conjunction !== undefined;

  const visit = (node: spdxParse.Info) => {
    if (nodeIsLicenseInfo(node)) {
      const spdxId = node.plus ? `${node.license}+` : node.license;
      if (ACCEPTED_LICENSES.includes(spdxId)) {
        spdxIds.add(spdxId);
      }
    } else if (nodeIsConjunctionInfo(node)) {
      visit(node.left);
      visit(node.right);
    }
  };

  visit(parsed);
  return spdxIds;
}

const publishPlan: PublishPlan = [];

for (const publisher of changedPublishers) {
  console.log(`[${publisher}] Validating widgets...`);

  if (!SAFE_IDENTIFIER_REGEX.test(publisher)) {
    die(
      `[${publisher}] Invalid publisher identifier; expected to match ${SAFE_IDENTIFIER_REGEX}`,
    );
  }

  const baseSources =
    (await parseSources("widgets", publisher, BASE_SHA)) ?? {};
  const headSources =
    (await parseSources("widgets", publisher, HEAD_SHA)) ?? {};

  for (const slug of Object.keys(baseSources)) {
    if (!(slug in headSources)) {
      die(`[${publisher}/${slug}] Published widget cannot be deleted`);
    }
  }

  for (const [slug, source] of Object.entries(headSources)) {
    const baseSource = baseSources[slug];
    if (baseSource === undefined) {
      console.log(`[${publisher}/${slug}] Validating new widget...`);
    } else {
      if (deepEqual(baseSource, source)) {
        console.log(`[${publisher}/${slug}] Skipping unchanged widget`);
        continue;
      }
      console.log(`[${publisher}/${slug}] Validating updated widget...`);
    }

    const { path: tempDir, cleanup: cleanupTempDir } = await tmpDir({
      unsafeCleanup: true,
    });
    console.log(`[${publisher}/${slug}] Working directory: ${tempDir}`);

    await git.checkoutRepoAtCommit(tempDir, source);

    const sourceDir =
      source.path === undefined ? tempDir : path.join(tempDir, source.path);
    const manifest = await parseWidgetManifest(sourceDir);

    if (semver.valid(source.version) === null) {
      die(
        `[${publisher}/${slug}] Widget version is not valid semver: ${source.version}`,
      );
    }

    if (manifest.version !== source.version) {
      die(
        `[${publisher}/${slug}] Widget version mismatch: ${manifest.version} (manifest) vs. ${source.version} (declared)`,
      );
    }

    if (
      baseSource !== undefined &&
      semver.gte(baseSource.version, source.version)
    ) {
      die(
        `[${publisher}/${slug}] Updating an existing widget must increment its version: ${baseSource.version} -> ${source.version}`,
      );
    }

    if (!spdxSatisfies(manifest.license, ACCEPTED_LICENSES)) {
      die(
        `[${publisher}/${slug}] License "${manifest.license}" not accepted; accepted licenses: ${ACCEPTED_LICENSES.join(", ")}`,
      );
    }

    if (LICENSE_DETECTION_SCRIPT !== undefined) {
      const result = await exec("bash", [
        "-c",
        LICENSE_DETECTION_SCRIPT,
        "_",
        sourceDir,
      ]);
      const detectedLicenses = result.stdout
        .trim()
        .split(/\s+/)
        .filter(Boolean);

      const spdxIds = extractSpdx(manifest.license);
      for (const spdxId of spdxIds) {
        if (!detectedLicenses.includes(spdxId)) {
          die(
            `[${publisher}/${slug}] License "${spdxId}" declared but not detected in the widget source; detected licenses are: ${detectedLicenses.join(", ")}`,
          );
        }
      }
    }

    console.log(`[${publisher}/${slug}] Validation passed`);

    console.log(
      `::group::[${publisher}/${slug}] Packaging widget (dry run)...`,
    );
    const pushResult = await oras.push({
      src: sourceDir,
      dst: path.join(tempDir, "dist"),
      source,
      manifest,
      dryRun: true,
    });
    console.log(pushResult);
    console.log(`::endgroup::`);

    await cleanupTempDir();

    publishPlan.push({ publisher, slug, source, manifest });
  }
}

await writePublishPlan(PUBLISH_PLAN_PATH, publishPlan);
console.log(
  `Validation complete, publish plan written to ${PUBLISH_PLAN_PATH}`,
);
