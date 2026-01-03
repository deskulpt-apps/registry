import { z } from "zod";
import { exec } from "./process.ts";
import { Widget, WidgetManifest } from "./schema.ts";

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

export async function push({
  src,
  dst,
  widget,
  manifest,
  dryRun = false,
}: {
  src: string;
  dst: string;
  widget: Widget;
  manifest: WidgetManifest;
  dryRun?: boolean;
}) {
  // https://specs.opencontainers.org/image-spec/annotations/#pre-defined-annotation-keys
  const standardAnnotations = {
    created: undefined, // This will be filled by oras
    authors: JSON.stringify(manifest.authors),
    url: manifest.homepage,
    source: `${widget.repo}@${widget.commit}`,
    version: widget.version,
    revision: widget.commit,
    vendor: "Deskulpt",
    licenses: manifest.license,
    title: manifest.name,
    description: manifest.description,
  };

  const args = [
    "push",
    "--artifact-type",
    "application/vnd.deskulpt.widget.v1",
  ];

  if (dryRun) {
    args.push("--oci-layout"); // Push to local OCI image layout
  }

  for (const [key, value] of Object.entries(standardAnnotations)) {
    if (value !== undefined) {
      args.push("--annotation", `org.opencontainers.image.${key}=${value}`);
    }
  }

  args.push(
    `${dst}:v${manifest.version}`,
    "./", // We work in the specified source directory so package everything
    "--no-tty",
    "--format",
    "json",
  );

  const result = await exec(ORAS_CLI, args, { cwd: src });
  const output = JSON.parse(result.stdout);
  return OrasPushOutputSchema.parse(output);
}
