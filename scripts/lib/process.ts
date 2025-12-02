import {
  execFile,
  ExecFileOptionsWithStringEncoding,
} from "node:child_process";

export function exec(
  command: string,
  args?: string[],
  options?: ExecFileOptionsWithStringEncoding,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (err, stdout, stderr) => {
      if (err) {
        reject(err);
      } else {
        resolve({
          stdout: stdout.toString("utf8"),
          stderr: stderr.toString("utf8"),
        });
      }
    });
  });
}
