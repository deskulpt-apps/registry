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

// Widget manifest schema deskulpt.widget.json, but only keeping the fields we
// care about with stricter validation for widgets to be published
export const WidgetManifestSchema = z.object({
  name: z.string().min(1).max(80),
  version: z.string().regex(SEMVER_REGEX),
  authors: z.array(AuthorSchema).min(1),
  license: z.string(),
  description: z.string().min(1).max(160),
  homepage: z.url(),
});

export type WidgetManifest = z.infer<typeof WidgetManifestSchema>;

export async function parseWidgetManifest(dir: string) {
  const manifestFile = path.join(dir, "deskulpt.widget.json");
  const content = await fs.readFile(manifestFile, "utf-8");
  const data = JSON.parse(content);
  return WidgetManifestSchema.parse(data);
}
