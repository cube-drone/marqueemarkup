// Site builder: render a folder of .mq files into a static website.
//
//     npm run build-site -- ../../examples/borsalino /tmp/borsalino-dist
//
// This script is an *embedder* (a small static-site one), so it implements
// the embedder half of the spec:
//   - :::include doc=X::: resolves X.mq beside the including page. Included
//     documents may not include (the v0 depth cap), which also makes cycles
//     unrepresentable. Files named _*.mq are includable partials, not pages.
//   - Relative doc-id links ([Menu](menu)) resolve to the built pages
//     (menu.html) - the base-URI duty, done at build time.
//   - Relative media is copied into <out>/media/ and re-pointed.
//   - Turbolinks get the default plugin chain (fetchless).
//   - <title> comes from :::meta title, dogfooding document metadata.
// Stylesheets ship as real files (css/), fonts as real files (fonts/) -
// this is a website, not a single-file preview.

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, type Node } from "../../parser/src/index.ts";
import { FONTS, bareWebProfile, escapeText, render, type Profile } from "../src/index.ts";
import { composeTurbolinks, defaultPlugins, turbolinkStyles } from "../../turbolink/src/index.ts";

const [siteDirArg, outDirArg] = process.argv.slice(2);
if (siteDirArg === undefined || outDirArg === undefined) {
  console.error("usage: npm run build-site -- <site-dir> <out-dir>");
  process.exit(2);
}
const siteDir = resolve(siteDirArg);
const outDir = resolve(outDirArg);
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

const mqFiles = readdirSync(siteDir).filter((f) => f.endsWith(".mq"));
const pageIds = mqFiles.filter((f) => !f.startsWith("_")).map((f) => basename(f, ".mq"));

// -- media: relative embeds copied in once, re-pointed at media/<name>

const copiedMedia = new Map<string, string>();

function siteMediaUrl(path: string): string {
  let name = copiedMedia.get(path);
  if (name === undefined) {
    name = basename(path);
    for (let n = 2; [...copiedMedia.values()].includes(name); n += 1) {
      const dot = basename(path).lastIndexOf(".");
      name = dot <= 0 ? `${basename(path)}-${n}` : `${basename(path).slice(0, dot)}-${n}${basename(path).slice(dot)}`;
    }
    mkdirSync(join(outDir, "media"), { recursive: true });
    copyFileSync(path, join(outDir, "media", name));
    copiedMedia.set(path, name);
  }
  return `media/${encodeURIComponent(name)}`;
}

// -- the embedder profile; `depth` enforces "includes may not include"

function siteProfile(depth: number): Profile {
  return {
    ...bareWebProfile,
    media(target) {
      if (!/^[A-Za-z][A-Za-z0-9+.-]*:/.test(target)) {
        const path = resolve(siteDir, target.split(/[?#]/, 1)[0]!);
        if (existsSync(path)) {
          // Kind-by-extension via the default profile (dummy https host -
          // only the extension matters to it).
          const base = bareWebProfile.media(`https://local/${basename(path)}`);
          if (base !== null) {
            return { kind: base.kind, url: siteMediaUrl(path) };
          }
        }
        return null;
      }
      return bareWebProfile.media(target);
    },
    turbolink: composeTurbolinks(defaultPlugins),
    directive(name, attrs, _children) {
      if (name !== "include" || depth > 0) {
        return null; // deep include -> unknown vocabulary -> inert placeholder
      }
      const doc = attrs["doc"];
      if (doc === undefined || !/^[A-Za-z0-9_.-]+$/.test(doc)) {
        return null;
      }
      const path = join(siteDir, `${doc}.mq`);
      if (!existsSync(path)) {
        return null; // missing include: the placeholder says so, words survive
      }
      const included = parse(readFileSync(path, "utf8"));
      if (included.type !== "document") {
        return null;
      }
      const inner = siteProfile(depth + 1);
      return included.children.map((child) => render(child, inner)).join("");
    },
  };
}

function metaTitle(doc: Node): string | undefined {
  if (doc.type !== "document") {
    return undefined;
  }
  for (const child of doc.children) {
    if (child.type === "directive" && child.name === "meta" && child.attrs["title"] !== undefined) {
      return child.attrs["title"];
    }
  }
  return undefined;
}

function shell(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeText(title)}</title>
<link rel="stylesheet" href="css/marquee.css">
<link rel="stylesheet" href="css/fonts.css">
<link rel="stylesheet" href="css/turbolink.css">
</head>
<body>
${body}
</body>
</html>
`;
}

// -- build

mkdirSync(join(outDir, "css"), { recursive: true });
copyFileSync(join(repoRoot, "css/marquee.css"), join(outDir, "css/marquee.css"));
copyFileSync(join(repoRoot, "css/fonts.css"), join(outDir, "css/fonts.css"));
writeFileSync(join(outDir, "css/turbolink.css"), turbolinkStyles(defaultPlugins));

mkdirSync(join(outDir, "fonts"), { recursive: true });
for (const token of Object.keys(FONTS)) {
  const woff2 = join(repoRoot, "fonts", `${token}.woff2`);
  if (existsSync(woff2)) {
    copyFileSync(woff2, join(outDir, "fonts", `${token}.woff2`));
  }
}

const profile = siteProfile(0);
for (const id of pageIds) {
  const source = readFileSync(join(siteDir, `${id}.mq`), "utf8");
  const doc = parse(source);
  let body = render(doc, profile);
  // Doc-id links become page links: the base-URI duty, resolved at build.
  for (const target of pageIds) {
    body = body.replaceAll(`href="${target}"`, `href="${target}.html"`);
  }
  writeFileSync(join(outDir, `${id}.html`), shell(metaTitle(doc) ?? id, body));
}

console.log(
  `built ${pageIds.length} pages (${pageIds.join(", ")}) + ${copiedMedia.size} media files -> ${outDir}`,
);
