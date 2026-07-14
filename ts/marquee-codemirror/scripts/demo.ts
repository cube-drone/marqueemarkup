// Build the demo: `npm run demo` here, then serve demo/dist.
//
// esbuild bundles the repo TypeScript source (via the marquee-src condition)
// plus CodeMirror. The stylesheet is marquee.css (for the grab-bag fonts a
// styled span shows) plus the editor's own font faces, inlined - the editor
// theme itself ships inside the extension, so styles.css is just fonts.

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

await build({
  entryPoints: [join(here, "demo/main.ts")],
  outfile: join(out, "demo.js"),
  bundle: true,
  format: "iife",
  target: "es2022",
  conditions: ["marquee-src"],
  loader: { ".mq": "text" },
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
});

// Fonts the tour wears, as real files (a styled [font=...] span shows them).
const tokens = usedFontTokens(render(parse(readFileSync(join(repo, "WRITING.mq"), "utf8")), bareWebProfile));
const shipped: string[] = [];
mkdirSync(join(out, "fonts"), { recursive: true });
for (const token of tokens) {
  const file = fontFilePath(token);
  if (file !== null) {
    cpSync(file, join(out, "fonts", `${token}.woff2`));
    shipped.push(token);
  }
}
// marquee.css + the composed plugins' skins (which size the turbolink embeds
// the demo profile renders - without them a loaded video/iframe takes its
// natural width and overflows a phone) + the fonts the tour wears.
writeFileSync(
  join(out, "styles.css"),
  [marqueeCss, turbolinkStyles(defaultPlugins), externalFontFaces(shipped, "fonts/")].join("\n\n"),
);

cpSync(join(repo, "example-media"), join(out, "example-media"), { recursive: true });
cpSync(join(repo, "marquee-logo.png"), join(out, "marquee-logo.png"));
cpSync(join(here, "demo/index.html"), join(out, "index.html"));

console.log(`built demo/dist (${shipped.length} fonts)`);
console.log("serve it:  npx serve ts/marquee-codemirror/demo/dist");
