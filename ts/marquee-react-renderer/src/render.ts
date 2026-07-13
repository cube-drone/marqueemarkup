// AST -> React elements. The interactive sibling of @cube-drone/marquee-html-renderer:
// same mq-* class contract, same Profile socket, same spec obligations - but
// the tree is built from React elements, never from an HTML string, so the
// "AST is the contract" rule holds by construction (there is no innerHTML
// path for author bytes, not even a tempting one).
//
// The one place raw HTML is injected is embedder-trusted hook output
// (Profile.turbolink / .directive / .span return HTML strings, as the static
// renderer's socket requires). That is embedder code, exactly like a plugin -
// author bytes only ever reach it as a target string, which the hook escapes.
// Pass React-returning `hooks` instead to avoid the string path entirely.

import { createElement as h, useState, type KeyboardEvent, type ReactNode } from "react";
import type { Attrs, Node, Span } from "@cube-drone/marquee-parser";
import {
  FONTS,
  type EmojiResolution,
  type Profile,
  type TurbolinkLevel,
} from "@cube-drone/marquee-html-renderer";

/** React-returning versions of the rendering hooks. When present these win
 * over the string-returning `Profile` hooks (no innerHTML at all). */
export interface ReactHooks {
  turbolink?(target: string, level: TurbolinkLevel): ReactNode | null;
  directive?(name: string, attrs: Attrs, children: ReactNode): ReactNode | null;
  span?(name: string, attrs: Attrs, children: ReactNode): ReactNode | null;
}

export interface Ctx {
  profile: Profile;
  hooks: ReactHooks;
  spans: WeakMap<Node, Span> | null;
  /** Registers a node's DOM element (scroll sync, reverse sync). */
  register: (node: Node) => (el: HTMLElement | null) => void;
  note: { n: number; pending: ReactNode[] };
}

/** Effects whose elements the visibility observer watches, and which the
 * skip gesture stills. Named, closed: the vocabulary decides, not the DOM. */
const ANIMATED = new Set([
  "marquee",
  "blink",
  "rainbow",
  "bounce",
  "jitter",
  "wave",
  "rubber",
  "typewriter",
  "fadein",
]);

export const ANIM_CLASS = "mq-anim";

// -- validation gates (mirrors the static renderer: closed value grammars,
// failures degrade, never emit)

const HEX_OR_TOKEN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$|^[a-z][a-z0-9-]{0,31}$/;
const TOKEN = /^[a-z][a-z0-9-]{0,31}$/;
const COUNT = /^[0-9]{1,4}$/;

function isColorValue(v: string | undefined): v is string {
  return v !== undefined && HEX_OR_TOKEN.test(v);
}

function isToken(v: string | undefined): v is string {
  return v !== undefined && TOKEN.test(v);
}

const MEDIA_SIZE_TOKENS: Record<string, string> = {
  small: "10rem",
  medium: "20rem",
  large: "32rem",
  full: "100%",
};

function mediaSize(v: string | undefined): string | null {
  if (v === undefined) {
    return null;
  }
  const token = MEDIA_SIZE_TOKENS[v];
  if (token !== undefined) {
    return token;
  }
  if (/^[0-9]{1,4}$/.test(v)) {
    const n = Number(v);
    return n >= 1 && n <= 4096 ? `${n}px` : null;
  }
  return null;
}

/** A URL safe inside a CSS url('...') token: author bytes must not write
 * CSS, even in their own style attribute. */
function cssUrl(url: string): string {
  return encodeURI(url).replaceAll("'", "%27").replaceAll("(", "%28").replaceAll(")", "%29");
}

/** Style knobs -> React style object (custom properties are legal keys). */
function styleVars(attrs: Attrs, profile: Profile): Record<string, string> {
  const style: Record<string, string> = {};
  if (isColorValue(attrs["color"])) {
    style["--mq-color"] = attrs["color"];
  }
  const bg = attrs["background"];
  if (bg !== undefined && bg.startsWith("tile:")) {
    const media = profile.media(bg.slice("tile:".length));
    if (media !== null && media.kind === "image") {
      style["--mq-bg-tile"] = `url('${cssUrl(media.url)}')`;
    }
  } else if (isColorValue(bg)) {
    style["--mq-bg"] = bg;
  }
  return style;
}

