import spdxParse from "spdx-expression-parse";
import spdxSatisfies from "spdx-satisfies";
import { z } from "zod";
import { exec } from "./process.ts";

// Must be a bash script that can accept an argument $1 as the file or directory
// to detect license for; undefined to skip license detection
const LICENSEE_DETECT_SCRIPT = process.env["LICENSEE_DETECT_SCRIPT"];

// Partial schema that only includes fields we need
const LICENSEE_DETECT_OUTPUT_SCHEMA = z.object({
  matched_files: z.array(
    z.object({
      filename: z.string(),
      matched_license: z.string(),
      matcher: z.object({
        confidence: z.number(),
      }),
    }),
  ),
});

const ACCEPTED_LICENSES = ["Apache-2.0", "BSD-3-Clause", "MIT"];

async function detectLicense(base: string, fileOrDir: string) {
  if (LICENSEE_DETECT_SCRIPT === undefined) {
    throw new Error("LICENSEE_DETECT_SCRIPT is not defined");
  }

  const result = await exec(
    "bash",
    ["-c", LICENSEE_DETECT_SCRIPT, "_", fileOrDir],
    { cwd: base },
  );
  const output = LICENSEE_DETECT_OUTPUT_SCHEMA.parse(JSON.parse(result.stdout));

  const licenses = output.matched_files
    .filter((match) => match.matcher.confidence >= 98)
    .map((match) => match.matched_license);

  if (licenses.length === 0) {
    throw new Error(`No license detected in: ${fileOrDir}`);
  }
  return licenses;
}

export async function validateLicense(
  spdx: string,
  base: string,
  files?: string[],
) {
  if (LICENSEE_DETECT_SCRIPT === undefined) {
    return;
  }

  try {
    spdxParse(spdx);
  } catch (error) {
    throw new Error(
      `License "${spdx}" is not a valid SPDX expression: ${error}`,
      { cause: error },
    );
  }

  if (!spdxSatisfies(spdx, ACCEPTED_LICENSES)) {
    throw new Error(
      `License "${spdx}" is not accepted; accepted licenses are: ${ACCEPTED_LICENSES.join(", ")}`,
    );
  }

  const detectedSet = new Set<string>();
  if (files === undefined) {
    const detectedLicenses = await detectLicense(base, ".");
    for (const license of detectedLicenses) {
      detectedSet.add(license);
    }
  } else {
    for (const file of files) {
      const detectedLicenses = await detectLicense(base, file);
      for (const license of detectedLicenses) {
        detectedSet.add(license);
      }
    }
  }

  const detected = Array.from(detectedSet);
  const detectedAreAccepted = detected.every((license) =>
    spdxSatisfies(license, ACCEPTED_LICENSES),
  );
  if (!detectedAreAccepted) {
    throw new Error(
      `Detected licenses are not all accepted: ${detected.join(", ")}; accepted licenses are: ${ACCEPTED_LICENSES.join(", ")}`,
    );
  }
}
