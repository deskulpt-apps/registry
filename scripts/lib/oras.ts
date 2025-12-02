import { exec } from "./process.ts";
import { parseOrasPushOutput, Widget, WidgetManifest } from "./schema.ts";

const ORAS_CLI = process.env["ORAS_CLI"] ?? "oras";

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
    url: undefined, // TODO: when we have this in manifest
    documentation: undefined, // TODO: when we have this in manifest
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
  return parseOrasPushOutput(result.stdout);
}
