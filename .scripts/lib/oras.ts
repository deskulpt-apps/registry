import { z } from "zod";
import { exec } from "./process.ts";
import { WidgetManifest } from "./manifest.ts";
import { GitSource } from "./git.ts";

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

export async function pushWidget({
  dir,
  source,
  manifest,
  remote,
}: {
  dir: string;
  source: GitSource;
  manifest: WidgetManifest;
  remote?: string;
}) {
  // https://specs.opencontainers.org/image-spec/annotations/#pre-defined-annotation-keys
  const standardAnnotations = {
    created: undefined, // This will be filled by oras
    authors: JSON.stringify(manifest.authors),
    url: manifest.homepage,
    source: source.repo,
    version: manifest.version,
    revision: source.commit,
    vendor: "Deskulpt",
    licenses: manifest.license,
    title: manifest.name,
    description: manifest.description,
  };

  const pushArgs = [
    "push",
    "--oci-layout",
    "--artifact-type",
    "application/vnd.deskulpt.widget.v1",
  ];

  for (const [key, value] of Object.entries(standardAnnotations)) {
    if (value !== undefined) {
      pushArgs.push("--annotation", `org.opencontainers.image.${key}=${value}`);
    }
  }

  const randomId = Math.random().toString(36).slice(2);
  const layoutRef = `dist-layout-${randomId}:v${manifest.version}`;

  pushArgs.push(
    layoutRef,
    "./", // We work in the specified directory so package everything
    "--no-tty",
    "--format",
    "json",
  );

  const pushResult = await exec(ORAS_CLI, pushArgs, { cwd: dir });
  const pushOutput = OrasPushOutputSchema.parse(JSON.parse(pushResult.stdout));

  if (remote !== undefined) {
    const cpArgs = [
      "cp",
      "--from-oci-layout",
      layoutRef,
      `${remote}:v${manifest.version}`,
      "--no-tty",
    ];
    await exec(ORAS_CLI, cpArgs, { cwd: dir });
  }

  return pushOutput;
}
