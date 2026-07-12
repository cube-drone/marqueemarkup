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

step("typescript: build all workspaces (dist)", "npm run build --workspaces");
step("typescript: typecheck all workspaces", "npm run check --workspaces");
step("typescript: test all workspaces", "npm test --workspaces");
step("rust: parser tests", "cargo test --quiet", `${root}/rust/parser`);
step("rust: renderer tests", "cargo test --quiet", `${root}/rust/html_renderer`);
step("rust: omnibus tests (incl. npm lockstep pins)", "cargo test --quiet", `${root}/rust/markup`);
step(
  "rust: clippy (warnings are errors)",
  "cargo clippy --all-targets --quiet -- -D warnings",
  `${root}/rust/parser`,
);
step(
  "rust: clippy renderer (warnings are errors)",
  "cargo clippy --all-targets --quiet -- -D warnings",
  `${root}/rust/html_renderer`,
);
step(
  "rust: clippy omnibus (warnings are errors)",
  "cargo clippy --all-targets --quiet -- -D warnings",
  `${root}/rust/markup`,
);
// The crate-side packaging check (the analog of the npm pack-smoke below).
// Only the parser: `cargo package` for the renderer and the omnibus
// verifies their registry dependencies exist on crates.io, which is only
// true after first publish - add them here once the parser ships.
step("rust: cargo package (parser)", "cargo package --quiet", `${root}/rust/parser`);
step(
  "differential fuzz (10k documents, seed 0)",
  "cargo run --release --quiet --bin diff_fuzz -- --n 10000 --seed 0",
  `${root}/rust/parser`,
);

// The consumer smoke: pack the parser (the dependency-free package), install
// the tarball in a temp project, and import it from PLAIN node - no
// workspace symlinks, no conditions, no bundler. This is the exact test
// that once caught raw-.ts publishing being broken under node_modules.
{
  const { mkdtempSync, readdirSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const tmp = mkdtempSync(join(tmpdir(), "marquee-release-"));
  try {
    step(
      "consumer smoke: pack the parser",
      `npm pack --workspace=@cube-drone/marquee-parser --pack-destination ${tmp}`,
    );
    const tarball = readdirSync(tmp).find((f) => f.endsWith(".tgz"));
    if (tarball === undefined) {
      console.error("release-check FAILED: no tarball produced");
      process.exit(1);
    }
    step("consumer smoke: fresh install", `npm init -y >/dev/null && npm install --no-fund --no-audit ./${tarball}`, tmp);
    step(
      "consumer smoke: import from plain node",
      `node --input-type=module -e "import('@cube-drone/marquee-parser').then(m => { if (m.parse('# hi\\n').type !== 'document') throw new Error('bad parse'); console.log('consumer import OK'); })"`,
      tmp,
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

console.log("\nrelease-check: all green. See RELEASING.md for the publish order.");
