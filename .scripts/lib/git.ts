import { z } from "zod";
import { exec } from "./process.ts";

export const GitSourceSchema = z.object({
  repo: z.url(),
  commit: z.union([z.hash("sha1"), z.hash("sha256")]),
  path: z.string().optional(),
});

export type GitSource = z.infer<typeof GitSourceSchema>;

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

export async function checkoutRepoAtCommit(dest: string, source: GitSource) {
  await exec("git", ["init", dest], {});
  await exec("git", ["-C", dest, "remote", "add", "origin", source.repo]);
  await exec("git", [
    "-C",
    dest,
    "fetch",
    "--depth=1",
    "origin",
    source.commit,
  ]);
  if (source.path !== undefined) {
    await exec("git", ["-C", dest, "sparse-checkout", "init", "--cone"]);
    await exec("git", ["-C", dest, "sparse-checkout", "set", source.path]);
  }
  await exec("git", ["-C", dest, "checkout", "--detach", source.commit]);
}
