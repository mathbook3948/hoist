import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { type Project, Store, validId, projectDir } from "./store";
import { defaultDeployScript } from "./models";
import {
  managedScriptPath,
  trustedScript,
  readScript,
  normalizeScript,
  saveScript,
} from "./scripts";
import { fail } from "./http";

function fields(input: Record<string, unknown>) {
  const { id, name, timeoutSeconds = 300 } = input;
  if (typeof id !== "string" || !validId(id))
    throw new Error("Invalid project ID");
  if (typeof name !== "string" || !name.trim() || name.length > 100)
    throw new Error("Name must be 1–100 characters");
  if (
    typeof timeoutSeconds !== "number" ||
    !Number.isInteger(timeoutSeconds) ||
    timeoutSeconds < 1 ||
    timeoutSeconds > 3600
  )
    throw new Error("Timeout must be 1–3600 seconds");
  return { id, name: name.trim(), timeoutSeconds };
}

export function parseProject(
  dir: string,
  assets: string,
  input: Record<string, unknown>,
): Project {
  const project = fields(input);
  if (typeof input.script !== "string")
    throw new Error("Script must name an existing absolute trusted script");
  return {
    ...project,
    script: trustedScript(dir, assets, project.id, input.script),
  };
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

  function validate<T>(work: () => T): T {
    try {
      return work();
    } catch (e) {
      fail(400, e instanceof Error ? e.message : "Invalid project");
    }
  }

  function save(input: Record<string, unknown>, existing?: Project) {
    return validate(() => {
      // Retain path-based registration for existing CLI/API callers.
      if (input.scriptContent === undefined && input.script !== undefined) {
        const project = parseProject(dir, assets, input);
        store.setProject(project);
        return project;
      }
      const metadata = fields(input);
      const content = normalizeScript(
        input.scriptContent !== undefined
          ? input.scriptContent
          : existing
            ? readScript(
                trustedScript(dir, assets, existing.id, existing.script),
              )
            : defaultDeployScript,
      );
      // Preserve legacy external scripts and their execution working directory.
      const script = existing
        ? trustedScript(dir, assets, existing.id, existing.script)
        : managedScriptPath(dir, metadata.id);
      const project = { ...metadata, script };
      saveScript(store, project, content);
      return project;
    });
  }

  function create(input: Record<string, unknown>) {
    ensureIdle();
    let id = input.id;
    if (id === undefined) {
      do {
        id = randomUUID();
      } while (existsSync(projectDir(dir, id as string)));
    }
    validate(() => fields({ ...input, id }));
    if (store.getProject(id as string)) fail(409, "Project ID already exists");
    if (store.getProjects().length >= 32) fail(409, "Project limit reached");
    return save({ ...input, id });
  }

  function update(id: string, input: Record<string, unknown>) {
    ensureIdle();
    const existing = store.getProject(id);
    if (!existing) fail(404, "Project not found");
    if (input.id !== undefined && input.id !== id)
      fail(400, "Project ID cannot be changed");
    return save({ ...input, id }, existing);
  }

  function script(id: string) {
    const project = store.getProject(id);
    if (!project) fail(404, "Project not found");
    return validate(() => ({
      scriptContent: readScript(trustedScript(dir, assets, id, project.script)),
    }));
  }

  function remove(id: string) {
    ensureIdle();
    if (!store.getProject(id)) fail(404, "Project not found");
    store.removeProject(id);
  }

  return { create, update, remove, script };
}