function schemeClass(attrs: Attrs): string {
  return isToken(attrs["scheme"]) ? ` mq-scheme-${attrs["scheme"]}` : "";
}

function fontClass(attrs: Attrs): string {
  const value = attrs["font"];
  return value !== undefined && FONTS[value] !== undefined ? ` mq-font-${value}` : "";
}

/** Element props shared by every node-backed element: the ref that registers
 * it, and (when positions are known) its source extent - which is what makes
 * click-in-preview -> jump-in-editor a one-liner for the host. */
function nodeProps(node: Node, ctx: Ctx, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const props: Record<string, unknown> = { ...extra, ref: ctx.register(node) };
  const span = ctx.spans?.get(node);
  if (span !== undefined) {
    props["data-mq-start"] = span.start;
    props["data-mq-end"] = span.end;
  }
  return props;
}

/** Trusted embedder HTML (hook output), never author bytes. */
function trustedHtml(tag: string, html: string, key?: string): ReactNode {
  return h(tag, { key, dangerouslySetInnerHTML: { __html: html } });
}

export function renderChildren(nodes: Node[], ctx: Ctx): ReactNode[] {
  return nodes.map((node, i) => renderNode(node, ctx, String(i)));
}

/** Asides flush just below the block that triggered them - part of regular
 * flow, no floats, no popups (the same treatment as the static renderer). */
function withNotes(ctx: Ctx, element: ReactNode, key: string): ReactNode {
  if (ctx.note.pending.length === 0) {
    return element;
  }
  const notes = ctx.note.pending;
  ctx.note.pending = [];
  return h(
    "div",
    { key, style: { display: "contents" } },
    element,
    h(
      "aside",
      { key: "notes", className: "mq-notes" },
      notes.map((n, i) => h("p", { key: i, className: "mq-note" }, n)),
    ),
  );
}

export function renderNode(node: Node, ctx: Ctx, key: string): ReactNode {
  switch (node.type) {
    case "document":
      return h("div", nodeProps(node, ctx, { key, className: "mq-doc" }), ...renderChildren(node.children, ctx));
    case "paragraph": {
      const el = h("p", nodeProps(node, ctx, { key }), ...renderChildren(node.children, ctx));
      return withNotes(ctx, el, key);
    }
    case "heading": {
      const inner = renderChildren(node.children, ctx);
      // HTML's ladder stops at h6; 7 and 8 keep heading semantics via ARIA.
      const el =
        node.level <= 6
          ? h(`h${node.level}`, nodeProps(node, ctx, { key }), ...inner)
          : h(
              "p",
              nodeProps(node, ctx, {
                key,
                className: `mq-h${node.level}`,
                role: "heading",
                "aria-level": node.level,
              }),
              ...inner,
            );
      return withNotes(ctx, el, key);
    }
    case "code_block": {
      const lang = infoToken(node.info);
      return h(
        "pre",
        nodeProps(node, ctx, { key, className: "mq-code" }),
        h("code", { className: lang === null ? undefined : `language-${lang}` }, node.text === "" ? null : `${node.text}\n`),
      );
    }
    case "blockquote":
      return h("blockquote", nodeProps(node, ctx, { key }), ...renderChildren(node.children, ctx));
    case "list":
      return h(node.ordered ? "ol" : "ul", nodeProps(node, ctx, { key }), ...renderChildren(node.children, ctx));
    case "list_item":
      return h("li", nodeProps(node, ctx, { key }), ...renderChildren(node.children, ctx));
    case "thematic_break":
      return h("hr", nodeProps(node, ctx, { key }));
    case "directive":
      return directive(node, ctx, key);
    case "invalid_directive":
      return h(
        "div",
        nodeProps(node, ctx, { key, className: "mq-invalid", "data-reason": node.reason }),
      );
    case "comment":
      return null; // the anti-shrug: correct rendering is absence
    case "text":
      return node.value;
    case "emphasis":
      return h("em", nodeProps(node, ctx, { key }), ...renderChildren(node.children, ctx));
    case "strong":
      return h("strong", nodeProps(node, ctx, { key }), ...renderChildren(node.children, ctx));
    case "strikethrough":
      return h("del", nodeProps(node, ctx, { key }), ...renderChildren(node.children, ctx));
    case "code_span":
      return h("code", nodeProps(node, ctx, { key }), node.text);
    case "link": {
      const inner = renderChildren(node.children, ctx);
      return ctx.profile.linkAllowed(node.target)
        ? h("a", nodeProps(node, ctx, { key, href: node.target }), ...inner)
        : h("span", nodeProps(node, ctx, { key, className: "mq-blocked" }), ...inner);
    }
    case "embed":
      return embed(node, ctx, key);
    case "turbolink":
      return turbolink(node, node.target, undefined, ctx, key);
    case "span":
      return span(node, ctx, key);
    case "emoji": {
      const resolved: EmojiResolution | null = ctx.profile.emoji(node.slug);
      if (resolved !== null && typeof resolved === "object") {
        return h("img", nodeProps(node, ctx, {
          key,
          className: "mq-emoji",
          src: resolved.image,
          alt: resolved.alt ?? `:${node.slug}:`,
          loading: "lazy",
        }));
      }
      return resolved ?? `:${node.slug}:`;
    }
    case "hard_break":
      return h("br", nodeProps(node, ctx, { key }));
  }
}

