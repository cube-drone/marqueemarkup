// Pre-flight for a release: the whole train, both languages, plus a clean
// working tree. Exits nonzero on the first failure.
//
//     npm run release-check

import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

function step(label: string, command: string, cwd = root): void {
  process.stdout.write(`== ${label}\n`);
  try {
    execSync(command, { cwd, stdio: "inherit" });
  } catch {
    console.error(`\nrelease-check FAILED at: ${label}`);
    process.exit(1);
  }
}

// A release is cut from committed work, nothing else.
const dirty = execSync("git status --porcelain", { cwd: root }).toString().trim();
if (dirty !== "") {
  console.error("release-check FAILED: working tree is dirty:\n" + dirty);
  process.exit(1);
}

step("typescript: typecheck all workspaces", "npm run check --workspaces");
step("typescript: test all workspaces", "npm test --workspaces");
step("rust: parser tests", "cargo test --quiet", `${root}/rust/parser`);
step("rust: renderer tests", "cargo test --quiet", `${root}/rust/html_renderer`);
step(
  "differential fuzz (10k documents, seed 0)",
  "cargo run --release --quiet --bin diff_fuzz -- --n 10000 --seed 0",
  `${root}/rust/parser`,
);

console.log("\nrelease-check: all green. See RELEASING.md for the publish order.");
