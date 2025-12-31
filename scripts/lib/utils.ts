import { promisify } from "node:util";
import tmp from "tmp";

export function die(message: string): never {
  console.error(`::error::${message}`);
  process.exit(1);
}

export const tmpDir = promisify<
  tmp.DirOptions,
  { path: string; cleanup: () => Promise<void> }
>((options, callback) =>
  tmp.dir(options, (error, path, cleanup) =>
    error !== null
      ? callback(error, undefined as any)
      : callback(undefined, { path, cleanup: promisify(cleanup) }),
  ),
);
