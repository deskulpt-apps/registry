import path from "node:path/posix";
import fs from "node:fs/promises";
import yaml from "yaml";
import { z } from "zod";
import * as git from "./git.ts";

// See FAQ of https://semver.org/
export const SEMVER_REGEX =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

export const SAFE_ID_REGEX = /^[a-zA-Z0-9-_]+$/;

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

const WidgetSchema = z.object({
  version: z.string().regex(SEMVER_REGEX),
  repo: z.url(),
  commit: z.union([z.hash("sha1"), z.hash("sha256")]),
  path: z.string().optional(),
});

const WidgetsSchema = z.record(z.string().regex(SAFE_ID_REGEX), WidgetSchema);

const WidgetManifestAuthorSchema = z.union([
  z.string(),
  z.object({
    name: z.string(),
    email: z.email().optional(),
    url: z.url().optional(),
  }),
]);

// Widget manifest schema deskulpt.widget.json, but only keeping the fields we
// care about with stricter validation for widgets to be published
const WidgetManifestSchema = z.object({
  name: z.string().max(80),
  version: z.string().regex(SEMVER_REGEX),
  authors: z.array(WidgetManifestAuthorSchema).min(1),
  license: z.string(),
  description: z.string().max(160),
  homepage: z.url(),
});

const PublishPlanEntrySchema = z.object({
  handle: z.string(),
  id: z.string(),
  widget: WidgetSchema,
  manifest: WidgetManifestSchema,
});

const PublishPlanSchema = z.array(PublishPlanEntrySchema);

const OrasPushOutputSchema = z.object({
  // https://github.com/opencontainers/image-spec/blob/26647a49f642c7d22a1cd3aa0a48e4650a542269/specs-go/v1/descriptor.go#L22
  mediaType: z.string(),
  digest: z.string(),
  size: z.int(),
  urls: z.array(z.string()).optional(),
  annotations: z.record(z.string(), z.string()).optional(),
  data: z.base64().optional(),
  platform: z.object().optional(),
  artifactType: z.string().optional(),
  // https://github.com/oras-project/oras/blob/6c3e3e5a3e087ef2881cebb310f3d5fb6348b2ab/cmd/oras/internal/display/metadata/model/descriptor.go#L37
  reference: z.string(),
  // https://github.com/oras-project/oras/blob/6c3e3e5a3e087ef2881cebb310f3d5fb6348b2ab/cmd/oras/internal/display/metadata/model/push.go#L29
  referenceAsTags: z.array(z.string()),
});

const RegistryEntryReleaseSchema = z.object({
  version: z.string(),
  publishedAt: z.iso.datetime(),
  digest: z.string(),
});

const RegistryEntrySchema = z.object({
  handle: z.string(),
  id: z.string(),
  name: z.string(),
  authors: z.array(WidgetManifestAuthorSchema).min(1),
  description: z.string(),
  homepage: z.url(),
  releases: z.array(RegistryEntryReleaseSchema).min(1),
});

const RegistryIndexSchema = z.object({
  api: z.int(),
  generatedAt: z.iso.datetime(),
  widgets: z.array(RegistryEntrySchema),
});

export async function parsePublisher(entry: string, commit: string) {
  const entryFile = path.join("publishers", `${entry}.yaml`);
  if (!(await git.fileExistsAtCommit(entryFile, commit))) {
    return;
  }
  const content = await git.showFileAtCommit(entryFile, commit);
  const data = yaml.parse(content);
  return PublisherSchema.parse(data);
}

export async function parseWidgets(entry: string, commit: string) {
  const entryFile = path.join("widgets", `${entry}.yaml`);
  if (!(await git.fileExistsAtCommit(entryFile, commit))) {
    return;
  }
  const content = await git.showFileAtCommit(entryFile, commit);
  const data = yaml.parse(content);
  return WidgetsSchema.parse(data);
}

export async function parseWidgetManifest(dir: string) {
  const manifestFile = path.join(dir, "deskulpt.widget.json");
  const content = await fs.readFile(manifestFile, "utf-8");
  const data = JSON.parse(content);
  return WidgetManifestSchema.parse(data);
}

export async function parsePublishPlan(file: string) {
  const content = await fs.readFile(file, "utf-8");
  const data = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  return PublishPlanSchema.parse(data);
}

export function parseOrasPushOutput(output: string) {
  const obj = JSON.parse(output);
  return OrasPushOutputSchema.parse(obj);
}

export async function parseRegistryIndex(dir: string) {
  const indexFile = path.join(dir, "index.json");
  const content = await fs.readFile(indexFile, "utf-8");
  const data = JSON.parse(content);
  return RegistryIndexSchema.parse(data);
}

export async function writeRegistryIndex(dir: string, index: RegistryIndex) {
  const indexFile = path.join(dir, "index.json");
  const content = JSON.stringify(index);
  await fs.writeFile(indexFile, content, "utf-8");
}

export type Publisher = z.infer<typeof PublisherSchema>;
export type Widget = z.infer<typeof WidgetSchema>;
export type Widgets = z.infer<typeof WidgetsSchema>;
export type WidgetManifest = z.infer<typeof WidgetManifestSchema>;
export type PublishPlanEntry = z.infer<typeof PublishPlanEntrySchema>;
export type PublishPlan = z.infer<typeof PublishPlanSchema>;
export type OrasPushOutput = z.infer<typeof OrasPushOutputSchema>;
export type RegistryEntryRelease = z.infer<typeof RegistryEntryReleaseSchema>;
export type RegistryEntry = z.infer<typeof RegistryEntrySchema>;
export type RegistryIndex = z.infer<typeof RegistryIndexSchema>;
