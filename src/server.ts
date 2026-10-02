import {
  openSync,
  writeSync,
  closeSync,
  unlinkSync,
  readFileSync,
  appendFileSync,
  writeFileSync,
  existsSync,
  realpathSync,
  lstatSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import {
  type Config,
  type State,
  type Project,
  type Deployment,
  loadState,
  saveState,
  projectDir,
  cleanOrphans,
  storedArtifactBytes,
} from "./store";
const assets = join(import.meta.dir, "../public");
const token = () => randomBytes(32).toString("hex");
const COOKIE_PREFIX = "hoist_session=";
const sessionToken = (req: Request) =>
  (req.headers.get("cookie") || "")
    .split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith(COOKIE_PREFIX))
    ?.slice(COOKIE_PREFIX.length);
class HTTPError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const fail = (status: number, message: string): never => {
  throw new HTTPError(status, message);
};
const security = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "Cache-Control": "no-store",
};
function json(
  value: unknown,
  status = 200,
  extra: Record<string, string> = {},
) {
  return Response.json(value, { status, headers: { ...security, ...extra } });
}
export async function smallJSON(req: Request) {
  if (!(req.headers.get("content-type") || "").startsWith("application/json"))
    fail(415, "JSON content type required");
  if (!req.body) fail(400, "Body required");
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0,
    timedOut = false;
  const deadline = setTimeout(() => {
    timedOut = true;
    void reader.cancel().catch(() => {});
  }, 10000);
  try {
    while (true) {
      const r = await reader.read();
      if (timedOut) fail(408, "JSON body deadline exceeded");
      if (r.done) break;
      total += r.value.length;
      if (total > 8192) fail(413, "Request too large");
      chunks.push(r.value);
    }
    let value: unknown;
    try {
      value = JSON.parse(Buffer.concat(chunks).toString());
    } catch {
      fail(400, "Invalid JSON");
    }
    if (!value || typeof value !== "object" || Array.isArray(value))
      fail(400, "JSON object required");
    return value as Record<string, any>;
  } catch (e) {
    await reader.cancel().catch(() => {});
    throw e;
  } finally {
    clearTimeout(deadline);
  }
}
export function startServer(dir: string, config: Config) {
  const states = new Map<string, State>();
  for (const p of config.projects) {
    const s = loadState(dir, p);
    cleanOrphans(dir, p, s);
    states.set(p.id, s);
  }
  const sessions = new Map<
    string,
    { username: string; csrf: string; expires: number }
  >();
  const attempts = new Map<string, { count: number; until: number }>();
  let verifying = false;
  let uploading = false;
  let shuttingDown = false;
  const runs = new Map<
    string,
    {
      child: ChildProcess;
      deployment: Deployment;
      cancel: (reason: "cancelled" | "timed_out") => void;
    }
  >();
  const origin =
    config.publicOrigin ||
    `http://${config.host === "::1" ? "[::1]" : config.host}:${config.port}`;
  const cookie = (v: string, clear = false) =>
    `${COOKIE_PREFIX}${v}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${clear ? 0 : config.sessionHours * 3600}${config.publicOrigin ? "; Secure" : ""}`;
  const getSession = (req: Request) => {
    const v = sessionToken(req);
    const s = v ? sessions.get(v) : undefined;
    if (!s || s.expires < Date.now()) {
      if (v) sessions.delete(v);
      fail(401, "Login required");
    }
    return s;
  };
  function sameOrigin(req: Request) {
    if (req.headers.get("origin") !== origin) fail(403, "Origin rejected");
  }
  function csrf(req: Request) {
    sameOrigin(req);
    const s = getSession(req);
    if (req.headers.get("x-csrf-token") !== s.csrf)
      fail(403, "CSRF token rejected");
    return s;
  }
  function trim(p: Project, s: State) {
    while (s.artifacts.length > config.artifactRetention) {
      const removed = s.artifacts.shift()!;
      unlinkSync(join(projectDir(dir, p.id), "artifacts", removed.id + ".bin"));
    }
    while (s.deployments.length > config.historyRetention) {
      const removed = s.deployments.shift()!;
      const log = join(projectDir(dir, p.id), "logs", removed.id + ".log");
      if (existsSync(log)) unlinkSync(log);
    }
    saveState(dir, p, s);
  }
  function launch(p: Project, s: State, artifactId: string, version: string) {
    if (runs.size)
      fail(409, "A deployment is already running; wait for it to finish");
    const a = s.artifacts.find((a) => a.id === artifactId);
    if (!a) fail(404, "Artifact not found");
    if (
      typeof version !== "string" ||
      version.length > 128 ||
      !version.length ||
      /[\x00-\x1f\x7f]/.test(version)
    )
      fail(400, "Version must be 1–128 characters without control characters");
    if (!existsSync(p.script) || !lstatSync(p.script).isFile())
      fail(400, "Configured script is missing");
    const script = realpathSync(p.script);
    if (
      script === dir ||
      script.startsWith(join(dir, "projects") + "/") ||
      script.startsWith(assets + "/")
    )
      fail(400, "Script must be outside uploaded artifacts and web assets");
    const deployment: Deployment = {
      id: randomUUID(),
      artifactId,
      version,
      status: "running",
      startedAt: new Date().toISOString(),
    };
    const logPath = join(projectDir(dir, p.id), "logs", deployment.id + ".log");
    writeFileSync(logPath, "", { mode: 0o600, flag: "wx" });
    s.deployments.push(deployment);
    trim(p, s);
    let written = 0,
      truncated = false;
    const capture = (data: Buffer) => {
      const remaining = config.maxLogBytes - written;
      if (written < config.maxLogBytes) {
        const take = data.subarray(0, config.maxLogBytes - written);
        appendFileSync(logPath, take);
        written += take.length;
      }
      if (!truncated && data.length > remaining) {
        truncated = true;
        appendFileSync(
          logPath,
          "\n[log limit reached; further output discarded]\n",
        );
      }
    };
    let child: ChildProcess;
    try {
      child = spawn(
        "/bin/sh",
        [
          script,
          join(projectDir(dir, p.id), "artifacts", a.id + ".bin"),
          version,
        ],
        {
          cwd: dirname(script),
          detached: true,
          stdio: ["ignore", "pipe", "pipe"],
          env: { PATH: "/usr/local/bin:/usr/bin:/bin", LANG: "C.UTF-8" },
        },
      );
    } catch {
      deployment.status = "failed";
      deployment.finishedAt = new Date().toISOString();
      deployment.exitCode = null;
      saveState(dir, p, s);
      fail(500, "Could not start configured script");
    }
    let reason: "cancelled" | "timed_out" | undefined;
    let force: ReturnType<typeof setTimeout> | undefined;
    const signal = (sig: NodeJS.Signals) => {
      try {
        if (child.pid) process.kill(-child.pid, sig);
      } catch {}
    };
    const cancel = (why: "cancelled" | "timed_out") => {
      if (reason) return;
      reason = why;
      signal("SIGTERM");
      force = setTimeout(() => signal("SIGKILL"), 2000);
    };
    const timer = setTimeout(
      () => cancel("timed_out"),
      p.timeoutSeconds * 1000,
    );
    runs.set(p.id, { child, deployment, cancel });
    child.stdout?.on("data", capture);
    child.stderr?.on("data", capture);
    child.on("error", () => capture(Buffer.from("Could not execute script\n")));
    child.on("close", (code) => {
      clearTimeout(timer);
      if (force) clearTimeout(force); // Kill any same-group descendants still running after script exit.
      signal("SIGKILL");
      deployment.status = reason || (code === 0 ? "succeeded" : "failed");
      deployment.exitCode = code;
      deployment.finishedAt = new Date().toISOString();
      runs.delete(p.id);
      saveState(dir, p, s);
    });
    return deployment;
  }
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
        if (method === "GET" && ["/", "/app.js", "/style.css"].includes(path))
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
        if (path === "/api/login" && method === "POST") {
          sameOrigin(req);
          const ip = server.requestIP(req)?.address || "unknown";
          const now = Date.now();
          for (const [k, v] of attempts) if (v.until < now) attempts.delete(k);
          const prior = attempts.get(ip);
          if (prior && prior.count >= 10)
            fail(429, "Too many attempts; retry in 15 minutes");
          if (verifying) fail(429, "Login busy; retry shortly");
          if (!prior && attempts.size >= 1024)
            fail(429, "Login capacity reached");
          // Reserve before reading any body: only one bounded parser/bcrypt worker can run.
          verifying = true;
          attempts.set(ip, {
            count: (prior?.count || 0) + 1,
            until: prior?.until || now + 15 * 60 * 1000,
          });
          let ok = false;
          let body: any;
          try {
            body = await smallJSON(req);
            if (
              typeof body.username !== "string" ||
              body.username.length > 64 ||
              typeof body.password !== "string" ||
              Buffer.byteLength(body.password, "utf8") > 72
            )
              fail(400, "Invalid credentials");
            const a = config.accounts.find((a) => a.username === body.username);
            const verified = await Bun.password.verify(
              body.password,
              a?.passwordHash || dummyHash,
            );
            ok = Boolean(a) && verified;
          } finally {
            verifying = false;
          }
          if (!ok) fail(401, "Invalid credentials");
          attempts.delete(ip);
          for (const [k, s] of sessions)
            if (s.expires < now) sessions.delete(k);
          if (sessions.size >= 128) fail(429, "Session capacity reached");
          const id = token();
          const s = {
            username: body.username,
            csrf: token(),
            expires: now + config.sessionHours * 3600 * 1000,
          };
          sessions.set(id, s);
          return json({ username: s.username, csrf: s.csrf }, 200, {
            "Set-Cookie": cookie(id),
          });
        }
        if (path === "/api/me" && method === "GET") {
          const s = getSession(req);
          return json({ username: s.username, csrf: s.csrf });
        }
        if (path === "/api/logout" && method === "POST") {
          csrf(req);
          const v = sessionToken(req);
          if (v) sessions.delete(v);
          return json({ ok: true }, 200, { "Set-Cookie": cookie("", true) });
        }
        getSession(req);
        if (method !== "GET") csrf(req);
        if (path === "/api/projects" && method === "GET")
          return json({
            projects: config.projects.map((p) => ({
              id: p.id,
              name: p.name,
              running: runs.has(p.id),
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
        if (method === "POST" && match[2] === "artifacts" && !match[3]) {
          if (uploading || runs.has(p.id)) fail(409, "Upload/deployment busy");
          uploading = true;
          const id = randomUUID(),
            target = join(projectDir(dir, p.id), "artifacts", id + ".bin");
          let fd: number | undefined,
            reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
          let size = 0,
            timedOut = false;
          const uploadDeadline = setTimeout(() => {
            timedOut = true;
            void reader?.cancel().catch(() => {});
          }, 300000);
          try {
            let name: string;
            try {
              name = decodeURIComponent(
                req.headers.get("x-artifact-name") || "artifact.bin",
              );
            } catch {
              fail(400, "Invalid filename");
            }
            if (
              name.length > 160 ||
              !name.length ||
              /[\x00-\x1f\x7f/\\]/.test(name) ||
              name === "." ||
              name === ".."
            )
              fail(400, "Invalid filename");
            const used = storedArtifactBytes(dir);
            const length = req.headers.get("content-length");
            if (
              length &&
              (!/^\d+$/.test(length) ||
                Number(length) > config.maxArtifactBytes)
            )
              fail(413, "Artifact too large");
            if (length && used + Number(length) > config.maxStorageBytes)
              fail(413, "Storage quota reached");
            if (!req.body) fail(400, "Artifact body required");
            fd = openSync(target, "wx", 0o600);
            reader = req.body.getReader();
            while (true) {
              const chunk = await reader.read();
              if (timedOut) fail(408, "Upload deadline exceeded");
              if (chunk.done) break;
              size += chunk.value.length;
              if (
                size > config.maxArtifactBytes ||
                used + size > config.maxStorageBytes
              )
                fail(413, "Upload or storage limit exceeded");
              let offset = 0;
              while (offset < chunk.value.length)
                offset += writeSync(fd, chunk.value, offset);
            }
            if (!size) fail(400, "Empty artifact");
            closeSync(fd);
            fd = undefined;
            const artifact = {
              id,
              name,
              size,
              createdAt: new Date().toISOString(),
            };
            s.artifacts.push(artifact);
            trim(p, s);
            return json({ artifact }, 201);
          } catch (e) {
            if (reader) await reader.cancel().catch(() => {});
            if (fd !== undefined) closeSync(fd);
            if (existsSync(target)) unlinkSync(target);
            throw e;
          } finally {
            clearTimeout(uploadDeadline);
            uploading = false;
          }
        }
        if (method === "POST" && match[2] === "deploy" && !match[3]) {
          if (uploading) fail(409, "Upload busy");
          const b = await smallJSON(req);
          if (typeof b.artifactId !== "string") fail(400, "Artifact required");
          return json(
            { deployment: launch(p, s, b.artifactId, b.version) },
            202,
          );
        }
        if (match[2] === "deployments" && match[3]) {
          const d = s.deployments.find((d) => d.id === match[3]);
          if (!d) fail(404, "Deployment not found");
          if (method === "GET" && !match[4]) {
            const logPath = join(projectDir(dir, p.id), "logs", d.id + ".log");
            return json({
              deployment: d,
              log: existsSync(logPath) ? readFileSync(logPath, "utf8") : "",
            });
          }
          if (method === "POST" && match[4] === "cancel") {
            const run = runs.get(p.id);
            if (!run || run.deployment.id !== d.id)
              fail(409, "Deployment is not running");
            run.cancel("cancelled");
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
    for (const r of runs.values()) r.cancel("cancelled");
    await server.stop(true);
    await new Promise<void>((resolve) => {
      const end = () => (runs.size ? setTimeout(end, 50) : resolve());
      end();
    });
  };
  console.log(`Hoist: ${origin} (bind ${config.host}:${config.port})`);
  if (!config.accounts.length)
    console.log(
      "No accounts configured. Stop server and add an account using CLI.",
    );
  return { server, stop };
}
// Fixed work factor for unknown users too; no valid account uses this hash.
const dummyHash =
  "$2b$12$TSS.fGeGXRFHYIA9/xLE5ODDaSPtSLFK.AxMgCpSQOXrEG0k.tNYu";
