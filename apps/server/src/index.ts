import { serve } from "./runtime";

try {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log("bun run server --data-dir DIR (or HOIST_DATA_DIR)");
  } else {
    if (
      args.length &&
      (args.length !== 2 || args[0] !== "--data-dir" || !args[1])
    ) {
      throw new Error("Usage: bun run server --data-dir DIR");
    }
    const data = args[1] || process.env.HOIST_DATA_DIR;
    if (!data) throw new Error("--data-dir is required");
    serve(data);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
