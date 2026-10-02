import {
  existsSync,
  lstatSync,
  realpathSync,
  writeFileSync,
  appendFileSync,
  readFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import {
  type Config,
  type Project,
  type State,
  type Deployment,
  projectDir,
  saveState,
  trimState,
} from "./store";
import { fail } from "./http";

export function createDeployments(dir: string, config: Config, assets: string) {
  const runs = new Map<
    string,
    {
      child: ChildProcess;
      deployment: Deployment;
      cancel: (reason: "cancelled" | "timed_out") => void;
    }
  >();
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
    trimState(dir, config, p, s);
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

  function get(p: Project, s: State, id: string) {
    const deployment = s.deployments.find((d) => d.id === id);
    if (!deployment) fail(404, "Deployment not found");
    return deployment;
  }

  function read(p: Project, s: State, id: string) {
    const deployment = get(p, s, id);
    const logPath = join(projectDir(dir, p.id), "logs", deployment.id + ".log");
    return {
      deployment,
      log: existsSync(logPath) ? readFileSync(logPath, "utf8") : "",
    };
  }

  function cancel(p: Project, s: State, id: string) {
    const deployment = get(p, s, id);
    const run = runs.get(p.id);
    if (!run || run.deployment.id !== deployment.id)
      fail(409, "Deployment is not running");
    run.cancel("cancelled");
  }

  function cancelAll() {
    for (const r of runs.values()) r.cancel("cancelled");
  }

  function waitForIdle() {
    return new Promise<void>((resolve) => {
      const end = () => (runs.size ? setTimeout(end, 50) : resolve());
      end();
    });
  }

  return {
    launch,
    get,
    read,
    cancel,
    cancelAll,
    waitForIdle,
    isRunning: (projectId: string) => runs.has(projectId),
  };
}