/** A spoiler that reveals on a deliberate click (or Enter/Space), and
 * stays revealed. Keyboard- and screen-reader-accessible: it announces
 * itself as an expandable button. The `rest` carries nodeProps (the
 * register ref + source-position data attrs), so scroll sync still finds
 * it. */
function Spoiler({
  children,
  tag = "span",
  ...rest
}: { children?: ReactNode; tag?: string } & Record<string, unknown>): ReactNode {
  const [revealed, setRevealed] = useState(false);
  const reveal = (): void => setRevealed(true);
  return h(
    tag,
    {
      ...rest,
      role: "button",
      tabIndex: 0,
      "aria-expanded": revealed,
      "aria-label": revealed ? undefined : "spoiler, click to reveal",
      "data-mq-revealed": revealed ? "" : undefined,
      onClick: reveal,
      onKeyDown: (e: KeyboardEvent<HTMLSpanElement>) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          reveal();
        }
      },
    },
    children,
  );
}

function infoToken(info: string | undefined): string | null {
  if (info === undefined) {
    return null;
  }
  const first = info.split(/[ \t]/, 1)[0] ?? "";
  return /^[A-Za-z0-9_+-]{1,32}$/.test(first) ? first : null;
}

function embed(node: Node & { type: "embed" }, ctx: Ctx, key: string): ReactNode {
  const media = ctx.profile.media(node.target);
  if (media === null) {
    return h(
      "span",
      nodeProps(node, ctx, { key, className: "mq-placeholder" }),
      node.alt === "" ? node.target : node.alt,
    );
  }
  const common = { key, className: "mq-embed" };
  if (media.kind === "image") {
    return h("img", nodeProps(node, ctx, { ...common, src: media.url, alt: node.alt, loading: "lazy" }));
  }
  if (media.kind === "audio") {
    return h("audio", nodeProps(node, ctx, { ...common, src: media.url, controls: true }));
  }
  return h("video", nodeProps(node, ctx, { ...common, src: media.url, controls: true }));
}

const TURBOLINK_LEVELS = new Set<TurbolinkLevel>(["full", "title", "bare"]);

