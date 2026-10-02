import {
  existsSync,
  lstatSync,
  realpathSync,
  mkdirSync,
  openSync,
  closeSync,
  fstatSync,
  readSync,
  writeFileSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { dirname, join, relative, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";
import { type Project, Store, projectDir } from "./store";

export const maxScriptBytes = 64 * 1024;
const inside = (root: string, path: string) => {
  const part = relative(root, path);
  return (
    part === "" ||
    (!isAbsolute(part) &&
      part !== ".." &&
      !part.startsWith("../") &&
      !part.startsWith("..\\"))
  );
};

function directory(path: string) {
  if (!existsSync(path)) mkdirSync(path, { mode: 0o700 });
  if (lstatSync(path).isSymbolicLink() || !lstatSync(path).isDirectory())
    throw new Error("Project directory must be a real directory");
}

export function managedScriptPath(dir: string, id: string) {
  const folder = projectDir(dir, id);
  directory(join(dir, "projects"));
  directory(folder);
  // Validate all directories Store.setProject will use before creating files.
  directory(join(folder, "artifacts"));
  directory(join(folder, "logs"));
  return join(folder, "deploy.sh");
}

/** Allow only this project's deploy.sh inside managed data, never an uploaded artifact. */
export function trustedScript(
  dir: string,
  assets: string,
  id: string,
  input: string,
) {
  if (
    !isAbsolute(input) ||
    input.includes("\0") ||
    !existsSync(input) ||
    !lstatSync(input).isFile()
  )
    throw new Error("Configured script is missing or is not a regular file");
  const script = realpathSync(input);
  if (inside(assets, script) || relative(dir, script) === "")
    throw new Error("Web assets cannot be used as scripts");
  if (
    inside(join(dir, "projects"), input) ||
    inside(join(dir, "projects"), script)
  ) {
    const expected = join(projectDir(dir, id), "deploy.sh");
    if (
      relative(expected, input) !== "" ||
      relative(expected, script) !== "" ||
      lstatSync(join(dir, "projects")).isSymbolicLink() ||
      lstatSync(projectDir(dir, id)).isSymbolicLink()
    )
      throw new Error(
        "Only this project's deploy.sh can run inside project data",
      );
  }
  return script;
}

export function readScript(path: string) {
  const fd = openSync(path, "r");
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > maxScriptBytes)
      throw new Error("Script must be a text file of at most 64 KiB");
    const buffer = Buffer.alloc(maxScriptBytes + 1);
    let size = 0;
    while (size < buffer.length) {
      const read = readSync(fd, buffer, size, buffer.length - size, null);
      if (!read) break;
      size += read;
    }
    if (size > maxScriptBytes) throw new Error("Script must be at most 64 KiB");
    return new TextDecoder("utf-8", { fatal: true }).decode(
      buffer.subarray(0, size),
    );
  } finally {
    closeSync(fd);
  }
}

export function normalizeScript(input: unknown) {
  if (typeof input !== "string" || !input.trim() || input.includes("\0"))
    throw new Error("Script must be non-empty text without NUL characters");
  const content = input.replace(/\r\n?/g, "\n");
  if (Buffer.byteLength(content, "utf8") > maxScriptBytes)
    throw new Error("Script must be at most 64 KiB");
  return content;
}

/** Replace complete files; restore the previous script if metadata persistence fails. */
export function saveScript(store: Store, project: Project, content: string) {
  const path = project.script;
  if (existsSync(path) && !lstatSync(path).isFile())
    throw new Error("Script must be a regular file");
  const previous = existsSync(path) ? readScript(path) : undefined;
  const mode = previous === undefined ? 0o700 : lstatSync(path).mode & 0o777;
  const temp = join(dirname(path), `.deploy-${randomUUID()}.tmp`);
  let installed = false;
  try {
    writeFileSync(temp, content, { flag: "wx", mode });
    renameSync(temp, path);
    installed = true;
    store.setProject(project);
  } catch (error) {
    if (installed) {
      if (previous === undefined) unlinkSync(path);
      else {
        writeFileSync(temp, previous, { flag: "wx", mode });
        renameSync(temp, path);
      }
    }
    throw error;
  } finally {
    if (existsSync(temp)) unlinkSync(temp);
  }
}
