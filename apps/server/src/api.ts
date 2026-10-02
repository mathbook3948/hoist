import type { Config, Store } from "./store";
import { fail, json, smallJSON } from "./http";
import { createAuth } from "./auth";
import { createArtifacts } from "./artifacts";
import { createDeployments } from "./deployments";
import { createProjects } from "./projects";

export function createAPI(
  store: Store,
  config: Config,
  assets: string,
  origin: string | null,
  isShuttingDown: () => boolean,
) {
  const auth = createAuth(store, config, origin);
  const deployments = createDeployments(store, config, assets);
  const artifacts = createArtifacts(store, config, deployments.isRunning);
  let launching = false;
  const isBusy = () =>
    launching || artifacts.isUploading() || deployments.hasRunning();
  const projects = createProjects(store, assets, isBusy);

  async function handle(req: Request, path: string, clientIP: string) {
    const method = req.method;
    if (path === "/api/login" && method === "POST")
      return await auth.login(req, clientIP);
    if (path === "/api/me" && method === "GET") return auth.me(req);
    if (path === "/api/logout" && method === "POST") return auth.logout(req);
    auth.getSession(req);
    if (method !== "GET") auth.csrf(req);
    if (path === "/api/projects" && method === "GET")
      return json({
        managementBusy: isBusy(),
        uploading: artifacts.isUploading() || launching,
        limits: {
          maxArtifactBytes: config.maxArtifactBytes,
          maxStorageBytes: config.maxStorageBytes,
          uploadTimeoutSeconds: config.uploadTimeoutSeconds,
        },
        projects: store.getProjects().map((p) => ({
          ...p,
          running: deployments.isRunning(p.id),
          ...store.getState(p.id),
        })),
      });
    if (path === "/api/projects" && method === "POST")
      return json(
        { project: projects.create(await smallJSON(req, 512 * 1024)) },
        201,
      );
    const scriptMatch = path.match(
      /^\/api\/projects\/([a-zA-Z0-9_-]{1,64})\/script$/,
    );
    if (scriptMatch && method === "GET")
      return json(projects.script(scriptMatch[1]));
    const projectMatch = path.match(/^\/api\/projects\/([a-zA-Z0-9_-]{1,64})$/);
    if (projectMatch) {
      if (method === "PUT")
        return json({
          project: projects.update(
            projectMatch[1],
            await smallJSON(req, 512 * 1024),
          ),
        });
      if (method === "DELETE") {
        projects.remove(projectMatch[1]);
        return json({ ok: true });
      }
    }
    const match = path.match(
      /^\/api\/projects\/([a-zA-Z0-9_-]{1,64})\/(artifacts|deploy|deployments)(?:\/([a-zA-Z0-9_-]{1,64})(?:\/(cancel))?)?$/,
    );
    if (!match) fail(404, "Not found");
    const p = store.getProject(match[1]);
    if (!p) fail(404, "Project not found");
    if (method === "POST" && match[2] === "artifacts" && !match[3]) {
      if (launching) fail(409, "Deployment request busy");
      return json({ artifact: await artifacts.upload(req, p) }, 201);
    }
    if (method === "POST" && match[2] === "deploy" && !match[3]) {
      if (artifacts.isUploading()) fail(409, "Upload busy");
      if (launching || deployments.hasRunning())
        fail(409, "A deployment is already running; wait for it to finish");
      launching = true;
      try {
        const b = await smallJSON(req);
        if (isShuttingDown()) fail(503, "Shutting down");
        if (typeof b.artifactId !== "string") fail(400, "Artifact required");
        return json(
          { deployment: deployments.launch(p, b.artifactId, b.version) },
          202,
        );
      } finally {
        launching = false;
      }
    }
    if (match[2] === "deployments" && match[3]) {
      deployments.get(p, match[3]);
      if (method === "GET" && !match[4])
        return json(deployments.read(p, match[3]));
      if (method === "POST" && match[4] === "cancel") {
        deployments.cancel(p, match[3]);
        return json({ ok: true });
      }
    }
    fail(404, "Not found");
  }

  return {
    handle,
    shutdown() {
      artifacts.shutdown();
      deployments.cancelAll();
    },
    waitForIdle: () =>
      Promise.all([deployments.waitForIdle(), artifacts.waitForIdle()]),
  };
}
