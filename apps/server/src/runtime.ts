import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { initData, Store } from "./store";
import { startServer } from "./server";

export function acquireDataLock(dir: string) {
  const lock = join(dir, "runtime.lock");
  try {
    mkdirSync(lock, { mode: 0o700 });
  } catch {
    if (!existsSync(join(lock, "pid"))) {
      throw new Error(
        "Data directory locked; inspect runtime.lock if previous process crashed",
      );
    }
    const pid = Number(readFileSync(join(lock, "pid"), "utf8"));
    let live = true;
    try {
      process.kill(pid, 0);
    } catch (error: any) {
      if (error.code === "ESRCH") live = false;
    }
    if (live) throw new Error("Stop the running server before making changes");
    rmSync(lock, { recursive: true });
    mkdirSync(lock, { mode: 0o700 });
  }
  writeFileSync(join(lock, "pid"), String(process.pid), { mode: 0o600 });
  return () => rmSync(lock, { recursive: true });
}

export function serve(data: string) {
  const { dir } = initData(data);
  const release = acquireDataLock(dir);
  let store: Store | undefined;
  let runtime: ReturnType<typeof startServer>;
  try {
    store = new Store(dir);
    runtime = startServer(store);
  } catch (error) {
    store?.close();
    release();
    throw error;
  }
  let exiting = false;
  const shutdown = async () => {
    if (exiting) return;
    exiting = true;
    await runtime.stop();
    release();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
