import { assetsDir as assets, staticFiles } from "@hoist/web/assets";
import { Store, validateConfig } from "./store";
import { isIP } from "node:net";
import { networkInterfaces } from "node:os";
import { HTTPError, fail, json, security } from "./http";
import { createAPI } from "./api";
import { readSettings, type Settings } from "./settings";
import { createIPFilter, createClientIPResolver } from "./network";

export function startServer(store: Store, settings: Settings = readSettings()) {
  const isAllowedIP = createIPFilter(settings.allowedIP);
  const resolveClientIP = createClientIPResolver(settings.trustedProxy);
  const config = {
    ...store.getConfig(),
    ...(settings.host !== undefined ? { host: settings.host } : {}),
  };
  validateConfig(config);
  store.recover();
  for (const p of store.getProjects(true)) store.trim(p.id, config);
  const origin =
    config.publicOrigin ||
    `http://${isIP(config.host) === 6 ? `[${config.host}]` : config.host}:${config.port}`;

  const wildcard =
    !config.publicOrigin && ["0.0.0.0", "::"].includes(config.host);
  const allowedHosts = new Set(
    wildcard
      ? Object.values(networkInterfaces())
          .flatMap((addresses) => addresses || [])
          .filter(
            ({ address }) =>
              !address.includes("%") &&
              (config.host === "::" || isIP(address) === 4),
          )
          .map(
            ({ address }) =>
              new URL(
                `http://${isIP(address) === 6 ? `[${address}]` : address}:${config.port}`,
              ).host,
          )
          .concat(new URL(`http://localhost:${config.port}`).host)
      : [new URL(origin).host],
  );
  let shuttingDown = false;
  const api = createAPI(
    store,
    config,
    assets,
    wildcard ? null : origin,
    () => shuttingDown,
  );
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
        if (!allowedHosts.has(req.headers.get("host") || ""))
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
        return await api.handle(req, path, clientIP!);
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
    api.shutdown();
    await server.stop(true);
    await api.waitForIdle();
    store.close();
  };
  console.log(`Hoist: ${origin} (bind ${config.host}:${config.port})`);
  if (!store.getAccount())
    console.log(
      "No accounts configured. Stop server and add an account using CLI.",
    );
  return { server, stop };
}