function turbolink(
  node: Node,
  target: string,
  levelAttr: string | undefined,
  ctx: Ctx,
  key: string,
): ReactNode {
  if (!ctx.profile.linkAllowed(target)) {
    return h("p", nodeProps(node, ctx, { key, className: "mq-turbolink" }), target);
  }
  const level =
    levelAttr !== undefined && TURBOLINK_LEVELS.has(levelAttr as TurbolinkLevel)
      ? (levelAttr as TurbolinkLevel)
      : ctx.profile.turbolinkLevel(target);
  if (level !== "bare") {
    const react = ctx.hooks.turbolink?.(target, level) ?? null;
    const html = react === null ? ctx.profile.turbolink(target, level) : null;
    if (react !== null || html !== null) {
      // Enrichment augments, never replaces: the wrapper carries the
      // original link, so no plugin can eat it - not even by accident.
      return h(
        "div",
        nodeProps(node, ctx, { key, className: "mq-turbolink mq-turbolink-rich" }),
        react ?? trustedHtml("span", html!, "rich"),
        h("a", { key: "src", className: "mq-turbolink-source", href: target }, target),
      );
    }
  }
  return h(
    "p",
    nodeProps(node, ctx, { key, className: "mq-turbolink" }),
    h("a", { href: target }, target),
  );
}

function directive(node: Node & { type: "directive" }, ctx: Ctx, key: string): ReactNode {
  const { name, attrs } = node;
  const kids = renderChildren(node.children, ctx);

  const custom = ctx.hooks.directive?.(name, attrs, kids);
  if (custom !== undefined && custom !== null) {
    return h("div", nodeProps(node, ctx, { key, style: { display: "contents" } }), custom);
  }
  const customHtml = ctx.hooks.directive === undefined ? ctx.profile.directive(name, attrs, "") : null;
  if (customHtml !== null) {
    return h(
      "div",
      nodeProps(node, ctx, { key, style: { display: "contents" }, dangerouslySetInnerHTML: { __html: customHtml } }),
    );
  }

  switch (name) {
    case "meta":
      return h("div", nodeProps(node, ctx, { key, style: { display: "contents" } }), ...kids);
    case "page": {
      const layout = isToken(attrs["layout"]) ? ` mq-layout-${attrs["layout"]}` : "";
      return h(
        "div",
        nodeProps(node, ctx, {
          key,
          className: `mq-page${layout}${schemeClass(attrs)}${fontClass(attrs)}`,
          style: styleVars(attrs, ctx.profile),
        }),
        ...kids,
      );
    }
    case "section":
      return h(
        "section",
        nodeProps(node, ctx, {
          key,
          className: `mq-section${schemeClass(attrs)}${fontClass(attrs)}`,
          "data-slot": isToken(attrs["slot"]) ? attrs["slot"] : undefined,
          style: styleVars(attrs, ctx.profile),
        }),
        ...kids,
      );
    case "turbolink":
      if (attrs["target"] !== undefined) {
        return turbolink(node, attrs["target"], attrs["level"], ctx, key);
      }
      break;
    case "media": {
      const style: Record<string, string> = {};
      const w = mediaSize(attrs["width"]);
      const hh = mediaSize(attrs["height"]);
      if (w !== null) {
        style["--mq-media-w"] = w;
      }
      if (hh !== null) {
        style["--mq-media-h"] = hh;
      }
      return h("div", nodeProps(node, ctx, { key, className: "mq-media", style }), ...kids);
    }
    case "table":
      return renderTable(node, ctx, key);
    case "center":
    case "right":
    case "left":
      return h("div", nodeProps(node, ctx, { key, className: `mq-${name}` }), ...kids);
    case "spoiler":
      // Block spoiler: same click-to-reveal as the inline one, on a div.
      return h(
        Spoiler,
        nodeProps(node, ctx, { key, tag: "div", className: "mq-spoiler mq-spoiler-block" }),
        ...kids,
      );
  }
  // Unknown vocabulary: a container renders its children with an affordance;
  // a leaf renders the inert placeholder. Never eat authored content.
  return node.children.length > 0
    ? h("div", nodeProps(node, ctx, { key, className: "mq-unknown", "data-directive": name }), ...kids)
    : h("div", nodeProps(node, ctx, { key, className: "mq-placeholder", "data-directive": name }));
}

