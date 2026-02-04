import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const roots = ["apps", "packages"];
const tests: string[] = [];

for (const root of roots) {
  walk(root);
}

const fastTests = tests
  .filter((file) => file.endsWith(".test.ts"))
  .filter((file) => !file.endsWith(".e2e.test.ts"))
  .filter((file) => !file.endsWith("/e2e.test.ts"))
  .filter((file) => !file.endsWith("/tournament.test.ts"))
  .sort();

if (fastTests.length === 0) {
  console.log("No fast tests found.");
  process.exit(0);
}

const result = spawnSync("bun", ["test", ...fastTests], {
  stdio: "inherit",
});

process.exit(result.status ?? 1);

function walk(dir: string): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === "node_modules" || entry === "target" || entry === "dist") {
        continue;
      }
      walk(full);
      continue;
    }
    if (entry.endsWith(".test.ts")) {
      tests.push(full);
    }
  }
}
