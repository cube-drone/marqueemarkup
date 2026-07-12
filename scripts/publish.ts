// The one-flick megapublish: every registry, one command, safely rerunnable.
//
//     npm run release                  interactive: prompts for the bump
//     npm run release -- --bump minor  non-interactive bump from the last tag
//     npm run release -- 0.2.0         explicit version
//     npm run release -- --dry-run     the whole plan, no uploads, no tags
//
// The flow: preflight (creds + clean tree) -> release-check -> set-version ->
// release commit + git tag -> npm publish x6 (dependency order, private
// packages skipped) -> cargo publish x3 (parser first; each waits for index
// propagation) -> offer to push. Every publish step checks the registry
// first and SKIPS versions that already exist, so a run that dies halfway
// (network, 2FA hiccup, expired token) is resumed by running it again -
// idempotence is the whole design.
//
// Credentials live in publish.env (gitignored; see publish.env.example for
// how to mint them). This script never prints them.

import { execSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

// npm publish order: dependencies before dependents (RELEASING.md).
const NPM_ORDER = [
  "ts/parser",
  "ts/marquee-turbolink",
  "ts/marquee-css",
  "ts/html_renderer",
  "ts/marquee-fonts",
  "ts/marquee-emoji",
  "ts/marquee-markup",
];

// cargo publish order: each crate's deps must already be on crates.io.
const CARGO_ORDER: Array<{ dir: string; name: string }> = [
  { dir: "rust/parser", name: "cube-drone-marquee-parser" },
  { dir: "rust/html_renderer", name: "cube-drone-marquee-html-renderer" },
  { dir: "rust/markup", name: "cube-drone-marquee-markup" },
];

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const skipChecks = args.includes("--skip-checks");
// --tag-only: the local half of a trusted-publishing release - gate,
// version, commit, tag, push; the release workflow does the uploads.
const tagOnly = args.includes("--tag-only");
// --uploads-only: the CI half - registry uploads for an existing version,
// authenticated ambiently (npm OIDC / CARGO_REGISTRY_TOKEN in the env),
// no publish.env required.
const uploadsOnly = args.includes("--uploads-only");
const bumpFlag = args.includes("--bump") ? args[args.indexOf("--bump") + 1] : undefined;
const explicit = args.find((a) => /^\d+\.\d+\.\d+$/.test(a));

function fail(msg: string): never {
  console.error(`\npublish: ${msg}`);
  process.exit(1);
}

function sh(cmd: string, opts: { cwd?: string; env?: Record<string, string> } = {}): void {
  execSync(cmd, {
    cwd: opts.cwd ?? root,
    stdio: "inherit",
    env: { ...process.env, ...opts.env },
  });
}

function shQuiet(cmd: string, cwd = root): string | null {
  const r = spawnSync("sh", ["-c", cmd], { cwd, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

function step(title: string): void {
  console.log(`\n== ${title}`);
}

// -- credentials

function loadEnv(): Record<string, string> {
  const path = join(root, "publish.env");
  if (!existsSync(path)) {
    fail("publish.env not found - copy publish.env.example and fill in the tokens");
  }
  const env: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq > 0) {
      env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }
  }
  for (const key of ["NPM_TOKEN", "CARGO_REGISTRY_TOKEN"]) {
    if (!env[key]) {
      fail(`publish.env is missing ${key} (see publish.env.example)`);
    }
  }
  return env;
}

// -- version selection

function lastTag(): string | null {
  return shQuiet("git describe --tags --abbrev=0 --match 'v*'");
}

function bump(version: string, kind: string): string {
  const [maj = 0, min = 0, mic = 0] = version.split(".").map(Number);
  if (kind === "major") return `${maj + 1}.0.0`;
  if (kind === "minor") return `${maj}.${min + 1}.0`;
  if (kind === "micro" || kind === "patch") return `${maj}.${min}.${mic + 1}`;
  fail(`unknown bump "${kind}" (micro/minor/major)`);
}

async function chooseVersion(): Promise<string> {
  if (explicit !== undefined) {
    return explicit;
  }
  const tag = lastTag();
  if (tag === null) {
    // First release: the manifests already carry the version; ship it as-is.
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    console.log(`no previous release tag - first release, using manifest version ${pkg.version}`);
    return pkg.version;
  }
  const current = tag.replace(/^v/, "");
  if (bumpFlag !== undefined) {
    return bump(current, bumpFlag);
  }
  if (!process.stdin.isTTY) {
    fail("no TTY - pass --bump micro|minor|major or an explicit version");
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (
    await rl.question(`last release is ${tag} - bump? [micro/minor/major] `)
  ).trim().toLowerCase();
  rl.close();
  return bump(current, answer || "micro");
}

async function confirm(prompt: string): Promise<boolean> {
  if (dryRun) return false;
  if (!process.stdin.isTTY) return true;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`${prompt} [Y/n] `)).trim().toLowerCase();
  rl.close();
  return answer === "" || answer === "y" || answer === "yes";
}

// -- registry presence checks (the idempotence half)

function npmPublished(name: string, version: string): boolean {
  return shQuiet(`npm view ${name}@${version} version 2>/dev/null`) === version;
}

async function cratePublished(name: string, version: string): Promise<boolean> {
  try {
    const res = await fetch(`https://crates.io/api/v1/crates/${name}/${version}`, {
      headers: { "user-agent": "marqueemarkup-publish (cube-drone)" },
    });
    return res.ok;
  } catch {
    return false; // network doubt: attempt the publish, cargo will say
  }
}

// -- main

// Local uploads need publish.env; --tag-only publishes nothing, and
// --uploads-only (CI) authenticates ambiently: npm via OIDC trusted
// publishing, cargo via CARGO_REGISTRY_TOKEN already in the environment.
const env = tagOnly || uploadsOnly ? {} : loadEnv();
if (uploadsOnly && explicit === undefined) {
  fail("--uploads-only needs an explicit version (the tag being released)");
}
const version = await chooseVersion();
const tag = `v${version}`;
console.log(`\nrelease ${tag}${dryRun ? " (dry run - no uploads, no tags)" : ""}`);

if (!uploadsOnly) {
  step("preflight: working tree");
  const dirty = shQuiet("git status --porcelain");
  const tagExists = shQuiet(`git tag -l ${tag}`) === tag;
  if (dirty !== "" && dirty !== null && !tagExists) {
    if (dryRun) {
      console.log("(dry run: tree is dirty - the real run will refuse until it's committed)");
    } else {
      fail(`working tree is dirty - commit first:\n${dirty}`);
    }
  }

  if (skipChecks) {
    console.log("(--skip-checks: trusting a previous green run)");
  } else {
    step("release-check (the full gate)");
    if (!dryRun || dirty === "") {
      sh("npm run release-check");
    } else {
      console.log("(dry run on a dirty tree: skipping the gate, it requires clean)");
    }
  }

  step(`version + tag: ${tag}`);
  if (tagExists) {
    console.log(`tag ${tag} already exists - resume mode, skipping bump/commit/tag`);
  } else if (dryRun) {
    console.log(`would: set-version ${version}; commit "release: ${tag}"; git tag ${tag}`);
  } else {
    sh(`node scripts/set-version.ts ${version}`);
    sh("npm install --package-lock-only --no-fund --no-audit"); // lockfile follows the manifests
    // Cargo.locks follow the manifests too: any cargo command re-resolves,
    // and `cargo metadata` is the cheapest one that writes the lock. Without
    // this, the release commit ships lockfiles still naming the OLD version,
    // and the first cargo command in CI dirties the tree -> gate refusal.
    for (const crate of CARGO_ORDER) {
      sh("cargo metadata --format-version 1 --quiet > /dev/null", {
        cwd: join(root, crate.dir),
      });
    }
    // First release: manifests may already carry the version (set-version
    // is a no-op) - "nothing to commit" is fine, the tag goes on HEAD.
    if (shQuiet("git status --porcelain") !== "") {
      sh(`git add -A && git commit -m "release: ${tag}"`);
    } else {
      console.log("manifests already at this version - nothing to commit, tagging HEAD");
    }
    sh(`git tag ${tag}`);
  }
}

if (tagOnly) {
  step("hand-off to the release workflow");
  if (dryRun) {
    console.log(`would: git push && git push origin ${tag} (the tag triggers release.yml)`);
  } else if (await confirm(`push the release commit and ${tag}? (the tag triggers the publish workflow)`)) {
    sh(`git push && git push origin ${tag}`);
    console.log("pushed - watch the release workflow do the uploads.");
  } else {
    console.log(`when ready: git push && git push origin ${tag}`);
  }
  process.exit(0);
}

step("npm publishes (dependency order; already-published versions skip)");
// Local mode: token via a temp userconfig, not the environment (keys with
// slashes and colons don't survive every shell; files always do).
// CI mode (--uploads-only): no token at all - npm's OIDC trusted publishing
// authenticates the workflow itself, and --provenance attests the build.
let npmEnv: Record<string, string> = {};
let npmFlags = "";
if (uploadsOnly) {
  npmFlags = process.env["GITHUB_ACTIONS"] === "true" ? " --provenance" : "";
} else {
  const npmrcDir = mkdtempSync(join(tmpdir(), "marquee-publish-"));
  const npmrc = join(npmrcDir, "npmrc");
  writeFileSync(npmrc, `//registry.npmjs.org/:_authToken=${env["NPM_TOKEN"]}\n`);
  npmEnv = { NPM_CONFIG_USERCONFIG: npmrc };
}
for (const dir of NPM_ORDER) {
  const pkg = JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8"));
  if (pkg.private === true) {
    console.log(`   ${pkg.name}: private, skipped`);
    continue;
  }
  if (npmPublished(pkg.name, version)) {
    console.log(`   ${pkg.name}@${version}: already on npm, skipped`);
    continue;
  }
  if (dryRun) {
    console.log(`   would publish ${pkg.name}@${version}`);
    continue;
  }
  console.log(`   publishing ${pkg.name}@${version}`);
  sh(`npm publish --workspace=${pkg.name}${npmFlags}`, { env: npmEnv });
}

step("cargo publishes (parser first; cargo waits for index propagation)");
for (const crate of CARGO_ORDER) {
  if (await cratePublished(crate.name, version)) {
    console.log(`   ${crate.name}@${version}: already on crates.io, skipped`);
    continue;
  }
  if (dryRun) {
    console.log(`   would publish ${crate.name}@${version}`);
    continue;
  }
  console.log(`   publishing ${crate.name}@${version}`);
  // CI mode: CARGO_REGISTRY_TOKEN is already in the environment (minted
  // per-run by crates.io trusted publishing); local mode: publish.env.
  const cargoToken = process.env["CARGO_REGISTRY_TOKEN"] ?? env["CARGO_REGISTRY_TOKEN"];
  if (!cargoToken) {
    fail("no CARGO_REGISTRY_TOKEN available (publish.env locally, OIDC in CI)");
  }
  sh("cargo publish", {
    cwd: join(root, crate.dir),
    env: { CARGO_REGISTRY_TOKEN: cargoToken },
  });
}

step("done");
if (dryRun) {
  console.log(`dry run complete - the real thing: npm run release -- ${version}`);
} else if (uploadsOnly) {
  // CI mode: the pushed tag is what triggered this run - there is nothing
  // to push and no branch to push from (tag checkouts are detached HEADs).
  console.log(`published ${tag} everywhere.`);
} else {
  console.log(`published ${tag} everywhere.`);
  if (await confirm(`push the release commit and ${tag} to origin?`)) {
    sh(`git push && git push origin ${tag}`);
  } else {
    console.log(`remember to: git push && git push origin ${tag}`);
  }
}