/** :::table - paragraph-rows, [c] cell spans (SPEC.md, "Tables"). */
function renderTable(node: Node & { type: "directive" }, ctx: Ctx, key: string): ReactNode {
  const header = node.attrs["header"];
  const headRow = header === "row" || header === "both";
  const headCol = header === "column" || header === "both";
  const rows: ReactNode[] = [];

  node.children.forEach((child, ri) => {
    const cells: ReactNode[][] = [];
    if (child.type === "paragraph") {
      let loose: Node[] = [];
      const flush = (): void => {
        if (loose.some((n) => n.type !== "text" || n.value.trim() !== "")) {
          cells.push(renderChildren(loose, ctx));
        }
        loose = [];
      };
      for (const inline of child.children) {
        if (inline.type === "span" && inline.name === "c") {
          flush();
          cells.push(renderChildren(inline.children, ctx));
        } else {
          loose.push(inline);
        }
      }
      flush();
    } else {
      cells.push([renderNode(child, ctx, "0")]);
    }
    const isHeadRow = headRow && rows.length === 0;
    rows.push(
      h(
        "tr",
        { key: ri },
        cells.map((cell, ci) =>
          isHeadRow || (headCol && ci === 0)
            ? h("th", { key: ci, scope: isHeadRow ? "col" : "row" }, ...cell)
            : h("td", { key: ci }, ...cell),
        ),
      ),
    );
  });

  const table = h(
    "table",
    nodeProps(node, ctx, { key, className: "mq-table" }),
    h("tbody", null, rows),
  );
  return withNotes(ctx, table, key);
}

function sizeRung(value: string, inner: ReactNode[], node: Node, ctx: Ctx, key: string): ReactNode {
  // <font> is deliberate: presentational attributes are outside CSP's
  // jurisdiction, so size survives with no stylesheet at all.
  return h(
    "font",
    nodeProps(node, ctx, { key, className: `mq-size-${value}`, size: value }),
    ...inner,
  );
}

