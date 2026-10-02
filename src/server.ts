import { join } from "node:path";
import { type Config, type State, loadState, cleanOrphans } from "./store";
import { HTTPError, fail, json, security, smallJSON } from "./http";
import { createAuth } from "./auth";
import { createArtifacts } from "./artifacts";
import { createDeployments } from "./deployments";

const assets = join(import.meta.dir, "../public");
const staticPaths = new Set([
  "/",
  "/app.js",
  "/style.css",
  "/state.js",
  "/api.js",
  "/render.js",
  "/polling.js",
  "/events.js",
]);

export function startServer(dir: string, config: Config) {
  const states = new Map<string, State>();
  for (const p of config.projects) {
    const s = loadState(dir, p);
    cleanOrphans(dir, p, s);
    states.set(p.id, s);
  }
  const origin =
    config.publicOrigin ||
    `http://${config.host === "::1" ? "[::1]" : config.host}:${config.port}`;

  const auth = createAuth(config, origin);
  const deployments = createDeployments(dir, config, assets);
  const artifacts = createArtifacts(dir, config, deployments.isRunning);
  let shuttingDown = false;
  const server = Bun.serve({
    hostname: config.host,
    port: config.port,
    idleTimeout: 30,
    maxRequestBodySize: config.maxArtifactBytes,
    async fetch(req, server) {
      try {
        if (shuttingDown) fail(503, "Shutting down");
        const url = new URL(req.url);
        const expectedHost = new URL(origin).host;
        if (req.headers.get("host") !== expectedHost)
          fail(403, "Host rejected");
        const path = url.pathname;
        const method = req.method;
        if (method === "GET" && staticPaths.has(path))
          return new Response(
            Bun.file(join(assets, path === "/" ? "index.html" : path.slice(1))),
            {
              headers: {
                ...security,
                "Content-Type":
                  path === "/"
                    ? "text/html; charset=utf-8"
                    : path.endsWith(".js")
                      ? "text/javascript; charset=utf-8"
                      : "text/css; charset=utf-8",
              },
            },
          );
        if (path === "/api/login" && method === "POST")
          return await auth.login(
            req,
            server.requestIP(req)?.address || "unknown",
          );
        if (path === "/api/me" && method === "GET") return auth.me(req);
        if (path === "/api/logout" && method === "POST")
          return auth.logout(req);
        auth.getSession(req);
        if (method !== "GET") auth.csrf(req);
        if (path === "/api/projects" && method === "GET")
          return json({
            projects: config.projects.map((p) => ({
              id: p.id,
              name: p.name,
              running: deployments.isRunning(p.id),
              ...states.get(p.id),
            })),
          });
        const match = path.match(
          /^\/api\/projects\/([a-zA-Z0-9_-]{1,64})\/(artifacts|deploy|deployments)(?:\/([a-zA-Z0-9_-]{1,64})(?:\/(cancel))?)?$/,
        );
        if (!match) fail(404, "Not found");
        const p = config.projects.find((p) => p.id === match[1]);
        if (!p) fail(404, "Project not found");
        const s = states.get(p.id)!;
        if (method === "POST" && match[2] === "artifacts" && !match[3])
          return json({ artifact: await artifacts.upload(req, p, s) }, 201);
        if (method === "POST" && match[2] === "deploy" && !match[3]) {
          if (artifacts.isUploading()) fail(409, "Upload busy");
          const b = await smallJSON(req);
          if (typeof b.artifactId !== "string") fail(400, "Artifact required");
          return json(
            { deployment: deployments.launch(p, s, b.artifactId, b.version) },
            202,
          );
        }
        if (match[2] === "deployments" && match[3]) {
          deployments.get(p, s, match[3]);
          if (method === "GET" && !match[4])
            return json(deployments.read(p, s, match[3]));
          if (method === "POST" && match[4] === "cancel") {
            deployments.cancel(p, s, match[3]);
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
    deployments.cancelAll();
    await server.stop(true);
    await deployments.waitForIdle();
  };
  console.log(`Hoist: ${origin} (bind ${config.host}:${config.port})`);
  if (!config.accounts.length)
    console.log(
      "No accounts configured. Stop server and add an account using CLI.",
    );
  return { server, stop };
}
