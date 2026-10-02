import { assetsDir as assets, staticFiles } from "@hoist/web/assets";
import { Store } from "./store";
import { HTTPError, fail, json, security, smallJSON } from "./http";
import { createAuth } from "./auth";
import { createArtifacts } from "./artifacts";
import { createDeployments } from "./deployments";
import { createProjects } from "./projects";
import { readSettings, type Settings } from "./settings";
import { createIPFilter, createClientIPResolver } from "./network";

export function startServer(store: Store, settings: Settings = readSettings()) {
  const isAllowedIP = createIPFilter(settings.allowedIP);
  const resolveClientIP = createClientIPResolver(settings.trustedProxy);
  const dir = store.dir;
  const config = store.getConfig();
  store.recover();
  for (const p of store.getProjects(true)) store.trim(p.id, config);
  const origin =
    config.publicOrigin ||
    `http://${config.host === "::1" ? "[::1]" : config.host}:${config.port}`;

  const auth = createAuth(store, config, origin);
  const deployments = createDeployments(store, config, assets);
  const artifacts = createArtifacts(store, config, deployments.isRunning);
  let launching = false;
  const projects = createProjects(
    store,
    assets,
    () => launching || artifacts.isUploading() || deployments.hasRunning(),
  );
  let shuttingDown = false;
  const server = Bun.serve({
    hostname: config.host,
    port: config.port,
    idleTimeout: 30,
    maxRequestBodySize: config.maxArtifactBytes,
    async fetch(req, server) {
      try {
        const clientIP = resolveClientIP(
          server.requestIP(req)?.address,
          req.headers.get("x-forwarded-for"),
        );
        if (!isAllowedIP(clientIP)) fail(403, "IP address rejected");
        if (shuttingDown) fail(503, "Shutting down");
        const url = new URL(req.url);
        const expectedHost = new URL(origin).host;
        if (req.headers.get("host") !== expectedHost)
          fail(403, "Host rejected");
        const path = url.pathname;
        const method = req.method;
        const appRoute = path.match(
          /^\/([a-zA-Z0-9_-]{1,64})(?:\/([a-zA-Z0-9_-]{1,64}))?$/,
        );
        const appPage =
          path === "/" ||
          (appRoute && appRoute[1] !== "api" && appRoute[1] !== "assets");
        const staticFile = staticFiles.get(appPage ? "/" : path);
        if (method === "GET" && appPage && !staticFile)
          fail(
            503,
            "Web build missing. Run bun run build:web, or open the Vite development server.",
          );
        if (method === "GET" && staticFile)
          return new Response(Bun.file(staticFile), {
            headers: {
              ...security,
              "Content-Type": appPage
                ? "text/html; charset=utf-8"
                : path.endsWith(".js")
                  ? "text/javascript; charset=utf-8"
                  : path.endsWith(".css")
                    ? "text/css; charset=utf-8"
                    : Bun.file(staticFile).type || "application/octet-stream",
            },
          });
        if (path === "/api/login" && method === "POST")
          return await auth.login(req, clientIP!);
        if (path === "/api/me" && method === "GET") return auth.me(req);
        if (path === "/api/logout" && method === "POST")
          return auth.logout(req);
        auth.getSession(req);
        if (method !== "GET") auth.csrf(req);
        if (path === "/api/projects" && method === "GET")
          return json({
            managementBusy:
              launching || artifacts.isUploading() || deployments.hasRunning(),
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
        const projectMatch = path.match(
          /^\/api\/projects\/([a-zA-Z0-9_-]{1,64})$/,
        );
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
            if (shuttingDown) fail(503, "Shutting down");
            if (typeof b.artifactId !== "string")
              fail(400, "Artifact required");
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
      } catch (e) {
        if (e instanceof HTTPError) return json({ error: e.message }, e.status);
        console.error(
          "Request failed:",
          e instanceof Error ? e.message : "unknown",
        );
        return json({ error: "Internal server error" }, 500);
      }
    },
  });
  const stop = async () => {
    shuttingDown = true;
    artifacts.shutdown();
    deployments.cancelAll();
    await server.stop(true);
    await Promise.all([deployments.waitForIdle(), artifacts.waitForIdle()]);
    store.close();
  };
  console.log(`Hoist: ${origin} (bind ${config.host}:${config.port})`);
  if (!store.getAccount())
    console.log(
      "No accounts configured. Stop server and add an account using CLI.",
    );
  return { server, stop };
}
