import { resolve } from "node:path";
import { main } from "./main";

await main(
  process.argv.slice(2),
  resolve(import.meta.dir, "../../../.data"),
).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
