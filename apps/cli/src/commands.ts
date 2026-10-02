import { Store, defaultConfig, validId } from "@hoist/server/store";
import { parseProject, createProjects } from "@hoist/server/projects";
import { readScript } from "@hoist/server/scripts";
import { resolve } from "node:path";
import { assetsDir } from "@hoist/web/assets";
import { readPassword } from "./password";

export async function runCommand(
  store: Store,
  positional: string[],
  options: Map<string, string>,
) {
  const [command] = positional;
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
      const project = parseProject(store.dir, assetsDir, {
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
      console.log(`Project deleted: ${id}`);
      return;
    }
  }
  throw new Error("Unknown command. Use --help");
}
