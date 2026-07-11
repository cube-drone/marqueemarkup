// Lockstep version sync: every publishable artifact in this repo carries
// the same version, because the spec + vectors + implementations are one
// conformance unit ("same number = passed the same corpus").
//
//     npm run set-version -- 0.2.0
//
// Touches: the root package.json, every workspace package.json (version AND
// internal @cube-drone/* dependency ranges), and both Cargo.tomls (version AND
// the path-dependency's version). Prints what changed; committing and
// tagging stay yours.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const version = process.argv[2];
if (version === undefined || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("usage: npm run set-version -- <MAJOR.MINOR.PATCH>");
  process.exit(2);
}

const root = fileURLToPath(new URL("..", import.meta.url));
const changed: string[] = [];

// -- npm side

const rootPkgPath = `${root}/package.json`;
const rootPkg = JSON.parse(readFileSync(rootPkgPath, "utf8"));
rootPkg.version = version;
writeFileSync(rootPkgPath, `${JSON.stringify(rootPkg, null, 2)}\n`);
changed.push("package.json");

for (const dir of rootPkg.workspaces as string[]) {
  const path = `${root}/${dir}/package.json`;
  const pkg = JSON.parse(readFileSync(path, "utf8"));
  pkg.version = version;
  for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
    const deps = pkg[field];
    if (deps === undefined) {
      continue;
    }
    for (const name of Object.keys(deps)) {
      if (name.startsWith("@cube-drone/")) {
        deps[name] = `^${version}`;
      }
    }
  }
  writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`);
  changed.push(`${dir}/package.json`);
}

// -- cargo side

function setCargoVersion(path: string): void {
  let toml = readFileSync(path, "utf8");
  // The [package] version: first `version = "..."` line.
  toml = toml.replace(/^version = "[^"]*"$/m, `version = "${version}"`);
  // Path dependencies on sibling crates carry the lockstep version too
  // (tolerant of dependency-renaming: `package = "..."` may precede path).
  toml = toml.replace(
    /^(marquee-[a-z-]+ = \{[^\n]*version = ")[^"]*("[^\n]*)$/m,
    `$1${version}$2`,
  );
  writeFileSync(path, toml);
}

for (const crate of ["rust/parser", "rust/html_renderer"]) {
  setCargoVersion(`${root}/${crate}/Cargo.toml`);
  changed.push(`${crate}/Cargo.toml`);
}

console.log(`set ${changed.length} manifests to ${version}:`);
for (const c of changed) {
  console.log(`  ${c}`);
}
console.log("\nnext: npm install (refresh the lockfile), then see RELEASING.md");
