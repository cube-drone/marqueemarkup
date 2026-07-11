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
  type EmojiResolution,
  type Profile,
} from "@cube-drone/marquee-html-renderer";
import { marqueeCss } from "@cube-drone/marquee-css";
import { standardEmoji } from "@cube-drone/marquee-emoji";
import { externalFontFaces, inlineFontFaces } from "@cube-drone/marquee-fonts";
import {
  composeTurbolinks,
  defaultPlugins,
  opengraphPlugin,
  resolveTargets,
  turbolinkStyles,
  turbolinkTargets,
  type TurbolinkPlugin,
} from "@cube-drone/marquee-turbolink";

export interface MarqueeOptions {
  /** Page title; defaults to the document's `:::meta title`, then "Marquee". */
  title?: string;
  /** Font delivery: "inline" (default) carries the used faces as base64;
   * "external" emits @font-face urls under `fontBase` (copy the files
   * yourself - `fontTokens` in the fragment return + `fontFilePath()` tell
   * you which); "none" lets names degrade to their fallback stacks. */
  fonts?: "inline" | "external" | "none";
  /** Base path for fonts: "external" urls (default "fonts/"). */
  fontBase?: string;
  /** Your emoji: slug -> replacement text, or `{ image, alt? }` for a
   * custom-emoji image (rendered as an inline `<img class="mq-emoji">`,
   * character-sized). Entries layer over the default table and win on
   * collision. (For dynamic resolution, use `profile.emoji` instead - a
   * profile override wins over everything.) */
  emoji?: Record<string, EmojiResolution>;
  /** The implicit emoji table (default true): gemoji's standard shortcodes,
   * from @cube-drone/marquee-emoji. Set false and unlisted slugs stay
   * literal `:slug:`. */
  emojiDefaults?: boolean;
  /** Turbolink expanders; defaults to the fetchless default set. */
  plugins?: TurbolinkPlugin[];
  /** Overrides layered on the assembled profile (schemes, media policy...). */
  profile?: Partial<Profile>;
}

function assembleProfile(
  opts: MarqueeOptions,
  plugins: TurbolinkPlugin[],
  resolved?: Map<string, unknown>,
): Profile {
  const emoji: Record<string, EmojiResolution> = {
    ...(opts.emojiDefaults === false ? {} : standardEmoji),
    ...opts.emoji,
  };
  return {
    ...bareWebProfile,
    turbolink: composeTurbolinks(plugins, resolved),
    emoji: (slug: string) => emoji[slug] ?? null,
    ...opts.profile,
  };
}

/** The fetch-mode plugin chain: yours (or the defaults) with the OpenGraph
 * expander appended, unless you already composed one in. */
function fetchChain(opts: MarqueeOptions): TurbolinkPlugin[] {
  const base = opts.plugins ?? defaultPlugins;
  return base.some((p) => p.name === opengraphPlugin.name) ? base : [...base, opengraphPlugin];
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

interface Fragment {
  body: string;
  css: string;
  title: string;
  fontTokens: string[];
}

/** Parse and render to embeddable pieces: what goes in the body, the CSS
 * that belongs in the head (stylesheet + composed plugin skins + fonts per
 * options), the title, and which font faces the page wears. */
export function marqueeFragment(source: string, opts: MarqueeOptions = {}): Fragment {
  return fragmentCore(parse(source), opts, opts.plugins ?? defaultPlugins);
}

function fragmentCore(
  doc: Node,
  opts: MarqueeOptions,
  plugins: TurbolinkPlugin[],
  resolved?: Map<string, unknown>,
): Fragment {
  const profile = assembleProfile(opts, plugins, resolved);
  const body = render(doc, profile);
  const fontTokens = usedFontTokens(body);
  let css = `${marqueeCss}\n${turbolinkStyles(plugins)}`;
  const fonts = opts.fonts ?? "inline";
  const faces =
    fonts === "inline"
      ? inlineFontFaces(fontTokens)
      : fonts === "external"
        ? externalFontFaces(fontTokens, opts.fontBase ?? "fonts/")
        : "";
  if (faces !== "") {
    css += `\n${faces}`;
  }
  return { body, css, title: opts.title ?? metaTitle(doc) ?? "Marquee", fontTokens };
}

/** Just the stuff that goes inside <body>: the rendered document fragment. */
export function marqueeBody(source: string, opts: MarqueeOptions = {}): string {
  return marqueeFragment(source, opts).body;
}

/** Just the stuff that goes inside <head>: title + one <style> block. */
export function marqueeHead(source: string, opts: MarqueeOptions = {}): string {
  const { css, title } = marqueeFragment(source, opts);
  return `<title>${escapeText(title)}</title>\n<style>\n${css}\n</style>`;
}

function pageShell({ body, css, title }: Fragment): string {
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
${body}
</body>
</html>
`;
}

/** The one smooth motion: Marquee source in, a complete self-contained
 * HTML page out. Synchronous and fetchless - turbolinks with nothing
 * gathered degrade to plain links. */
export function marquee(source: string, opts: MarqueeOptions = {}): string {
  return pageShell(marqueeFragment(source, opts));
}

/** marquee(), plus the network: runs the composed plugins' async resolve()
 * phase ahead of the render - OpenGraph summaries for bare web links
 * (opengraphPlugin joins the chain automatically), plus whatever gathering
 * your own plugins declare. That means this function EXECUTES plugin fetch
 * code: compose the chain from plugins you trust, because a malicious one
 * runs here too. Rendering itself stays sync and fetchless; a failed fetch
 * degrades to the plain link. */
export async function marqueeFetch(source: string, opts: MarqueeOptions = {}): Promise<string> {
  const plugins = fetchChain(opts);
  const doc = parse(source);
  const resolved = await resolveTargets(turbolinkTargets(doc), plugins);
  return pageShell(fragmentCore(doc, opts, plugins, resolved));
}

export { buildSite, buildSiteFetch, type SiteReport } from "./build-site.ts";

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
export type { EmojiResolution, MediaResolution, Profile, TurbolinkLevel } from "@cube-drone/marquee-html-renderer";
export { marqueeCss } from "@cube-drone/marquee-css";
export { standardEmoji } from "@cube-drone/marquee-emoji";
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
