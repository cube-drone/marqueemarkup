// Preview tool: render .mq file(s) into one self-contained HTML page
// (css/marquee.css inlined) on stdout.
//
//     npm run preview -- ../../examples/website-frontpage.mq > /tmp/page.html
//     npm run preview -- ../../examples/*.mq > /tmp/all.html
//
// Uses a preview profile on top of the bare-web default: a tiny emoji table,
// and blob:/ringtome: targets resolved to labeled placeholder boxes so cozy
// pages look like pages. Pass --bare for the strict bareWebProfile instead
// (placeholders and literal :slugs: on display).

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { bareWebProfile, renderMarquee, type Profile } from "../src/index.ts";

const EMOJI: Record<string, string> = {
  tophat: "🎩", smile: "😀", sparkles: "✨", blobcat: "🐱", wave: "👋",
  heart: "❤️", star: "⭐", fire: "🔥",
};

const previewProfile: Profile = {
  ...bareWebProfile,
  linkAllowed: (t) => bareWebProfile.linkAllowed(t) || /^(blob|ringtome):/.test(t),
  media: (t) =>
    /^(blob|ringtome):/.test(t)
      ? {
          kind: "image",
          url: `https://placehold.co/480x200/1a1a2e/9ecbff?text=${encodeURIComponent(t)}`,
        }
      : bareWebProfile.media(t),
  emoji: (slug) => EMOJI[slug] ?? null,
};

const args = process.argv.slice(2);
const bare = args.includes("--bare");
const files = args.filter((a) => a !== "--bare");
if (files.length === 0) {
  console.error("usage: npm run preview -- [--bare] <file.mq>...");
  process.exit(2);
}

const profile = bare ? bareWebProfile : previewProfile;
const css = readFileSync(fileURLToPath(new URL("../../../css/marquee.css", import.meta.url)), "utf8");

const sections = files.map((path) => {
  const html = renderMarquee(readFileSync(path, "utf8"), profile);
  const label = files.length > 1 ? `<h2 class="preview-label">${basename(path)}</h2>\n` : "";
  return label + html;
});

process.stdout.write(`<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${files.length === 1 ? basename(files[0]!) : "Marquee preview"}</title>
<style>${css}</style>
<style>
  body { max-width: 60rem; margin: 2rem auto; padding: 0 1rem; font-family: system-ui, sans-serif; }
  .preview-label { font-family: ui-monospace, monospace; font-size: .9rem; opacity: .6;
                   border-top: 2px solid rgba(136,136,136,.4); padding-top: 1rem; margin-top: 2.5rem; }
  .mq-doc { border: 1px solid rgba(136,136,136,.3); border-radius: .5rem; padding: 1rem 1.5rem; }
</style>
${sections.join("\n")}
`);
