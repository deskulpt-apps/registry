import { Octokit } from "octokit";

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
  } catch (error) {
    return false;
  }
}
