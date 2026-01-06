import path from "node:path/posix";
import fs from "node:fs/promises";
import yaml from "yaml";
import { z } from "zod";
import * as git from "./git.ts";
import { GitSourceSchema } from "./git.ts";
import { PluginManifestSchema, WidgetManifestSchema } from "./manifest.ts";
import { SEMVER_REGEX } from "./utils.ts";

// Safe identifier: lowercase letters, digits, underscores, hyphens; no leading,
// trailing, or consecutive underscores or hyphens.
export const SAFE_IDENTIFIER_REGEX = /^[a-z0-9]+(?:[_-][a-z0-9]+)*$/;

const PublisherSchema = z
  .object({
    organization: z.int().optional(),
    user: z.int().optional(),
    extraMaintainers: z.array(z.int()).optional(),
  })
  .refine(
    (data) => (data.organization !== undefined) !== (data.user !== undefined),
    {
      error: "Exactly one of organization or user should be provided",
    },
  );

const SourcesSchema = z.record(
  z.string().regex(SAFE_IDENTIFIER_REGEX),
  GitSourceSchema.extend({
    version: z.string().regex(SEMVER_REGEX),
  }),
);

const PublishPlanEntryBaseSchema = z.object({
  publisher: z.string(),
  slug: z.string(),
  source: GitSourceSchema,
});

const PublishPlanEntrySchema = z.discriminatedUnion("collection", [
  PublishPlanEntryBaseSchema.extend({
    collection: z.literal("widgets"),
    manifest: WidgetManifestSchema,
  }),
  PublishPlanEntryBaseSchema.extend({
    collection: z.literal("plugins"),
    manifest: PluginManifestSchema,
  }),
]);

const PublishPlanSchema = z.array(PublishPlanEntrySchema);

export type PublishPlan = z.infer<typeof PublishPlanSchema>;

export async function parsePublisher(entry: string, commit: string) {
  const entryFile = path.join("publishers", `${entry}.yaml`);
  if (!(await git.fileExistsAtCommit(entryFile, commit))) {
    return;
  }
  const content = await git.showFileAtCommit(entryFile, commit);
  const data = yaml.parse(content);
  return PublisherSchema.parse(data);
}

export async function parseSources(dir: string, entry: string, commit: string) {
  const entryFile = path.join(dir, `${entry}.yaml`);
  if (!(await git.fileExistsAtCommit(entryFile, commit))) {
    return {};
  }
  const content = await git.showFileAtCommit(entryFile, commit);
  const data = yaml.parse(content);
  return SourcesSchema.parse(data);
}

export async function parsePublishPlan(file: string) {
  const content = await fs.readFile(file, "utf-8");
  const data = JSON.parse(content);
  return PublishPlanSchema.parse(data);
}

export async function writePublishPlan(file: string, plan: PublishPlan) {
  const content = JSON.stringify(plan);
  await fs.writeFile(file, content, "utf-8");
}
