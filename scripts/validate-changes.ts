import path from "node:path/posix";
import fs from "node:fs/promises";
import deepEqual from "fast-deep-equal";
import semver from "semver";
import spdxParse from "spdx-expression-parse";
import spdxSatisfies from "spdx-satisfies";
import * as git from "./lib/git.ts";
import * as oras from "./lib/oras.ts";
import { die } from "./lib/utils.ts";
import { exec } from "./lib/process.ts";
import {
  parseWidgetManifest,
  parseWidgets,
  SAFE_ID_REGEX,
  PublishPlanEntry,
} from "./lib/schema.ts";

for (const varName of [
  "BASE_SHA",
  "HEAD_SHA",
  "CHANGED_HANDLES",
  "PUBLISH_PLAN_PATH",
]) {
  if (process.env[varName] === undefined) {
    die(`Missing required environment variable: ${varName}`);
  }
}

const BASE_SHA = process.env["BASE_SHA"]!;
const HEAD_SHA = process.env["HEAD_SHA"]!;
const CHANGED_HANDLES = process.env["CHANGED_HANDLES"]!;
const PUBLISH_PLAN_PATH = process.env["PUBLISH_PLAN_PATH"]!;
const LICENSE_DETECTION_SCRIPT = process.env["LICENSE_DETECTION_SCRIPT"];

const changedHandles = CHANGED_HANDLES.trim().split(/\s+/).filter(Boolean);
if (changedHandles.length === 0) {
  console.log("No handles provided, skipping validation");
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
      if (!ACCEPTED_LICENSES.includes(spdxId)) {
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

const TEMP_DIR = path.resolve("temp");

const publishPlan = await fs.open(PUBLISH_PLAN_PATH, "w");

for (const handle of changedHandles) {
  console.log(`[${handle}] Validating widgets...`);

  if (!SAFE_ID_REGEX.test(handle)) {
    die(
      `[${handle}] Invalid publisher handle; expected to match ${SAFE_ID_REGEX}`,
    );
  }

  const baseWidgets = (await parseWidgets(handle, BASE_SHA)) ?? {};
  const headWidgets = (await parseWidgets(handle, HEAD_SHA)) ?? {};

  for (const id of Object.keys(baseWidgets)) {
    if (!(id in headWidgets)) {
      die(`[${handle}/${id}] Published widget cannot be deleted`);
    }
  }

  for (const [id, widget] of Object.entries(headWidgets)) {
    const baseWidget = baseWidgets[id];
    if (baseWidget === undefined) {
      console.log(`[${handle}/${id}] Validating new widget...`);
    } else {
      if (deepEqual(baseWidget, widget)) {
        console.log(`[${handle}/${id}] Skipping unchanged widget`);
        continue;
      }
      console.log(`[${handle}/${id}] Validating updated widget...`);
    }

    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await git.checkoutRepoAtCommit(
      TEMP_DIR,
      widget.repo,
      widget.commit,
      widget.path,
    );

    const widgetDir =
      widget.path === undefined ? TEMP_DIR : path.join(TEMP_DIR, widget.path);
    const manifest = await parseWidgetManifest(widgetDir);

    if (semver.valid(widget.version) === null) {
      die(
        `[${handle}/${id}] Widget version is not valid semver: ${widget.version}`,
      );
    }

    if (manifest.version !== widget.version) {
      die(
        `[${handle}/${id}] Widget version mismatch: ${manifest.version} (manifest) vs. ${widget.version} (declared)`,
      );
    }

    if (
      baseWidget !== undefined &&
      semver.gte(baseWidget.version, widget.version)
    ) {
      die(
        `[${handle}/${id}] Updating an existing widget must increment its version: ${baseWidget.version} -> ${widget.version}`,
      );
    }

    if (!spdxSatisfies(manifest.license, ACCEPTED_LICENSES)) {
      die(
        `[${handle}/${id}] License "${manifest.license}" not accepted; accepted licenses: ${ACCEPTED_LICENSES.join(", ")}`,
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
            `[${handle}/${id}] License "${spdxId}" declared but not detected in the widget source; detected licenses are: ${detectedLicenses.join(", ")}`,
          );
        }
      }
    }

    console.log(`[${handle}/${id}] Validation passed`);

    console.log(`::group::[${handle}/${id}] Packaging widget (dry run)...`);
    const pushResult = await oras.push({
      src: widgetDir,
      dst: path.join(TEMP_DIR, "dist"),
      widget,
      manifest,
      dryRun: true,
    });
    console.log(pushResult);
    console.log(`::endgroup::`);

    console.log(`::group::[${handle}/${id}] Writing plan...`);
    const planEntry: PublishPlanEntry = { handle, id, widget, manifest };
    await publishPlan.write(JSON.stringify(planEntry) + "\n");
    console.log(planEntry);
    console.log(`::endgroup::`);
  }
}

await publishPlan.close();
console.log(
  `Validation complete, publish plan written to ${PUBLISH_PLAN_PATH}`,
);
