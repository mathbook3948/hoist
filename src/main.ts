import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { initData, Store, defaultConfig, validId } from "./store";
import { startServer } from "./server";
import { parseProject } from "./projects";
const HELP = `Hoist (Bun, Linux)
  bun src/main.ts init --data-dir /absolute/install-dir
  bun src/main.ts user set USER --password-stdin --data-dir DIR
  bun src/main.ts user list --data-dir DIR
  bun src/main.ts user remove USER --data-dir DIR
  bun src/main.ts project set ID --name NAME --script /absolute/trusted.sh --timeout 300 --data-dir DIR
  bun src/main.ts project list --data-dir DIR
  bun src/main.ts project remove ID --data-dir DIR
  bun src/main.ts config list --data-dir DIR
  bun src/main.ts config set KEY VALUE --data-dir DIR
  bun src/main.ts serve --data-dir DIR
The data directory contains hoist.sqlite, deployment files and bounded deployment logs.
Stop the server before changing accounts, projects or config. Supply passwords over stdin, never argv.
`;
export async function main(argv: string[]) {
  if (!argv.length || argv.includes("--help")) {
    console.log(HELP);
    return;
  }
  const positional: string[] = [];
  const options = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      if (argv[i] === "--password-stdin") {
        options.set(argv[i], "true");
        continue;
      }
      if (
        !["--data-dir", "--name", "--script", "--timeout"].includes(argv[i]) ||
        !argv[i + 1] ||
        argv[i + 1].startsWith("--")
      )
        throw new Error("Unknown/incomplete option");
      options.set(argv[i], argv[++i]);
    } else positional.push(argv[i]);
  }
  const data = options.get("--data-dir") || process.env.HOIST_DATA_DIR;
  if (!data) throw new Error("--data-dir is required");
  const { dir } = initData(data);
  const lock = join(dir, "runtime.lock");
  function acquire() {
    try {
      mkdirSync(lock, { mode: 0o700 });
    } catch {
      if (!existsSync(join(lock, "pid")))
        throw new Error(
          "Data directory locked; inspect runtime.lock if previous process crashed",
        );
      const pid = Number(readFileSync(join(lock, "pid"), "utf8"));
      let live = true;
      try {
        process.kill(pid, 0);
      } catch (e: any) {
        if (e.code === "ESRCH") live = false;
      }
      if (live)
        throw new Error("Stop the running server before making changes");
      rmSync(lock, { recursive: true });
      mkdirSync(lock, { mode: 0o700 });
    }
    writeFileSync(join(lock, "pid"), String(process.pid), { mode: 0o600 });
  }
  const command = positional[0];
  if (command === "serve") {
    acquire();
    let store: Store | undefined;
    let runtime: ReturnType<typeof startServer>;
    try {
      store = new Store(dir);
      runtime = startServer(store);
    } catch (e) {
      store?.close();
      rmSync(lock, { recursive: true });
      throw e;
    }
    let exiting = false;
    const shutdown = async () => {
      if (exiting) return;
      exiting = true;
      await runtime.stop();
      rmSync(lock, { recursive: true });
      process.exit(0);
    };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
    return;
  }
  acquire();
  let store: Store | undefined;
  try {
    store = new Store(dir);
    if (command === "init") {
      console.log(`Database ready: ${store.path}`);
      return;
    }
    if (command === "config") {
      if (positional[1] === "list") {
        console.log(JSON.stringify(store.getConfig(), null, 2));
        return;
      }
      if (positional[1] === "set") {
        const key = positional[2],
          value = positional[3];
        if (!Object.hasOwn(defaultConfig, key) || value === undefined)
          throw new Error("Unknown/incomplete setting");
        const config = store.getConfig();
        const parsed =
          key === "publicOrigin"
            ? value === "null"
              ? null
              : value
            : key === "host"
              ? value
              : Number(value);
        store.setConfig({ ...config, [key]: parsed });
        console.log(`Setting saved: ${key}`);
        return;
      }
    }
    if (command === "user") {
      const action = positional[1],
        username = positional[2];
      if (action === "list") {
        console.log(store.getAccount()?.username || "(no accounts)");
        return;
      }
      if (!username || !validId(username)) throw new Error("Invalid username");
      if (action === "set") {
        const old = store.getAccount();
        if (old && old.username !== username)
          throw new Error("Only one administrator account is supported");
        if (!options.has("--password-stdin"))
          throw new Error("--password-stdin is required");
        let password = (await Bun.stdin.text()).replace(/\r?\n$/, "");
        if (
          password.length < 12 ||
          Buffer.byteLength(password, "utf8") > 72 ||
          /[\x00-\x1f\x7f]/.test(password)
        )
          throw new Error(
            "Password must be at least 12 characters, at most 72 UTF-8 bytes, without control characters",
          );
        const passwordHash = await Bun.password.hash(password, {
          algorithm: "bcrypt",
          cost: 12,
        });
        password = "";
        store.setAccount({ username, passwordHash });
        console.log(`Account saved: ${username}`);
        return;
      }
      if (action === "remove") {
        store.removeAccount(username);
        console.log(`Account removed: ${username}`);
        return;
      }
    }
    if (command === "project") {
      const action = positional[1],
        id = positional[2];
      if (action === "list") {
        for (const p of store.getProjects())
          console.log(`${p.id}\t${p.name}\t${p.script}`);
        return;
      }
      if (!id || !validId(id)) throw new Error("Invalid project ID");
      if (action === "set") {
        const project = parseProject(
          dir,
          resolve(import.meta.dir, "../public"),
          {
            id,
            name: options.get("--name") || id,
            script: options.get("--script"),
            timeoutSeconds: Number(options.get("--timeout") || 300),
          },
        );
        store.setProject(project);
        console.log(`Project saved: ${id}`);
        return;
      }
      if (action === "remove") {
        store.removeProject(id);
        console.log(`Project unregistered: ${id} (data retained)`);
        return;
      }
    }
    throw new Error("Unknown command. Use --help");
  } finally {
    store?.close();
    rmSync(lock, { recursive: true });
  }
}
if (import.meta.main)
  main(process.argv.slice(2)).catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
