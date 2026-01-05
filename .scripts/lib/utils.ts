import { promisify } from "node:util";
import tmp from "tmp";

export const ALL_COLLECTIONS = ["widgets", "plugins"] as const;
export type Collection = (typeof ALL_COLLECTIONS)[number];

// See FAQ of https://semver.org/
export const SEMVER_REGEX =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

export function die(message: string): never {
  console.error(`::error::${message}`);
  process.exit(1);
}

export function pushOrReplace<T>(array: T[], index: number, entry: T) {
  if (index === -1) {
    array.push(entry);
  } else {
    array[index] = entry;
  }
}

export const tmpDir = promisify<
  tmp.DirOptions,
  { path: string; cleanup: () => Promise<void> }
>((options, callback) =>
  tmp.dir(options, (error, path, cleanup) =>
    error === null
      ? callback(undefined, { path, cleanup: promisify(cleanup) })
      : callback(error, undefined as any),
  ),
);
