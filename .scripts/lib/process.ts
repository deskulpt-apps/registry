import {
  ExecFileOptionsWithStringEncoding,
  execFile,
} from "node:child_process";

export function exec(
  command: string,
  args?: string[],
  options?: ExecFileOptionsWithStringEncoding,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (err, stdout, stderr) => {
      if (err) {
        const messageLines = [
          "Failed to execute command",
          `Error: ${err}`,
          `Stdout:\n${stdout.toString("utf8")}`,
          `Stderr:\n${stderr.toString("utf8")}`,
        ];
        const message = messageLines.join("\n\n----------\n\n");
        reject(new Error(message, { cause: err }));
      } else {
        resolve({
          stdout: stdout.toString("utf8"),
          stderr: stderr.toString("utf8"),
        });
      }
    });
  });
}
