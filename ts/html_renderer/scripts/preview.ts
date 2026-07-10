// Preview tool: render .mq file(s) into one self-contained HTML page
// (css/marquee.css inlined) on stdout.
//
//     npm run preview -- ../../examples/website-frontpage.mq > /tmp/page.html
//     npm run preview -- ../../examples/*.mq > /tmp/all.html
//
// Uses a preview profile on top of the bare-web default: a tiny emoji table;
// blob:/ringtome: targets resolved to labeled placeholder boxes; and local
// relative media resolved against the .mq file's own directory (the base-URI
// rule) and inlined as data: URIs, so the output stays one portable file
// with the pictures showing and the songs playable. Pass --bare for the
// strict bareWebProfile instead (placeholders and literal :slugs: on display).
//
// For big files (or many references to one file), skip the inlining:
//
//     npm run preview -- --media-dir media ../../WRITING.mq > tour.html
//
// copies each referenced file into ./media once and links it by path. The
// page is no longer single-file: save the HTML where the media dir's path
// resolves (here, next to ./media).

import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bareWebProfile, renderMarquee, type Profile } from "../src/index.ts";

const EMOJI: Record<string, string> = {
  tophat: "🎩", smile: "😀", sparkles: "✨", blobcat: "🐱", wave: "👋",
  heart: "❤️", star: "⭐", fire: "🔥",
};

const MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", avif: "image/avif", svg: "image/svg+xml",
  mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav", flac: "audio/flac",
  m4a: "audio/mp4",
  mp4: "video/mp4", webm: "video/webm",
};

function kindOf(mime: string): "image" | "audio" | "video" {
  return mime.split("/", 1)[0] as "image" | "audio" | "video";
}

function placeholderBox(label: string) {
  return {
    kind: "image" as const,
    url: `https://placehold.co/480x200/1a1a2e/9ecbff?text=${encodeURIComponent(label)}`,
  };
}

/** Data-URI memo: each file is read and encoded once per run. The *output*
 * still repeats the bytes per reference - a static single-file page has no
 * define-once mechanism without scripting, and this tool's output is a
 * document, not a program. (Use --media-dir when that cost bites; on a real
 * server, N references to one URL fetch once anyway.) */
const dataUris = new Map<string, string>();

function dataUri(path: string, mime: string): string {
  let uri = dataUris.get(path);
  if (uri === undefined) {
    uri = `data:${mime};base64,${readFileSync(path).toString("base64")}`;
    dataUris.set(path, uri);
  }
  return uri;
}

/** --media-dir mode: copy each referenced file in once (dedup by source
 * path, basename collisions get a counter) and link it by relative path. */
const copied = new Map<string, string>();
const usedNames = new Set<string>();

function mediaDirUrl(path: string, mediaDir: string): string {
  let name = copied.get(path);
  if (name === undefined) {
    name = basename(path);
    for (let n = 2; usedNames.has(name); n += 1) {
      const dot = basename(path).lastIndexOf(".");
      name =
        dot <= 0
          ? `${basename(path)}-${n}`
          : `${basename(path).slice(0, dot)}-${n}${basename(path).slice(dot)}`;
    }
    usedNames.add(name);
    mkdirSync(mediaDir, { recursive: true });
    copyFileSync(path, resolve(mediaDir, name));
    copied.set(path, name);
  }
  return `${mediaDir.replaceAll("\\", "/").replace(/\/+$/, "")}/${encodeURIComponent(name)}`;
}

/** The preview profile for one source file: relative media resolve against
 * that file's directory, per the base-URI rule. */
function previewProfile(sourceDir: string, mediaDir: string | null): Profile {
  return {
    ...bareWebProfile,
    linkAllowed: (t) => bareWebProfile.linkAllowed(t) || /^(blob|ringtome):/.test(t),
    media(t) {
      if (/^(blob|ringtome):/.test(t)) {
        return placeholderBox(t);
      }
      if (!/^[A-Za-z][A-Za-z0-9+.-]*:/.test(t)) {
        // Scheme-less: a local file next to the document.
        const path = resolve(sourceDir, t.split(/[?#]/, 1)[0]!);
        const ext = path.includes(".") ? path.slice(path.lastIndexOf(".") + 1).toLowerCase() : "";
        const mime = MIME[ext];
        if (mime !== undefined && existsSync(path)) {
          const url = mediaDir === null ? dataUri(path, mime) : mediaDirUrl(path, mediaDir);
          return { kind: kindOf(mime), url };
        }
        return placeholderBox(t); // wired but not landed yet
      }
      return bareWebProfile.media(t);
    },
    emoji: (slug) => EMOJI[slug] ?? null,
  };
}

const args = process.argv.slice(2);
const bare = args.includes("--bare");
let mediaDir: string | null = null;
const files: string[] = [];
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i]!;
  if (arg === "--bare") {
    continue;
  }
  if (arg === "--media-dir") {
    mediaDir = args[++i] ?? null;
    if (mediaDir === null) {
      console.error("--media-dir needs a directory");
      process.exit(2);
    }
    continue;
  }
  files.push(arg);
}
if (files.length === 0) {
  console.error("usage: npm run preview -- [--bare] [--media-dir <dir>] <file.mq>...");
  process.exit(2);
}

const css = readFileSync(fileURLToPath(new URL("../../../css/marquee.css", import.meta.url)), "utf8");

const sections = files.map((path) => {
  const profile = bare ? bareWebProfile : previewProfile(dirname(resolve(path)), mediaDir);
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