function span(node: Node & { type: "span" }, ctx: Ctx, key: string): ReactNode {
  const { name, attrs } = node;
  const kids = renderChildren(node.children, ctx);

  const custom = ctx.hooks.span?.(name, attrs, kids);
  if (custom !== undefined && custom !== null) {
    return h("span", nodeProps(node, ctx, { key, style: { display: "contents" } }), custom);
  }
  const customHtml = ctx.hooks.span === undefined ? ctx.profile.span(name, attrs, "") : null;
  if (customHtml !== null) {
    return h(
      "span",
      nodeProps(node, ctx, { key, dangerouslySetInnerHTML: { __html: customHtml } }),
    );
  }

  switch (name) {
    case "sup":
      return h("sup", nodeProps(node, ctx, { key }), ...kids);
    case "sub":
      return h("sub", nodeProps(node, ctx, { key }), ...kids);
    case "small":
      return h("small", nodeProps(node, ctx, { key }), ...kids);
    case "big":
      return h("big", nodeProps(node, ctx, { key }), ...kids);
    case "spoiler":
      // Click-to-reveal (the static renderer can only blur-until-hover).
      // Same mq-spoiler class; .mq-root in the shared CSS gates hover off
      // and honors the data-mq-revealed this component sets on click.
      return h(Spoiler, nodeProps(node, ctx, { key, className: "mq-spoiler" }), ...kids);
    case "size": {
      const value = attrs["size"];
      return value !== undefined && /^[1-7]$/.test(value)
        ? sizeRung(value, kids, node, ctx, key)
        : h("span", nodeProps(node, ctx, { key, style: { display: "contents" } }), ...kids);
    }
    case "teeny":
      return sizeRung("1", kids, node, ctx, key);
    case "tiny":
      return sizeRung("2", kids, node, ctx, key);
    case "huge":
      return sizeRung("6", kids, node, ctx, key);
    case "enormous":
      return sizeRung("7", kids, node, ctx, key);
    case "font": {
      const value = attrs["font"];
      const face = value !== undefined ? FONTS[value] : undefined;
      return face !== undefined
        ? h("font", nodeProps(node, ctx, { key, className: `mq-font-${value}`, face }), ...kids)
        : h("span", nodeProps(node, ctx, { key, style: { display: "contents" } }), ...kids);
    }
    case "color": {
      const value = attrs["color"];
      return isColorValue(value)
        ? h(
            "font",
            nodeProps(node, ctx, {
              key,
              className: "mq-color",
              color: value,
              style: { "--mq-color": value } as Record<string, string>,
            }),
            ...kids,
          )
        : h("span", nodeProps(node, ctx, { key, style: { display: "contents" } }), ...kids);
    }
    case "sidenote":
    case "aside":
    case "footnote": {
      // A numbered mark in the flow; the note flushes below the block.
      ctx.note.n += 1;
      const n = ctx.note.n;
      ctx.note.pending.push(
        h("span", { key: `note-${n}` }, h("span", { className: "mq-note-num" }, n), ...kids),
      );
      return h("sup", nodeProps(node, ctx, { key, className: "mq-noteref" }), n);
    }
    case "marquee": {
      const dir = attrs["direction"] === "right" ? "right" : undefined;
      const style: Record<string, string> = {};
      if (attrs["speed"] !== undefined && COUNT.test(attrs["speed"])) {
        style["--mq-speed"] = attrs["speed"];
      }
      return h(
        "span",
        nodeProps(node, ctx, {
          key,
          className: `mq-marquee ${ANIM_CLASS}`,
          "data-direction": dir,
          style,
        }),
        h("span", { className: "mq-marquee-inner" }, ...kids),
      );
    }
    case "blink":
    case "rainbow":
    case "bounce":
    case "jitter":
    case "wave":
    case "rubber":
    case "typewriter":
    case "fadein":
      return effect(node, ctx, key);
  }
  // Unknown span: pure shrug, children as plain content.
  return h("span", nodeProps(node, ctx, { key, style: { display: "contents" } }), ...kids);
}

// -- effects, including the per-unit (by=letter / by=word) machinery. The
// offsets mirror the static renderer's exactly, so a document animates the
// same in both - deterministic, never random.

const SEGMENTERS = {
  letter: new Intl.Segmenter("en", { granularity: "grapheme" }),
  word: new Intl.Segmenter("en", { granularity: "word" }),
};

type SplitBy = keyof typeof SEGMENTERS;

const MAX_SPLIT_UNITS = 400;
const MAX_REVEAL_UNITS = 2000;

function isReveal(effectName: string): boolean {
  return effectName === "typewriter" || effectName === "fadein";
}

