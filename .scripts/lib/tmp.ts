import { promisify } from "node:util";
import tmp from "tmp";

tmp.setGracefulCleanup();

export const file = promisify<
  tmp.FileOptions,
  { path: string; fd: number; cleanup: () => Promise<void> }
>((options, callback) =>
  tmp.file(options, (error, path, fd, cleanup) =>
    error === null
      ? callback(undefined, { path, fd, cleanup: promisify(cleanup) })
      : callback(error, undefined as any),
  ),
);

export const dir = promisify<
  tmp.DirOptions,
  { path: string; cleanup: () => Promise<void> }
>((options, callback) =>
  tmp.dir(options, (error, path, cleanup) =>
    error === null
      ? callback(undefined, { path, cleanup: promisify(cleanup) })
      : callback(error, undefined as any),
  ),
);
