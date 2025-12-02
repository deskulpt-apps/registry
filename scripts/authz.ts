import deepEqual from "fast-deep-equal";
import * as github from "./lib/github.ts";
import { die } from "./lib/utils.ts";
import { parsePublisher, Publisher } from "./lib/schema.ts";

for (const varName of [
  "AUTHOR_LOGIN",
  "AUTHOR_ID",
  "BASE_SHA",
  "HEAD_SHA",
  "CHANGED_HANDLES",
]) {
  if (process.env[varName] === undefined) {
    die(`Missing required environment variable: ${varName}`);
  }
}

const AUTHOR_LOGIN = process.env["AUTHOR_LOGIN"]!;
const AUTHOR_ID = process.env["AUTHOR_ID"]!;
const BASE_SHA = process.env["BASE_SHA"]!;
const HEAD_SHA = process.env["HEAD_SHA"]!;
const CHANGED_HANDLES = process.env["CHANGED_HANDLES"]!;

const changedHandles = CHANGED_HANDLES.trim().split(/\s+/).filter(Boolean);
if (changedHandles.length === 0) {
  console.log("No handles provided, skipping authorization check");
  process.exit(0);
}

async function authorizedByOwnerOrOrg({ user, organization }: Publisher) {
  if (user !== undefined && String(user) === AUTHOR_ID) {
    return "user";
  }
  if (
    organization !== undefined &&
    (await github.isOrgMember({ orgId: organization, userLogin: AUTHOR_LOGIN }))
  ) {
    return "organization";
  }
  return undefined;
}

for (const handle of changedHandles) {
  console.log(`[${handle}] Authorizing...`);

  const basePublisher = await parsePublisher(handle, BASE_SHA);
  const headPublisher = await parsePublisher(handle, HEAD_SHA);

  if (headPublisher === undefined) {
    if (basePublisher === undefined) {
      console.log(
        `[${handle}] Publisher does not exist on BASE or HEAD, skipping`,
      );
      continue;
    } else {
      die(`[${handle}] Existing publisher cannot be removed`);
    }
  }

  if (basePublisher === undefined) {
    const authRole = await authorizedByOwnerOrOrg(headPublisher);
    if (authRole !== undefined) {
      console.log(`[${handle}] Authorized as ${authRole} publisher (new)`);
      continue;
    }
    die(`[${handle}] Unauthorized`);
  }

  if (
    basePublisher.user !== headPublisher.user ||
    basePublisher.organization !== headPublisher.organization
  ) {
    die(`[${handle}] Identity of existing publisher cannot be changed`);
  }

  const authRole = await authorizedByOwnerOrOrg(headPublisher);
  if (authRole !== undefined) {
    console.log(`[${handle}] Authorized as ${authRole} publisher (existing)`);
    continue;
  }

  const baseExtraMaintainers = basePublisher.extraMaintainers?.sort() ?? [];
  const headExtraMaintainers = headPublisher.extraMaintainers?.sort() ?? [];
  if (!deepEqual(baseExtraMaintainers, headExtraMaintainers)) {
    die(
      `[${handle}] Only user publisher themselves or member of organization publisher can change the list of extra maintainers`,
    );
  }

  if (baseExtraMaintainers.map(String).includes(AUTHOR_ID)) {
    console.log(`[${handle}] Authorized as extra maintainer`);
    continue;
  }

  die(`[${handle}] Unauthorized`);
}