function revealStep(speedAttr: string | undefined, dflt: number): number {
  const speed =
    speedAttr !== undefined && COUNT.test(speedAttr) && Number(speedAttr) > 0
      ? Number(speedAttr)
      : dflt;
  return Math.round(1000 / speed) / 1000;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function scatterStride(total: number): number {
  let stride = Math.max(1, Math.round(total * 0.618));
  while (stride < total && gcd(stride, total) !== 1) {
    stride += 1;
  }
  return gcd(stride, total) === 1 ? stride : 1;
}

interface SplitState {
  effect: string;
  by: SplitBy;
  phase: "ramp" | "scatter";
  i: number;
  total: number;
}

function unitOffset(state: SplitState): string {
  if (isReveal(state.effect)) {
    const o =
      state.phase === "scatter" ? (state.i * scatterStride(state.total)) % state.total : state.i;
    return String(o);
  }
  let o: number;
  if (state.phase === "scatter") {
    o = ((state.i * 7919) % 101) / 101;
  } else {
    switch (state.effect) {
      case "rainbow":
        o = state.i / state.total;
        break;
      case "bounce":
        o = (state.i % 6) / 6;
        break;
      default:
        o = (state.i % 8) / 8;
        break;
    }
  }
  return String(Math.round(o * 1000) / 1000);
}

function isUnit(seg: Intl.SegmentData, by: SplitBy): boolean {
  return by === "word" ? seg.isWordLike === true : !/^\s+$/.test(seg.segment);
}

function countUnits(nodes: Node[], by: SplitBy): number {
  let n = 0;
  for (const node of nodes) {
    if (node.type === "text") {
      for (const seg of SEGMENTERS[by].segment(node.value)) {
        if (isUnit(seg, by)) {
          n += 1;
        }
      }
    } else if (node.type === "emphasis" || node.type === "strong" || node.type === "strikethrough") {
      n += countUnits(node.children, by);
    }
  }
  return n;
}

function splitRender(nodes: Node[], ctx: Ctx, state: SplitState): ReactNode[] {
  const out: ReactNode[] = [];
  nodes.forEach((node, ni) => {
    if (node.type === "text") {
      for (const seg of SEGMENTERS[state.by].segment(node.value)) {
        if (!isUnit(seg, state.by)) {
          out.push(seg.segment); // spaces and punctuation ride along
          continue;
        }
        const o = unitOffset(state);
        state.i += 1;
        out.push(
          h(
            "span",
            { key: `${ni}-${state.i}`, className: "mq-l", style: { "--mq-o": o } as Record<string, string> },
            seg.segment,
          ),
        );
      }
    } else if (node.type === "emphasis") {
      out.push(h("em", { key: ni }, ...splitRender(node.children, ctx, state)));
    } else if (node.type === "strong") {
      out.push(h("strong", { key: ni }, ...splitRender(node.children, ctx, state)));
    } else if (node.type === "strikethrough") {
      out.push(h("del", { key: ni }, ...splitRender(node.children, ctx, state)));
    } else {
      out.push(renderNode(node, ctx, String(ni))); // anything else renders whole
    }
  });
  return out;
}

function effect(node: Node & { type: "span" }, ctx: Ctx, key: string): ReactNode {
  const { name, attrs } = node;
  const byAttr = attrs["by"];
  const splitBy: SplitBy | null =
    byAttr === "letter" || byAttr === "word"
      ? byAttr
      : name === "typewriter"
        ? "letter" // typewriter is per-unit by nature
        : null;

  const style: Record<string, string> = {};
  if (name === "blink" && attrs["rate"] !== undefined && COUNT.test(attrs["rate"])) {
    style["--mq-rate"] = attrs["rate"];
  }
  if (name === "typewriter") {
    style["--mq-tw-step"] = `${revealStep(attrs["speed"], 14)}s`;
  }
  if (name === "fadein" && splitBy !== null) {
    style["--mq-fi-step"] = `${revealStep(attrs["speed"], 16)}s`;
  }

  const className = `mq-${name} ${ANIM_CLASS}`;

  if (splitBy === null) {
    return h(
      "span",
      nodeProps(node, ctx, { key, className, style }),
      ...renderChildren(node.children, ctx),
    );
  }

  const phase: "ramp" | "scatter" =
    attrs["phase"] === "scatter" || attrs["phase"] === "ramp"
      ? attrs["phase"]
      : name === "jitter"
        ? "scatter"
        : "ramp";
  const total = countUnits(node.children, splitBy);
  const cap = isReveal(name) ? MAX_REVEAL_UNITS : MAX_SPLIT_UNITS;
  if (total === 0 || total > cap) {
    // Past the cap: the run animates whole. DOM weight discipline.
    return h(
      "span",
      nodeProps(node, ctx, { key, className, style }),
      ...renderChildren(node.children, ctx),
    );
  }
  const state: SplitState = { effect: name, by: splitBy, phase, i: 0, total };
  return h(
    "span",
    nodeProps(node, ctx, { key, className: `${className} mq-split`, style }),
    ...splitRender(node.children, ctx, state),
  );
}

export { ANIMATED };
