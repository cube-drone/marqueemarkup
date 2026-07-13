// Build the demo: `npm run demo` in this package, then serve demo/dist.
//
// esbuild is the whole toolchain - one dev dependency, no config file. It
// resolves the repo's `marquee-src` export condition, so the demo bundles
// the TypeScript SOURCE of every marquee package: what you see is this
// working tree, not a stale dist.
//
// The stylesheet is assembled here rather than shipped by the renderer,
// because that is the actual contract: marquee.css is a SHARED artifact
// (@cube-drone/marquee-css), the plugins declare their own skins, and the
// fonts are an optional package. A host assembles them. This is a host.

import { build } from "esbuild";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@cube-drone/marquee-parser";
import { bareWebProfile, render, usedFontTokens } from "@cube-drone/marquee-html-renderer";
import { marqueeCss } from "@cube-drone/marquee-css";
import { externalFontFaces, fontFilePath } from "@cube-drone/marquee-fonts";
import { defaultPlugins, turbolinkStyles } from "@cube-drone/marquee-turbolink";

const here = fileURLToPath(new URL("..", import.meta.url));
const repo = join(here, "../..");
const out = join(here, "demo/dist");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// -- the script: React + every marquee package, from source
await build({
  entryPoints: [join(here, "demo/main.ts")],
  outfile: join(out, "demo.js"),
  bundle: true,
  format: "iife",
  target: "es2022",
  conditions: ["marquee-src"], // the repo's dev condition: bundle the .ts
  loader: { ".mq": "text" }, // WRITING.mq imports as a string
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
});

// -- the stylesheet: the shared contract + the composed plugins' skins +
// exactly the font faces this document wears (rendered once, statically,
// just to ask which faces those are - the same trick buildSite() uses).
// Real files rather than base64: this demo is a site, not a single page.
const source = readFileSync(join(repo, "WRITING.mq"), "utf8");
const staticHtml = render(parse(source), bareWebProfile);
const tokens = usedFontTokens(staticHtml);
const shipped: string[] = [];
mkdirSync(join(out, "fonts"), { recursive: true });
for (const token of tokens) {
  const file = fontFilePath(token);
  if (file !== null) {
    cpSync(file, join(out, "fonts", `${token}.woff2`));
    shipped.push(token);
  }
}
writeFileSync(
  join(out, "styles.css"),
  [marqueeCss, turbolinkStyles(defaultPlugins), externalFontFaces(shipped, "fonts/")].join("\n\n"),
);

// -- the document's own media, where its relative targets expect it
cpSync(join(repo, "example-media"), join(out, "example-media"), { recursive: true });
cpSync(join(repo, "marquee-logo.png"), join(out, "marquee-logo.png"));
cpSync(join(here, "demo/index.html"), join(out, "index.html"));

console.log(`built demo/dist (${shipped.length} font files, ${tokens.length} faces named)`);
console.log("serve it:  npx serve ts/marquee-react-renderer/demo/dist");
