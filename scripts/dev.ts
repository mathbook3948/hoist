import { resolve, dirname } from "node:path";
import { createRequire } from "node:module";
import { initData, Store } from "../apps/server/src/store";
import { acquireDataLock } from "../apps/server/src/runtime";

const root = resolve(import.meta.dir, "..");
const { dir } = initData(process.env.HOIST_DATA_DIR || resolve(root, ".data"));
const release = acquireDataLock(dir);
let config;
let store: Store | undefined;
try {
  store = new Store(dir);
  config = store.getConfig();
} finally {
  store?.close();
  release();
}
if (config.publicOrigin || config.host !== "127.0.0.1")
  throw new Error(
    "Development requires a loopback HTTP data directory (host 127.0.0.1, publicOrigin null)",
  );
const webRoot = resolve(root, "apps/web");
const requireWeb = createRequire(resolve(webRoot, "package.json"));
const vite = resolve(
  dirname(requireWeb.resolve("vite/package.json")),
  "bin/vite.js",
);
const children = [
  Bun.spawn(
    [
      process.execPath,
      "--watch",
      resolve(root, "apps/server/src/index.ts"),
      "--data-dir",
      dir,
    ],
    { cwd: root, stdout: "inherit", stderr: "inherit" },
  ),
  Bun.spawn([process.execPath, vite], {
    cwd: webRoot,
    stdout: "inherit",
    stderr: "inherit",
    env: {
      ...process.env,
      HOIST_API_ORIGIN: `http://127.0.0.1:${config.port}`,
    },
  }),
];
let stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  await Promise.all(children.map((child) => child.exited));
  process.exit(code);
}
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
console.log("Hoist development UI: http://127.0.0.1:5173");
const first = await Promise.race(children.map((child) => child.exited));
await stop(first || 1);
