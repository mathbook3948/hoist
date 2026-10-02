import { initData, Store } from "@hoist/server/store";
import { acquireDataLock, serve } from "@hoist/server/runtime";
import { resolveDataDir } from "@hoist/server/paths";
import { runCommand } from "./commands";

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
Optional host overrides the database bind address, including 0.0.0.0 or :: for all interfaces. Direct HTTP is supported.
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
    await runCommand(store, positional, options);
  } finally {
    store?.close();
    release();
  }
}
