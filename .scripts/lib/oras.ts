import fs from "node:fs/promises";
import path from "node:path/posix";
import * as tar from "tar";
import { z } from "zod";
import { exec } from "./process.ts";
import { WidgetManifest } from "./manifest.ts";
import { GitSource } from "./git.ts";
import * as tmp from "./tmp.ts";

const ORAS_CLI = process.env["ORAS_CLI"] ?? "oras";

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

export class WidgetBundler {
  private _layoutRef: string | null = null;

  constructor(
    private _dir: string,
    private _source: GitSource,
    private _manifest: WidgetManifest,
  ) {}

  async bundle() {
    const randomId = Math.random().toString(36).slice(2);
    const archiveFile = `archive-${randomId}.tar.gz`;
    this._layoutRef = `dist-layout-${randomId}:v${this._manifest.version}`;

    // ORAS hates absolute paths so we have to finally keep the archive in a
    // relative path, but if we create the archive in the target directory the
    // archive will include itself, so we create it at a temp location first then
    // copy it over
    const tempFile = await tmp.file({ postfix: ".tar.gz" });
    await tar.c(
      {
        cwd: this._dir,
        file: tempFile.path,
        gzip: true,
        follow: true, // Resolve symlinks to avoid security issues
        portable: true, // Ensure consistent file metadata
        noMtime: true, // No timestamp for deterministic builds
      },
      ["."],
    );
    await fs.copyFile(tempFile.path, path.join(this._dir, archiveFile));
    await tempFile.cleanup();

    // https://specs.opencontainers.org/image-spec/annotations/#pre-defined-annotation-keys
    const standardAnnotations = {
      created: undefined, // This will be filled by oras
      authors: JSON.stringify(this._manifest.authors),
      url: this._manifest.homepage,
      source: this._source.repo,
      version: this._manifest.version,
      revision: this._source.commit,
      vendor: "Deskulpt",
      licenses: this._manifest.license,
      title: this._manifest.name,
      description: this._manifest.description,
    };

    const pushArgs = [
      "push",
      "--oci-layout",
      "--artifact-type",
      "application/vnd.deskulpt.widget.v1",
    ];

    for (const [key, value] of Object.entries(standardAnnotations)) {
      if (value !== undefined) {
        pushArgs.push(
          "--annotation",
          `org.opencontainers.image.${key}=${value}`,
        );
      }
    }

    pushArgs.push(
      this._layoutRef,
      `${archiveFile}:application/vnd.oci.image.layer.v1.tar+gzip`,
      "--no-tty",
      "--format",
      "json",
    );

    const pushResult = await exec(ORAS_CLI, pushArgs, { cwd: this._dir });
    return OrasPushOutputSchema.parse(JSON.parse(pushResult.stdout));
  }

  async push(remote: string) {
    if (this._layoutRef === null) {
      throw new Error("No layout to push; please run bundle() first");
    }

    const cpArgs = [
      "cp",
      "--from-oci-layout",
      this._layoutRef,
      `${remote}:v${this._manifest.version}`,
      "--no-tty",
    ];
    await exec(ORAS_CLI, cpArgs, { cwd: this._dir });
  }
}
