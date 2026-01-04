import deepEqual from "fast-deep-equal";
import * as github from "./lib/github.ts";
import { die } from "./lib/utils.ts";
import { parsePublisher } from "./lib/schema.ts";

for (const varName of [
  "AUTHOR_LOGIN",
  "AUTHOR_ID",
  "BASE_SHA",
  "HEAD_SHA",
  "CHANGED_PUBLISHERS",
]) {
  if (process.env[varName] === undefined) {
    die(`Missing required environment variable: ${varName}`);
  }
}

const AUTHOR_LOGIN = process.env["AUTHOR_LOGIN"]!;
const AUTHOR_ID = process.env["AUTHOR_ID"]!;
const BASE_SHA = process.env["BASE_SHA"]!;
const HEAD_SHA = process.env["HEAD_SHA"]!;
const CHANGED_PUBLISHERS = process.env["CHANGED_PUBLISHERS"]!;

const changedPublishers = CHANGED_PUBLISHERS.trim()
  .split(/\s+/)
  .filter(Boolean);
if (changedPublishers.length === 0) {
  console.log("No publishers provided, skipping authorization check");
  process.exit(0);
}

for (const publisher of changedPublishers) {
  console.log(`[${publisher}] Authorizing...`);

  const basePublisher = await parsePublisher(publisher, BASE_SHA);
  const headPublisher = await parsePublisher(publisher, HEAD_SHA);

  if (headPublisher === undefined) {
    if (basePublisher === undefined) {
      console.log(
        `[${publisher}] Publisher does not exist on BASE or HEAD, skipping`,
      );
      continue;
    } else {
      die(`[${publisher}] Existing publisher cannot be removed`);
    }
  }

  const isAuthorized = async () => {
    if (
      headPublisher.user !== undefined &&
      String(headPublisher.user) === AUTHOR_ID
    ) {
      console.log(`[${publisher}] Authorized as user publisher`);
      return true;
    }

    if (
      headPublisher.organization !== undefined &&
      (await github.isOrgMember({
        orgId: headPublisher.organization,
        userLogin: AUTHOR_LOGIN,
      }))
    ) {
      console.log(
        `[${publisher}] Authorized as member of organization publisher`,
      );
      return true;
    }

    return false;
  };

  if (basePublisher === undefined) {
    if (await isAuthorized()) {
      continue;
    }
    die(`[${publisher}] Unauthorized`);
  }

  if (
    basePublisher.user !== headPublisher.user ||
    basePublisher.organization !== headPublisher.organization
  ) {
    die(`[${publisher}] Identity of existing publisher cannot be changed`);
  }

  if (await isAuthorized()) {
    continue;
  }

  const baseExtraMaintainers = basePublisher.extraMaintainers?.toSorted() ?? [];
  const headExtraMaintainers = headPublisher.extraMaintainers?.toSorted() ?? [];
  if (!deepEqual(baseExtraMaintainers, headExtraMaintainers)) {
    die(
      `[${publisher}] Only the publisher owner or an authorized organization member can modify extra maintainers`,
    );
  }

  if (baseExtraMaintainers.map(String).includes(AUTHOR_ID)) {
    console.log(`[${publisher}] Authorized as extra maintainer`);
    continue;
  }

  die(`[${publisher}] Unauthorized`);
}
