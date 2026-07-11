// buildSite(): render a folder of .mq files into a static website. This is
// the batteries-included *embedder*, so it implements the embedder half of
// the spec:
//   - :::include doc=X::: resolves X.mq beside the including page. Included
//     documents may not include (the v0 depth cap), which also makes cycles
//     unrepresentable. Files named _*.mq are includable partials, not pages.
//   - Relative doc-id links ([Menu](menu)) resolve to the built pages
//     (menu.html) - the base-URI duty, done at build time.
//   - Relative media is copied into <out>/media/ and re-pointed.
//   - Turbolinks get the plugin chain (fetchless defaults unless overridden).
//   - <title> comes from :::meta title, dogfooding document metadata.
//   - Fonts ship as files, and only the faces the site's pages actually use.
// Stylesheets and fonts are real cacheable files - this is a website, not a
// single-file page (that's what marquee() is for).

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { parse } from "@classam/marquee-parser";
import {
  bareWebProfile,
  escapeText,
  render,
  usedFontTokens,
  type Profile,
} from "@classam/marquee-html-renderer";
import { marqueeCss } from "@classam/marquee-css";
import { externalFontFaces, fontFilePath } from "@classam/marquee-fonts";
import { composeTurbolinks, defaultPlugins, turbolinkStyles, type TurbolinkPlugin } from "@classam/turbolink";
import { metaTitle } from "./index.ts";

export interface SiteOptions {
  /** Turbolink expanders; defaults to the fetchless default set. */
  plugins?: TurbolinkPlugin[];
  /** Overrides layered on the assembled per-site profile. */
  profile?: Partial<Profile>;
}

export interface SiteReport {
  pages: string[];
  mediaFiles: number;
  fontFaces: string[];
  outDir: string;
}

export function buildSite(siteDirArg: string, outDirArg: string, opts: SiteOptions = {}): SiteReport {
  const siteDir = resolve(siteDirArg);
  const outDir = resolve(outDirArg);
  const plugins = opts.plugins ?? defaultPlugins;

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
      turbolink: composeTurbolinks(plugins),
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
      ...opts.profile,
    };
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
<style>/* the embedder's page, the embedder's reset: full-bleed backgrounds
   (marquee.css never touches body - it must embed politely in host pages) */
body { margin: 0; }</style>
</head>
<body>
${body}
</body>
</html>
`;
  }

  // -- build

  mkdirSync(join(outDir, "css"), { recursive: true });
  writeFileSync(join(outDir, "css/marquee.css"), marqueeCss);
  writeFileSync(join(outDir, "css/turbolink.css"), turbolinkStyles(plugins));

  const profile = siteProfile(0);
  const usedFonts = new Set<string>();
  for (const id of pageIds) {
    const source = readFileSync(join(siteDir, `${id}.mq`), "utf8");
    const doc = parse(source);
    let body = render(doc, profile);
    // Doc-id links become page links: the base-URI duty, resolved at build.
    for (const target of pageIds) {
      body = body.replaceAll(`href="${target}"`, `href="${target}.html"`);
    }
    for (const token of usedFontTokens(body)) {
      usedFonts.add(token);
    }
    writeFileSync(join(outDir, `${id}.html`), shell(metaTitle(doc) ?? id, body));
  }

  // Fonts: only the faces this site actually uses. Readers never fetch
  // unused @font-face rules anyway (font loading is lazy), but a deploy
  // artifact shouldn't haul the whole library to serve four faces.
  mkdirSync(join(outDir, "fonts"), { recursive: true });
  const shipped: string[] = [];
  for (const token of [...usedFonts].sort()) {
    const path = fontFilePath(token);
    if (path === null) {
      continue; // standard stacks and unfetched faces: fallbacks handle it
    }
    copyFileSync(path, join(outDir, "fonts", `${token}.woff2`));
    shipped.push(token);
  }
  writeFileSync(
    join(outDir, "css/fonts.css"),
    `/* fonts.css - generated per site: only the faces these pages use. */\n\n${externalFontFaces(shipped, "../fonts/")}\n`,
  );

  return { pages: pageIds, mediaFiles: copiedMedia.size, fontFaces: shipped, outDir };
}
