import { serve } from "./runtime";
import { resolveDataDir } from "./paths";

try {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log(
      "bun run server [--data-dir DIR]\nData directory: flag > HOIST_DATA_DIR > ~/.hoist/settings.json (dataDir) > ~/.hoist/data",
    );
  } else {
    if (
      args.length &&
      (args.length !== 2 || args[0] !== "--data-dir" || !args[1])
    ) {
      throw new Error("Usage: bun run server [--data-dir DIR]");
    }
    serve(resolveDataDir(args[1]));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
