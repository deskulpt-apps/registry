import { Octokit } from "octokit";
import { attestProvenance as actionsAttestProvenance } from "@actions/attest";

const GITHUB_API_VERSION = "2022-11-28";

const GH_TOKEN = process.env["GH_TOKEN"];
if (GH_TOKEN === undefined) {
  console.warn("Missing environment variable: GH_TOKEN");
}

const octokit = new Octokit({ auth: GH_TOKEN });

export async function isOrgMember(params: {
  orgId: number;
  userLogin: string;
}) {
  try {
    const response = await octokit.request(
      "GET /organizations/{org}/members/{username}",
      {
        org: params.orgId,
        username: params.userLogin,
        headers: { "X-GitHub-Api-Version": GITHUB_API_VERSION },
      },
    );
    return response.status === 204;
  } catch {
    return false;
  }
}

export async function attestProvenance(params: {
  name: string;
  digest: string;
}) {
  if (GH_TOKEN === undefined) {
    throw new Error("GH_TOKEN is required for attestation");
  }

  const digestMatch = /^sha256:([0-9a-f]{64})$/i.exec(params.digest);
  if (digestMatch === null) {
    throw new Error(
      `Invalid digest format: ${params.digest}; expected sha256:<64-hex-chars>`,
    );
  }

  const provenance = await actionsAttestProvenance({
    token: GH_TOKEN,
    subjects: [
      {
        name: params.name,
        digest: { sha256: digestMatch[1]!.toLowerCase() },
      },
    ],
  });
  return provenance;
}
