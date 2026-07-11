// @cube-drone/marquee-markup: Marquee, batteries included.
//
//     import { marquee } from "@cube-drone/marquee-markup";
//     writeFileSync("hello.html", marquee("# hello *world*"));
//
// One motion: parse, render, style, inline the fonts the page actually
// wears, wrap in a page shell. `marqueeFragment()` gives embedders the
// pieces instead; `buildSite()` renders a folder of .mq files into a
// website (shared nav/footer includes, per-site font subsetting).
//
// Everything underneath is re-exported, so outgrowing the convenience never
// means switching packages: the same parse/render/Profile/plugin machinery
// from @cube-drone/marquee-parser, -html-renderer, -css, -fonts, and
// @cube-drone/marquee-turbolink is all reachable from here.

import { parse, type Node } from "@cube-drone/marquee-parser";
import {
  bareWebProfile,
  escapeText,
  render,
  usedFontTokens,
  type Profile,
} from "@cube-drone/marquee-html-renderer";
import { marqueeCss } from "@cube-drone/marquee-css";
import { inlineFontFaces } from "@cube-drone/marquee-fonts";
import {
  composeTurbolinks,
  defaultPlugins,
  turbolinkStyles,
  type TurbolinkPlugin,
} from "@cube-drone/marquee-turbolink";

export interface MarqueeOptions {
  /** Page title; defaults to the document's `:::meta title`, then "Marquee". */
  title?: string;
  /** Inline the used grab-bag fonts as base64 (default), or skip them and
   * let names degrade to their fallback stacks. */
  fonts?: "inline" | "none";
  /** Turbolink expanders; defaults to the fetchless default set. */
  plugins?: TurbolinkPlugin[];
  /** Overrides layered on the assembled profile (schemes, media policy...). */
  profile?: Partial<Profile>;
}

function assembleProfile(opts: MarqueeOptions): { profile: Profile; plugins: TurbolinkPlugin[] } {
  const plugins = opts.plugins ?? defaultPlugins;
  const profile: Profile = {
    ...bareWebProfile,
    turbolink: composeTurbolinks(plugins),
    ...opts.profile,
  };
  return { profile, plugins };
}

/** The document's own `:::meta title`, if it declares one. */
export function metaTitle(doc: Node): string | undefined {
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

/** Parse and render to embeddable pieces: the body fragment and the CSS it
 * needs (stylesheet + composed plugin skins + used fonts, per options). */
export function marqueeFragment(
  source: string,
  opts: MarqueeOptions = {},
): { html: string; css: string; title: string } {
  const { profile, plugins } = assembleProfile(opts);
  const doc = parse(source);
  const html = render(doc, profile);
  let css = `${marqueeCss}\n${turbolinkStyles(plugins)}`;
  if ((opts.fonts ?? "inline") === "inline") {
    const faces = inlineFontFaces(usedFontTokens(html));
    if (faces !== "") {
      css += `\n${faces}`;
    }
  }
  return { html, css, title: opts.title ?? metaTitle(doc) ?? "Marquee" };
}

/** The one smooth motion: Marquee source in, a complete self-contained
 * HTML page out. */
export function marquee(source: string, opts: MarqueeOptions = {}): string {
  const { html, css, title } = marqueeFragment(source, opts);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeText(title)}</title>
<style>
body { margin: 0; }
${css}
</style>
</head>
<body>
${html}
</body>
</html>
`;
}

export { buildSite, type SiteReport } from "./build-site.ts";

// The full toolbox, re-exported: growth never requires switching packages.
export { parse, UnsupportedVersionError } from "@cube-drone/marquee-parser";
export type { Attrs, Node, Reason } from "@cube-drone/marquee-parser";
export {
  FONTS,
  bareWebProfile,
  escapeAttr,
  escapeText,
  render,
  renderMarquee,
  usedFontTokens,
} from "@cube-drone/marquee-html-renderer";
export type { MediaResolution, Profile, TurbolinkLevel } from "@cube-drone/marquee-html-renderer";
export { marqueeCss } from "@cube-drone/marquee-css";
export {
  FONT_MANIFEST,
  externalFontFaces,
  fontFilePath,
  inlineFontFaces,
} from "@cube-drone/marquee-fonts";
export {
  composeTurbolinks,
  defaultPlugins,
  opengraphPlugin,
  renderCard,
  resolveTargets,
  turbolinkStyles,
  turbolinkTargets,
} from "@cube-drone/marquee-turbolink";
export type { TurbolinkContext, TurbolinkPlugin, TurbolinkSummary } from "@cube-drone/marquee-turbolink";
