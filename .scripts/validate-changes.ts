import path from "node:path/posix";
import deepEqual from "fast-deep-equal";
import semver from "semver";
import * as git from "./lib/git.ts";
import * as oras from "./lib/oras.ts";
import * as tmp from "./lib/tmp.ts";
import { ALL_COLLECTIONS, Collection, die } from "./lib/utils.ts";
import {
  ManifestMetadata,
  PluginManifest,
  WidgetManifest,
  parsePluginManifest,
  parseWidgetManifest,
} from "./lib/manifest.ts";
import {
  PublishPlan,
  SAFE_IDENTIFIER_REGEX,
  parseSources,
  writePublishPlan,
} from "./lib/schema.ts";
import { validateLicense } from "./lib/license.ts";

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

const changedPublishers = CHANGED_PUBLISHERS.trim()
  .split(/\s+/)
  .filter(Boolean);
if (changedPublishers.length === 0) {
  console.log("No publishers provided, skipping validation");
  process.exit(0);
}

const publishPlan: PublishPlan = [];

for (const publisher of changedPublishers) {
  if (!SAFE_IDENTIFIER_REGEX.test(publisher)) {
    die(
      `[${publisher}] Invalid publisher identifier; expected to match ${SAFE_IDENTIFIER_REGEX}`,
    );
  }

  for (const collection of ALL_COLLECTIONS) {
    await validateCollection(publisher, collection);
  }
}

await writePublishPlan(PUBLISH_PLAN_PATH, publishPlan);
console.log(`Publish plan written to: ${PUBLISH_PLAN_PATH}`);

async function validateCollection(publisher: string, collection: Collection) {
  console.log(`[${publisher}] Validating ${collection}...`);

  const baseSources = await parseSources(collection, publisher, BASE_SHA);
  const headSources = await parseSources(collection, publisher, HEAD_SHA);

  for (const slug of Object.keys(baseSources)) {
    if (!(slug in headSources)) {
      die(
        `[${publisher}/${slug}] [${collection}] Cannot delete published item`,
      );
    }
  }

  for (const [slug, source] of Object.entries(headSources)) {
    const prefix = `[${publisher}/${slug}] [${collection}]`;
    const baseSource = baseSources[slug];

    if (baseSource === undefined) {
      console.log(`${prefix} New`);
    } else {
      if (deepEqual(baseSource, source)) {
        console.log(`${prefix} Unchanged: skipped`);
        continue;
      }
      console.log(`${prefix} Updated`);
    }

    if (semver.valid(source.version) === null) {
      die(`${prefix} Invalid semver: ${source.version}`);
    }

    if (
      baseSource !== undefined &&
      semver.gte(baseSource.version, source.version)
    ) {
      die(
        `${prefix} Version must be incremented: ${baseSource.version} -> ${source.version}`,
      );
    }

    const tempDir = await tmp.dir({ unsafeCleanup: true });
    console.log(`${prefix} Working directory: ${tempDir.path}`);

    await git.checkoutRepoAtCommit(tempDir.path, source);

    const sourceDir =
      source.path === undefined
        ? tempDir.path
        : path.join(tempDir.path, source.path);

    const validateManifestMetadata = async (manifest: ManifestMetadata) => {
      if (manifest.version !== source.version) {
        die(
          `${prefix} Version mismatch: ${manifest.version} (manifest) vs. ${source.version} (declared)`,
        );
      }

      try {
        await validateLicense(manifest.license, { base: sourceDir });
      } catch (error) {
        die(`${prefix} License validation failed: ${error}`);
      }

      console.log(`${prefix} Metadata validation passed`);
    };

    const validateWidgetManifest = async (manifest: WidgetManifest) => {
      console.log(`::group::${prefix} Packaging widget (dry run)...`);
      const pushResult = await oras.pushWidget({
        dir: sourceDir,
        source,
        manifest,
      });
      console.log(pushResult);
      console.log(`::endgroup::`);

      console.log(`${prefix} Widget manifest validation passed`);
    };

    const validatePluginManifest = async (_manifest: PluginManifest) => {
      // TODO: Add plugin-specific validations here in the future
      await Promise.resolve();
      console.warn(`::warning::${prefix} Plugin not fully supported yet`);
    };

    if (collection === "widgets") {
      const manifest = await parseWidgetManifest(sourceDir);
      await validateManifestMetadata(manifest);
      await validateWidgetManifest(manifest);
      publishPlan.push({ collection, publisher, slug, source, manifest });
    } else {
      const manifest = await parsePluginManifest(sourceDir);
      await validateManifestMetadata(manifest);
      await validatePluginManifest(manifest);
      publishPlan.push({ collection, publisher, slug, source, manifest });
    }

    await tempDir.cleanup();
  }
}
