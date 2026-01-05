import path from "node:path/posix";
import fs from "node:fs/promises";
import { z } from "zod";
import { SEMVER_REGEX } from "./utils.ts";

const AuthorSchema = z.union([
  z.string(),
  z.object({
    name: z.string(),
    email: z.email().optional(),
    url: z.url().optional(),
  }),
]);

// This is a stricter schema for publishing
const ManifestMetadataSchema = z.object({
  name: z.string().min(1).max(80),
  version: z.string().regex(SEMVER_REGEX),
  authors: z.array(AuthorSchema).min(1),
  license: z.string(),
  description: z.string().min(1).max(160),
  homepage: z.url(),
});

export const WidgetManifestSchema = ManifestMetadataSchema.extend({
  w: z.boolean().optional(),
});
export const PluginManifestSchema = ManifestMetadataSchema.extend({
  p: z.boolean().optional(),
});

export type ManifestMetadata = z.infer<typeof ManifestMetadataSchema>;
export type WidgetManifest = z.infer<typeof WidgetManifestSchema>;
export type PluginManifest = z.infer<typeof PluginManifestSchema>;

export async function parseWidgetManifest(dir: string) {
  const manifestFile = path.join(dir, "deskulpt.widget.json");
  const content = await fs.readFile(manifestFile, "utf-8");
  const data = JSON.parse(content);
  return WidgetManifestSchema.parse(data);
}

export async function parsePluginManifest(dir: string) {
  const manifestFile = path.join(dir, "deskulpt.plugin.json");
  const content = await fs.readFile(manifestFile, "utf-8");
  const data = JSON.parse(content);
  return PluginManifestSchema.parse(data);
}
