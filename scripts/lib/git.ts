import { exec } from "./process.ts";

export async function fileExistsAtCommit(path: string, commit: string) {
  try {
    await exec("git", ["cat-file", "-e", `${commit}:${path}`]);
    return true;
  } catch {
    return false;
  }
}

export async function showFileAtCommit(path: string, commit: string) {
  const result = await exec("git", ["show", `${commit}:${path}`]);
  return result.stdout;
}

export async function checkoutRepoAtCommit(
  dest: string,
  repo: string,
  commit: string,
  path?: string,
) {
  await exec("git", ["init", dest], {});
  await exec("git", ["-C", dest, "remote", "add", "origin", repo]);
  await exec("git", ["-C", dest, "fetch", "--depth=1", "origin", commit]);
  if (path !== undefined) {
    await exec("git", ["-C", dest, "sparse-checkout", "init", "--cone"]);
    await exec("git", ["-C", dest, "sparse-checkout", "set", path]);
  }
  await exec("git", ["-C", dest, "checkout", "--detach", commit]);
}
