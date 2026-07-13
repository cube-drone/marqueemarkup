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
  /** Force the page's theme. Default: follow the reader's OS
   * (`color-scheme: light dark`). Applies to the page shell, so it only
   * affects `marquee()`/`marqueeFetch()` - fragments follow their host. */
  colorScheme?: "light" | "dark";
  /** Wrap the rendered document in a 650px centered envelope, purely for
   * readability (default false - it could interfere with a host stack's
   * own layout, so it's opt-in). A document that IS a `:::page` (its
   * top-level content is page directives) is left alone even when this is
   * on: the author took layout control, the envelope defers. */
  envelope?: boolean;
  /** Best-effort color-readability rescue: author colors keep their hue
   * but their lightness is clamped toward the canvas's opposite -
   * lightened on dark canvases, darkened on light. Containers that paint
   * their own background (schemes, `background=` knobs) own their contrast
   * and are left alone. Defaults ON for whole pages (marquee/marqueeFetch/
   * buildSite - our shell declared the color-scheme, so the clamp direction
   * is trustworthy) and OFF for bare fragments (a host theming by class
   * rather than OS preference would get the clamp backwards - opt in when
   * your canvas follows prefers-color-scheme). */
  readable?: boolean;
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

/** The readability envelope: omnibus convenience, not renderer contract
 * (mq-* classes in marquee.css are the renderers'; this one is ours). */
export const envelopeCss = `.mq-envelope { max-width: 650px; margin-inline: auto; padding-inline: 1rem; }`;

/** The `readable` option's stylesheet: CSS relative color syntax clamps the
 * *lightness* of author colors (hue and chroma survive) toward whatever the
 * canvas isn't - floor 0.72 on dark canvases, ceiling 0.55 on light. The
 * clamp bounds ride inherited custom properties, so containers that paint
 * their own background (schemes, `background=` knobs) reset them to no-ops
 * for their whole subtree: they own their contrast. A painted background
 * with NO chosen text color additionally gets black-or-white text computed
 * from the background's own lightness. Browsers without relative-color
 * support ignore all of it and fall back to the raw colors. */
export function readabilityCss(colorScheme?: "light" | "dark"): string {
  const dark = `.mq-doc { --mq-rl-min: 0.72; --mq-rl-max: 1; }`;
  const light = `.mq-doc { --mq-rl-min: 0; --mq-rl-max: 0.55; }`;
  const mode =
    colorScheme === "dark"
      ? dark
      : colorScheme === "light"
        ? light
        : `@media (prefers-color-scheme: dark) { ${dark} }\n@media (prefers-color-scheme: light) { ${light} }`;
  return `${mode}
.mq-doc [style*="--mq-color"] { color: oklch(from var(--mq-color) clamp(var(--mq-rl-min, 0), l, var(--mq-rl-max, 1)) c h); }
.mq-doc [style*="--mq-bg"]:not([style*="--mq-color"]) { color: oklch(from var(--mq-bg) calc(1 - clamp(0, (l - 0.5) * 999, 1)) 0 h); }
.mq-doc [class*="mq-scheme-"], .mq-doc [style*="--mq-bg"] { --mq-rl-min: 0; --mq-rl-max: 1; }`;
}

/** Does the document take layout into its own hands? Only when it IS a
 * page: every top-level block (ignoring `:::meta` and comments) is a
 * `:::page` directive. A document that merely *contains* a page demo among
 * prose is still an unstructured document, and the envelope applies. */
export function docIsPage(doc: Node): boolean {
  if (doc.type !== "document") {
    return false;
  }
  const blocks = doc.children.filter(
    (c) => c.type !== "comment" && !(c.type === "directive" && c.name === "meta"),
  );
  return blocks.length > 0 && blocks.every((c) => c.type === "directive" && c.name === "page");
}

function fragmentCore(
  doc: Node,
  opts: MarqueeOptions,
  plugins: TurbolinkPlugin[],
  resolved?: Map<string, unknown>,
): Fragment {
  const profile = assembleProfile(opts, plugins, resolved);
  let body = render(doc, profile);
  const enveloped = opts.envelope === true && !docIsPage(doc);
  if (enveloped) {
    body = `<div class="mq-envelope">${body}</div>`;
  }
  const fontTokens = usedFontTokens(body);
  let css = `${marqueeCss}\n${turbolinkStyles(plugins)}`;
  if (enveloped) {
    css += `\n${envelopeCss}`;
  }
  if (opts.readable === true) {
    css += `\n${readabilityCss(opts.colorScheme)}`;
  }
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

function pageShell({ body, css, title }: Fragment, colorScheme?: "light" | "dark"): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeText(title)}</title>
<style>
/* The page is ours, so it follows the reader's OS theme unless the caller
   forced one. marquee.css never declares color-scheme itself - embedded
   fragments defer to their host - and its own neutrals are translucent, so
   they ride either canvas. */
:root { color-scheme: ${colorScheme ?? "light dark"}; }
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
  return pageShell(marqueeFragment(source, { readable: true, ...opts }), opts.colorScheme);
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
  return pageShell(fragmentCore(doc, { readable: true, ...opts }, plugins, resolved), opts.colorScheme);
}

export { buildSite, buildSiteFetch, type SiteReport } from "./build-site.ts";

// The full toolbox, re-exported: growth never requires switching packages.
export { parse, parseWithPositions, UnsupportedVersionError } from "@cube-drone/marquee-parser";
export type { Attrs, Node, Reason, Span } from "@cube-drone/marquee-parser";
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
