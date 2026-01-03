import path from "node:path/posix";
import fs from "node:fs/promises";
import { z } from "zod";
import { WidgetManifestSchema } from "./manifest.ts";

const ApiIndexWidgetSchema = z.object({
  publisher: z.string(),
  slug: z.string(),
  version: z.string(),
  name: z.string(),
  description: z.string(),
  authors: z.array(z.string()),
  private: z.boolean().optional(),
  official: z.boolean().optional(),
});

const ApiIndexSchema = z.object({
  api: z.string(),
  generatedAt: z.iso.datetime(),
  widgets: z.array(ApiIndexWidgetSchema),
});

const ApiVersionsListSchema = z.array(
  z.object({
    version: z.string(),
    publishedAt: z.iso.datetime(),
  }),
);

const ApiWidgetDetailsSchema = z.object({
  publishedAt: z.iso.datetime(),
  digest: z.string(),
  manifest: WidgetManifestSchema,
});

export type ApiIndex = z.infer<typeof ApiIndexSchema>;
export type ApiVersionsList = z.infer<typeof ApiVersionsListSchema>;
export type ApiWidgetDetails = z.infer<typeof ApiWidgetDetailsSchema>;

export async function parseApiIndex(dir: string) {
  const indexFile = path.join(dir, "index.json");
  const content = await fs.readFile(indexFile, "utf-8");
  const data = JSON.parse(content);
  return ApiIndexSchema.parse(data);
}

export async function writeApiIndex(dir: string, index: ApiIndex) {
  const indexFile = path.join(dir, "index.json");
  const content = JSON.stringify(index);
  await fs.writeFile(indexFile, content, "utf-8");
}

export async function prependApiVersionsList(
  dir: string,
  publisher: string,
  slug: string,
  versionInfo: ApiVersionsList[number],
) {
  const baseDir = path.join(dir, "widgets", publisher, slug);
  await fs.mkdir(baseDir, { recursive: true });

  const versionsListFile = path.join(baseDir, "versions.json");
  const content = await fs.readFile(versionsListFile, "utf-8");
  const data = JSON.parse(content);
  const versionsList = ApiVersionsListSchema.parse(data);

  versionsList.unshift(versionInfo);
  const newContent = JSON.stringify(versionsList);
  await fs.writeFile(versionsListFile, newContent, "utf-8");
}

export async function writeApiWidgetDetails(
  dir: string,
  publisher: string,
  slug: string,
  details: ApiWidgetDetails,
) {
  const baseDir = path.join(dir, "widgets", publisher, slug);
  await fs.mkdir(baseDir, { recursive: true });

  const detailsFile = path.join(baseDir, `${details.manifest.version}.json`);
  const content = JSON.stringify(details);
  await fs.writeFile(detailsFile, content, "utf-8");
}
