import fs from "node:fs/promises";
import path from "node:path/posix";

interface FindSpecialFileOptions {
  dir: string;
  stems: string[];
  exts: string[];
  file?: string | boolean;
}

async function isFile(p: string) {
  try {
    const stat = await fs.stat(p);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function findSpecialFile(options: FindSpecialFileOptions) {
  const autoDetect = async () => {
    for (const stem of options.stems) {
      for (const ext of options.exts) {
        const filename = `${stem}${ext}`;
        const filepath = path.join(options.dir, filename);
        if (await isFile(filepath)) {
          return filename;
        }
      }
    }
    return null;
  };

  if (options.file === undefined) {
    return await autoDetect(); // Okay to return null
  }

  if (options.file === false) {
    return null; // Explicitly disabled
  }

  if (options.file === true) {
    // Auto-detect but must succeed (cannot return null)
    const detected = await autoDetect();
    if (detected === null) {
      throw new Error(
        "Cannot auto-detect target file; please specify it explicitly",
      );
    }
    return detected;
  }

  // Explicit filename, must be a valid file
  const filepath = path.join(options.dir, options.file);
  if (!(await isFile(filepath))) {
    throw new Error("Specified file is not a valid file or symlinked file");
  }
  return options.file;
}

async function copySpecialFile(dst: string, options: FindSpecialFileOptions) {
  const file = await findSpecialFile(options);
  if (file === null) {
    return false;
  }
  const src = path.join(options.dir, file);
  await fs.cp(src, dst, { dereference: true });
  return true;
}

export async function copyReadme(
  src: string,
  dst: string,
  file?: string | boolean,
) {
  return await copySpecialFile(dst, {
    dir: src,
    stems: ["README"],
    exts: [".md", ".markdown", "", ".txt"],
    file,
  });
}

export async function copyChangelog(
  src: string,
  dst: string,
  file?: string | boolean,
) {
  return await copySpecialFile(dst, {
    dir: src,
    stems: ["CHANGELOG", "CHANGES", "HISTORY"],
    exts: [".md", ".markdown", "", ".txt"],
    file,
  });
}
