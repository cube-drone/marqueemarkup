// @classam/marquee-markup: Marquee, batteries included.
//
//     import { marquee } from "@classam/marquee-markup";
//     writeFileSync("hello.html", marquee("# hello *world*"));
//
// One motion: parse, render, style, inline the fonts the page actually
// wears, wrap in a page shell. `marqueeFragment()` gives embedders the
// pieces instead; `buildSite()` renders a folder of .mq files into a
// website (shared nav/footer includes, per-site font subsetting).
//
// Everything underneath is re-exported, so outgrowing the convenience never
// means switching packages: the same parse/render/Profile/plugin machinery
// from @classam/marquee-parser, -html-renderer, -css, -fonts, and
// @classam/turbolink is all reachable from here.

import { parse, type Node } from "@classam/marquee-parser";
import {
  bareWebProfile,
  escapeText,
  render,
  usedFontTokens,
  type Profile,
} from "@classam/marquee-html-renderer";
import { marqueeCss } from "@classam/marquee-css";
import { inlineFontFaces } from "@classam/marquee-fonts";
import {
  composeTurbolinks,
  defaultPlugins,
  turbolinkStyles,
  type TurbolinkPlugin,
} from "@classam/turbolink";

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
export { parse, UnsupportedVersionError } from "@classam/marquee-parser";
export type { Attrs, Node, Reason } from "@classam/marquee-parser";
export {
  FONTS,
  bareWebProfile,
  escapeAttr,
  escapeText,
  render,
  renderMarquee,
  usedFontTokens,
} from "@classam/marquee-html-renderer";
export type { MediaResolution, Profile, TurbolinkLevel } from "@classam/marquee-html-renderer";
export { marqueeCss } from "@classam/marquee-css";
export {
  FONT_MANIFEST,
  externalFontFaces,
  fontFilePath,
  inlineFontFaces,
} from "@classam/marquee-fonts";
export {
  composeTurbolinks,
  defaultPlugins,
  opengraphPlugin,
  renderCard,
  resolveTargets,
  turbolinkStyles,
  turbolinkTargets,
} from "@classam/turbolink";
export type { TurbolinkContext, TurbolinkPlugin, TurbolinkSummary } from "@classam/turbolink";
