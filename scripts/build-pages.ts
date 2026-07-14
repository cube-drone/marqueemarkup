// Build the whole GitHub Pages demo site into _site/, three demos deep - all
// of them rendering the same WRITING.mq, so what you're comparing is the
// three surfaces, not three documents. One command builds the deployable
// site; the pages.yml workflow just runs it.
//
//   /         the plain HTML: WRITING.mq rendered by the shipped omnibus
//             (fetch mode - real OpenGraph cards, real turbolinks). The page
//             IS the product's output, what `npx marquee --envelope` makes.
//   /react/   the side-by-side React demo: source on the left, live render
//             on the right (@cube-drone/marquee-react-renderer).
//   /editor/  the Obsidian-style live-preview editor
//             (@cube-drone/marquee-codemirror).
//
// The two React demos are built by their own esbuild scripts and their dist
// dirs (self-contained: each carries its own styles, fonts, and media) are
// copied under _site/. GitHub Pages serves /react/ -> /react/index.html.
//
//     node --conditions=marquee-src scripts/build-pages.ts

import { execFileSync } from "node:child_process";
import { cpSync, copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { marqueeFetch } from "@cube-drone/marquee-markup";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = join(root, "_site");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const source = readFileSync(join(root, "WRITING.mq"), "utf8");
const page = await marqueeFetch(source, {
  envelope: true,
  // The demo host's own table: WRITING.mq says ":angry-burger: is a custom
  // image emoji this host provides", so this host provides it.
  emoji: {
    "angry-burger": {
      image: "example-media/angry-burger-emoji.png",
      alt: ":angry-burger:",
    },
  },
});
writeFileSync(join(out, "index.html"), page);

// Relative targets in the document resolve against the deployed root.
cpSync(join(root, "example-media"), join(out, "example-media"), { recursive: true });
copyFileSync(join(root, "marquee-logo.png"), join(out, "marquee-logo.png"));

// The two React demos, each built by its package's own demo script, then
// dropped in at a subpath. Their dist dirs use relative asset paths and carry
// their own media, so they need no rewriting to live under _site/<sub>/.
const reactDemos = [
  { script: "demo:react", dist: "ts/marquee-react-renderer/demo/dist", sub: "react" },
  { script: "demo:cm", dist: "ts/marquee-codemirror/demo/dist", sub: "editor" },
];
for (const demo of reactDemos) {
  execFileSync("npm", ["run", demo.script], { cwd: root, stdio: "inherit" });
  cpSync(join(root, demo.dist), join(out, demo.sub), { recursive: true });
}

console.log(`built _site/ (index.html + ${reactDemos.map((d) => `${d.sub}/`).join(" + ")} + example-media + logo)`);
