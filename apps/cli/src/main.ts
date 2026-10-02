import { initData, Store, defaultConfig, validId } from "@hoist/server/store";
import { acquireDataLock, serve } from "@hoist/server/runtime";
import { parseProject, createProjects } from "@hoist/server/projects";
import { readScript } from "@hoist/server/scripts";
import { resolve } from "node:path";
import { assetsDir } from "@hoist/web/assets";
import { readPassword } from "./password";
import { resolveDataDir } from "@hoist/server/paths";
const HELP = `Hoist (Bun, Linux)
  hoist init --data-dir /absolute/install-dir
  hoist user set USER [--password-stdin] --data-dir DIR
  hoist user list --data-dir DIR
  hoist user remove USER --data-dir DIR
  hoist project create NAME [--script FILE] [--timeout 300] [--data-dir DIR]
  hoist project set ID --name NAME --script /absolute/trusted.sh --timeout 300 --data-dir DIR
  hoist project list --data-dir DIR
  hoist project remove ID --data-dir DIR
  hoist config list --data-dir DIR
  hoist config set KEY VALUE --data-dir DIR
  hoist serve --data-dir DIR
The data directory contains hoist.sqlite, deployment files and bounded deployment logs.
Stop the server before changing accounts, projects or config.
Passwords are prompted with masked input and confirmation. Use --password-stdin for automation, never argv.
--data-dir is optional: flag > HOIST_DATA_DIR > ~/.hoist/settings.json (dataDir) > ~/.hoist/data.
The development CLI defaults to the repository .data instead of home settings.
All servers read allowedIP from ~/.hoist/settings.json (default: 127.0.0.1). Accepts one IP or CIDR; restart to apply.
Optional trustedProxy accepts one proxy IP or CIDR and enables validated X-Forwarded-For client IPs.
`;
export async function main(argv: string[], developmentDataDir?: string) {
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
  const data = resolveDataDir(options.get("--data-dir"), {
    developmentDataDir,
  });
  const { dir } = initData(data);
  const command = positional[0];
  if (command === "serve") {
    serve(dir);
    return;
  }
  const release = acquireDataLock(dir);
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
        let password = await readPassword(options.has("--password-stdin"));
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
      if (action === "create") {
        const project = createProjects(store, assetsDir, () => false).create({
          name: id,
          timeoutSeconds: Number(options.get("--timeout") || 300),
          ...(options.has("--script")
            ? { scriptContent: readScript(resolve(options.get("--script")!)) }
            : {}),
        });
        console.log(`Project created: ${project.id}`);
        return;
      }
      if (action === "list") {
        for (const p of store.getProjects())
          console.log(`${p.id}\t${p.name}\t${p.script}`);
        return;
      }
      if (!id || !validId(id)) throw new Error("Invalid project ID");
      if (action === "set") {
        const project = parseProject(dir, assetsDir, {
          id,
          name: options.get("--name") || id,
          script: options.get("--script"),
          timeoutSeconds: Number(options.get("--timeout") || 300),
        });
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
    release();
  }
}
