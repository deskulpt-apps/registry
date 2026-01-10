import path from "node:path/posix";
import fs from "node:fs/promises";
import { z } from "zod";
import {
  PluginManifest,
  PluginManifestSchema,
  WidgetManifest,
  WidgetManifestSchema,
} from "./manifest.ts";
import { Collection } from "./utils.ts";
import { GitSource, GitSourceSchema } from "./git.ts";
import { copyChangelog, copyReadme } from "./special-files.ts";

const BaseIndexEntrySchema = z.object({
  publisher: z.string(),
  slug: z.string(),
  version: z.string(),
  name: z.string(),
  description: z.string(),
  authors: z.array(z.string()),
  official: z.boolean().optional(),
  hidden: z.boolean().optional(),
});

const WidgetsIndexSchema = z.object({
  items: z.array(BaseIndexEntrySchema),
});

const PluginsIndexSchema = z.object({
  items: z.array(BaseIndexEntrySchema),
});

const BaseMetaSchema = z.object({
  publishedAt: z.iso.datetime(),
  digest: z.string(),
  source: GitSourceSchema,
  readme: z.boolean().optional(),
  changelog: z.boolean().optional(),
});

const WidgetMetaSchema = BaseMetaSchema.extend({
  manifest: WidgetManifestSchema,
});

const PluginMetaSchema = BaseMetaSchema.extend({
  manifest: PluginManifestSchema,
});

const VersionsListSchema = z.object({
  items: z.array(
    z.object({
      version: z.string(),
      publishedAt: z.iso.datetime(),
      digest: z.string(),
    }),
  ),
});

type BaseIndexEntry = z.infer<typeof BaseIndexEntrySchema>;

type TypeMap = {
  widgets: {
    index: z.infer<typeof WidgetsIndexSchema>;
    meta: z.infer<typeof WidgetMetaSchema>;
    manifest: WidgetManifest;
  };
  plugins: {
    index: z.infer<typeof PluginsIndexSchema>;
    meta: z.infer<typeof PluginMetaSchema>;
    manifest: PluginManifest;
  };
};

abstract class BaseApi<C extends Collection> {
  protected _now = new Date();
  protected _index!: TypeMap[C]["index"];

  constructor(
    protected readonly _collection: C,
    protected readonly _dir: string,
  ) {}

  protected abstract _setIndex(data: any): void;
  protected abstract _updateIndex(i: number, base: BaseIndexEntry): void;

  async init() {
    const file = path.join(this._dir, `index.${this._collection}.json`);
    const content = await fs.readFile(file, "utf-8");
    const data = JSON.parse(content);
    this._setIndex(data);
  }

  async flush() {
    const file = path.join(this._dir, `index.${this._collection}.json`);
    const content = JSON.stringify(this._index);

    this._index.items.sort((a, b) => {
      if (a.publisher !== b.publisher) {
        return a.publisher.localeCompare(b.publisher);
      }
      return a.slug.localeCompare(b.slug);
    });

    await fs.writeFile(file, content, "utf-8");
  }

  async update({
    publisher,
    slug,
    source,
    sourceDir,
    manifest,
    publishedAt,
    digest,
  }: {
    publisher: string;
    slug: string;
    source: GitSource;
    sourceDir: string;
    manifest: TypeMap[C]["manifest"];
    publishedAt: string;
    digest: string;
  }) {
    const dir = path.join(this._dir, this._collection, publisher, slug);
    await fs.mkdir(dir, { recursive: true });

    const filesDir = path.join(dir, "files");
    await fs.rm(filesDir, { recursive: true, force: true });
    await fs.mkdir(filesDir, { recursive: true });

    const readmeCopied = await copyReadme(
      sourceDir,
      path.join(filesDir, "readme"),
      manifest.readme,
    );

    const changelogCopied = await copyChangelog(
      sourceDir,
      path.join(filesDir, "changelog"),
      manifest.changelog,
    );

    {
      const file = path.join(dir, "meta.json");
      const meta: TypeMap[C]["meta"] = {
        publishedAt,
        digest,
        source,
        manifest,
        readme: readmeCopied || undefined,
        changelog: changelogCopied || undefined,
      };
      const content = JSON.stringify(meta);
      await fs.writeFile(file, content, "utf-8");
    }

    {
      const file = path.join(dir, "versions.json");
      const content = await fs.readFile(file, "utf-8");
      const data = JSON.parse(content);
      const versions = VersionsListSchema.parse(data);
      versions.items.unshift({
        version: manifest.version,
        publishedAt,
        digest,
      });
      const newContent = JSON.stringify(versions);
      await fs.writeFile(file, newContent, "utf-8");
    }

    const i = this._index.items.findIndex(
      (e) => e.publisher === publisher && e.slug === slug,
    );

    this._updateIndex(i, {
      publisher,
      slug,
      version: manifest.version,
      name: manifest.name,
      description: manifest.description,
      authors: manifest.authors.map((author) =>
        typeof author === "string" ? author : author.name,
      ),
      official: publisher === "deskulpt" ? true : undefined,
      hidden: publisher === "deskulpt-test" ? true : undefined,
    });
  }
}

export class WidgetsApi extends BaseApi<"widgets"> {
  constructor(dir: string) {
    super("widgets", dir);
  }

  protected _setIndex(data: any) {
    this._index = WidgetsIndexSchema.parse(data);
  }

  protected _updateIndex(i: number, base: BaseIndexEntry) {
    if (i === -1) {
      this._index.items.push(base);
    } else {
      this._index.items[i] = base;
    }
  }
}

export class PluginsApi extends BaseApi<"plugins"> {
  constructor(dir: string) {
    super("plugins", dir);
  }

  protected _setIndex(data: any) {
    this._index = PluginsIndexSchema.parse(data);
  }

  protected _updateIndex(i: number, base: BaseIndexEntry) {
    if (i === -1) {
      this._index.items.push(base);
    } else {
      this._index.items[i] = base;
    }
  }
}
