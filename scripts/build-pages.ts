// Build the GitHub Pages demo: WRITING.mq rendered by the shipped omnibus
// (fetch mode - real OpenGraph cards, real turbolinks), plus the media it
// references, into _site/. The page IS the product's output: what
// https://cube-drone.github.io/marqueemarkup/ serves is what
// `npx marquee --envelope WRITING.mq` makes, dogfooded on every push.
//
//     node --conditions=marquee-src scripts/build-pages.ts

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

console.log("built _site/ (index.html + example-media + logo)");
