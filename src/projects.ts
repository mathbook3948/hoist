import { existsSync, lstatSync, realpathSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { type Project, Store, validId } from "./store";
import { fail } from "./http";

export function parseProject(
  dir: string,
  assets: string,
  input: Record<string, unknown>,
): Project {
  const { id, name, script: inputScript, timeoutSeconds } = input;
  if (typeof id !== "string" || !validId(id))
    throw new Error("Invalid project ID");
  if (typeof name !== "string" || !name.trim() || name.length > 100)
    throw new Error("Name must be 1–100 characters");
  if (
    typeof inputScript !== "string" ||
    !isAbsolute(inputScript) ||
    inputScript.includes("\0") ||
    !existsSync(inputScript) ||
    !lstatSync(inputScript).isFile()
  )
    throw new Error("Script must name an existing absolute trusted script");
  const script = realpathSync(inputScript);
  if (
    script === dir ||
    script.startsWith(join(dir, "projects") + "/") ||
    script === assets ||
    script.startsWith(assets + "/")
  )
    throw new Error(
      "Uploaded artifacts/web assets cannot be registered as scripts",
    );
  if (
    typeof timeoutSeconds !== "number" ||
    !Number.isInteger(timeoutSeconds) ||
    timeoutSeconds < 1 ||
    timeoutSeconds > 3600
  )
    throw new Error("Timeout must be 1–3600 seconds");
  return { id, name: name.trim(), script, timeoutSeconds };
}

export function createProjects(
  store: Store,
  assets: string,
  isBusy: () => boolean,
) {
  const dir = store.dir;
  function ensureIdle() {
    if (isBusy())
      fail(
        409,
        "Wait for uploads and deployments to finish before changing projects",
      );
  }

  function parse(input: Record<string, unknown>) {
    try {
      return parseProject(dir, assets, input);
    } catch (e) {
      fail(400, e instanceof Error ? e.message : "Invalid project");
    }
  }

  function create(input: Record<string, unknown>) {
    ensureIdle();
    const project = parse(input);
    if (store.getProject(project.id)) fail(409, "Project ID already exists");
    if (store.getProjects().length >= 32) fail(409, "Project limit reached");
    store.setProject(project);
    return project;
  }

  function update(id: string, input: Record<string, unknown>) {
    ensureIdle();
    if (!store.getProject(id)) fail(404, "Project not found");
    if (input.id !== undefined && input.id !== id)
      fail(400, "Project ID cannot be changed");
    const project = parse({ ...input, id });
    store.setProject(project);
    return project;
  }

  function remove(id: string) {
    ensureIdle();
    if (!store.getProject(id)) fail(404, "Project not found");
    store.removeProject(id);
  }

  return { create, update, remove };
}
