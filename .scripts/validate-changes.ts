import path from "node:path/posix";
import fs from "node:fs/promises";
import deepEqual from "fast-deep-equal";
import semver from "semver";
import spdxParse from "spdx-expression-parse";
import spdxSatisfies from "spdx-satisfies";
import * as git from "./lib/git.ts";
import * as oras from "./lib/oras.ts";
import { die, tmpDir } from "./lib/utils.ts";
import { exec } from "./lib/process.ts";
import {
  PublishPlanEntry,
  SAFE_IDENTIFIER_REGEX,
  parseWidgetManifest,
  parseWidgets,
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

const publishPlan = await fs.open(PUBLISH_PLAN_PATH, "w");

for (const publisher of changedPublishers) {
  console.log(`[${publisher}] Validating widgets...`);

  if (!SAFE_IDENTIFIER_REGEX.test(publisher)) {
    die(
      `[${publisher}] Invalid publisher identifier; expected to match ${SAFE_IDENTIFIER_REGEX}`,
    );
  }

  const baseWidgets = (await parseWidgets(publisher, BASE_SHA)) ?? {};
  const headWidgets = (await parseWidgets(publisher, HEAD_SHA)) ?? {};

  for (const slug of Object.keys(baseWidgets)) {
    if (!(slug in headWidgets)) {
      die(`[${publisher}/${slug}] Published widget cannot be deleted`);
    }
  }

  for (const [slug, widget] of Object.entries(headWidgets)) {
    const baseWidget = baseWidgets[slug];
    if (baseWidget === undefined) {
      console.log(`[${publisher}/${slug}] Validating new widget...`);
    } else {
      if (deepEqual(baseWidget, widget)) {
        console.log(`[${publisher}/${slug}] Skipping unchanged widget`);
        continue;
      }
      console.log(`[${publisher}/${slug}] Validating updated widget...`);
    }

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

    const widgetDir =
      widget.path === undefined ? tempDir : path.join(tempDir, widget.path);
    const manifest = await parseWidgetManifest(widgetDir);

    if (semver.valid(widget.version) === null) {
      die(
        `[${publisher}/${slug}] Widget version is not valid semver: ${widget.version}`,
      );
    }

    if (manifest.version !== widget.version) {
      die(
        `[${publisher}/${slug}] Widget version mismatch: ${manifest.version} (manifest) vs. ${widget.version} (declared)`,
      );
    }

    if (
      baseWidget !== undefined &&
      semver.gte(baseWidget.version, widget.version)
    ) {
      die(
        `[${publisher}/${slug}] Updating an existing widget must increment its version: ${baseWidget.version} -> ${widget.version}`,
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
        widgetDir,
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
      src: widgetDir,
      dst: path.join(tempDir, "dist"),
      widget,
      manifest,
      dryRun: true,
    });
    console.log(pushResult);
    console.log(`::endgroup::`);

    console.log(`::group::[${publisher}/${slug}] Writing plan...`);
    const planEntry: PublishPlanEntry = { publisher, slug, widget, manifest };
    await publishPlan.write(JSON.stringify(planEntry) + "\n");
    console.log(planEntry);
    console.log(`::endgroup::`);

    await cleanupTempDir();
  }
}

await publishPlan.close();
console.log(
  `Validation complete, publish plan written to ${PUBLISH_PLAN_PATH}`,
);
