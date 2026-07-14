// The decoration planner - the Obsidian live-preview brain, as a pure
// function of (source, cursor selections) -> a list of decoration specs.
// No CodeMirror, no DOM: it is the testable core, and the CM adapter
// (marquee.ts) is a thin translation of these specs into CM decorations.
//
// Two regimes, split on block vs inline - because Marquee's grammar is:
//
//   - INLINE formatting (bold, links, effects, color, emoji) inside a plain
//     paragraph or heading is *styled in place*: the run is drawn styled
//     while its markers stay visible (dimmed) under the cursor and hide when
//     the cursor leaves. Effects get their real animating classes. This is
//     the "augmented source" view you edit in.
//
//   - Every BLOCK the cursor isn't inside (a list, a quote, a code block, a
//     table, a media row, a turbolink, an image-bearing or aside-bearing
//     paragraph, any content directive) is *replaced by a widget rendered by
//     the real HTML renderer*. Move the cursor into it and it opens to
//     source. This is why lists look like lists and code looks like code:
//     it IS the renderer's output.
//
// Layout containers (`:::page`, `:::section`) are left as source and their
// children previewed inside - accurately previewing a page layout is the
// job of a separate window, not the inline editor.
//
// Exact, not heuristic: every decision comes from the one true parse and its
// source positions (SPEC.md, "Source positions").

import { parseWithPositions, type Node, type Span } from "@cube-drone/marquee-parser";
import { FONTS, type Profile } from "@cube-drone/marquee-html-renderer";

export interface Sel {
  from: number;
  to: number;
}

export type DecoSpec =
  /** Style raw text in place (bold, a heading size, a color, an effect). */
  | { kind: "mark"; from: number; to: number; class?: string; style?: string }
  /** Hide a range entirely - a marker the cursor isn't near. */
  | { kind: "hide"; from: number; to: number }
  /** Replace an inline range with a small widget (a resolved emoji glyph). */
  | { kind: "widget"; from: number; to: number; widget: WidgetSpec }
  /** Replace a whole block's source with the renderer's output for it. */
  | { kind: "block"; from: number; to: number; node: Node };

export type WidgetSpec = { type: "emoji"; slug: string };

/** Inline effect spans - animated in the editor when the cursor is away
 * (their real mq-* classes), static when you're editing them. */
const EFFECTS = new Set([
  "blink", "rainbow", "bounce", "jitter", "wave", "rubber", "typewriter", "fadein", "marquee",
]);

const SIZE_EM: Record<string, string> = {
  "1": "0.65em", "2": "0.82em", "3": "1em", "4": "1.15em",
  "5": "1.35em", "6": "1.7em", "7": "2.4em",
};
const NAMED_SIZE: Record<string, string> = { teeny: "1", tiny: "2", huge: "6", enormous: "7" };
const HEX_OR_TOKEN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$|^[a-z][a-z0-9-]{0,31}$/;

export function plan(source: string, sels: Sel[], profile: Profile): DecoSpec[] {
  const { doc, spans } = parseWithPositions(source);
  return planFromAst(doc, spans, source, sels, profile);
}

export function planFromAst(
  doc: Node,
  spans: WeakMap<Node, Span>,
  source: string,
  sels: Sel[],
  profile: Profile,
): DecoSpec[] {
  const out: DecoSpec[] = [];
  const touched = (s: Span): boolean => sels.some((r) => r.from <= s.end && r.to >= s.start);

  const markers = (open: [number, number], close: [number, number], active: boolean): void => {
    for (const [a, b] of [open, close]) {
      if (b > a) {
        out.push(active ? { kind: "mark", from: a, to: b, class: "cm-mq-marker" } : { kind: "hide", from: a, to: b });
      }
    }
  };

  // -- inline: styled source with cursor-gated markers (plain paragraphs) --

  const inline = (node: Node): void => {
    const span = spans.get(node);
    switch (node.type) {
      case "heading": {
        if (span) {
          markers([span.start, span.start + node.level + 1], [span.start, span.start], touched(span));
          out.push({ kind: "mark", from: span.start + node.level + 1, to: span.end, class: `cm-mq-h${node.level}` });
        }
        node.children.forEach(inline);
        return;
      }
      case "emphasis":
      case "strong":
      case "strikethrough": {
        if (span) {
          const n = node.type === "emphasis" ? 1 : 2;
          const cls = node.type === "emphasis" ? "cm-mq-em" : node.type === "strong" ? "cm-mq-strong" : "cm-mq-strike";
          out.push({ kind: "mark", from: span.start, to: span.end, class: cls });
          markers([span.start, span.start + n], [span.end - n, span.end], touched(span));
        }
        node.children.forEach(inline);
        return;
      }
      case "code_span": {
        if (span) {
          let n = 0;
          while (source[span.start + n] === "`") n += 1;
          out.push({ kind: "mark", from: span.start, to: span.end, class: "cm-mq-code" });
          markers([span.start, span.start + n], [span.end - n, span.end], touched(span));
        }
        return;
      }
      case "link": {
        if (span) {
          const tail = source.indexOf("](", span.start);
          const textEnd = tail === -1 || tail >= span.end ? span.end : tail;
          out.push({ kind: "mark", from: span.start + 1, to: textEnd, class: "cm-mq-link" });
          markers([span.start, span.start + 1], [textEnd, span.end], touched(span));
        }
        node.children.forEach(inline);
        return;
      }
      case "emoji": {
        if (span && !touched(span) && profile.emoji(node.slug) !== null) {
          out.push({ kind: "widget", from: span.start, to: span.end, widget: { type: "emoji", slug: node.slug } });
        }
        return;
      }
      case "comment": {
        if (span) out.push({ kind: "mark", from: span.start, to: span.end, class: "cm-mq-comment" });
        return;
      }
      case "span": {
        if (span) {
          const active = touched(span);
          const openEnd = source.indexOf("]", span.start);
          const open: [number, number] = [span.start, openEnd === -1 ? span.start : openEnd + 1];
          const close: [number, number] = [span.end - (node.name.length + 3), span.end];
          out.push(spanContentSpec(node, open[1], close[0], active));
          markers(open, close, active);
        }
        node.children.forEach(inline);
        return;
      }
      default:
        if ("children" in node) node.children.forEach(inline);
    }
  };

  // -- block: rendered-widget-when-away, source-when-editing --

  const block = (node: Node): void => {
    const span = spans.get(node);
    if (node.type === "directive" && (node.name === "page" || node.name === "section")) {
      // Layout containers stay as source; preview their contents inside.
      node.children.forEach(block);
      return;
    }
    if (node.type === "comment") {
      // A comment renders to nothing, so don't widget it - show it as dimmed
      // source (it's invisible to readers but the author is editing it).
      inline(node);
      return;
    }
    if (node.type === "directive" && node.name === "meta") {
      // `:::meta` also renders to nothing (it carries document metadata);
      // like a comment, show it as quiet dimmed source rather than an empty
      // widget that makes the line vanish.
      if (span !== undefined) out.push({ kind: "mark", from: span.start, to: span.end, class: "cm-mq-comment" });
      return;
    }
    const renderworthy =
      node.type === "list" ||
      node.type === "blockquote" ||
      node.type === "code_block" ||
      node.type === "thematic_break" ||
      node.type === "turbolink" ||
      node.type === "directive" ||
      node.type === "invalid_directive" ||
      ((node.type === "paragraph" || node.type === "heading") && containsRenderworthy(node));

    if (!renderworthy && (node.type === "paragraph" || node.type === "heading")) {
      inline(node); // a plain text block: augmented source
      return;
    }
    if (renderworthy && span !== undefined) {
      if (!touched(span)) {
        out.push({ kind: "block", from: span.start, to: span.end, node });
      }
      // when editing it, show plain source (no decoration)
    }
  };

  if (doc.type === "document") {
    doc.children.forEach(block);
  }
  return out;
}

/** A paragraph/heading needs full rendering (not just inline marks) when it
 * carries something inline styling can't fake: an embed (so images flow in a
 * real <p>) or an aside (which renders below the block). */
function containsRenderworthy(node: Node): boolean {
  let found = false;
  const walk = (n: Node): void => {
    if (found) return;
    if (n.type === "embed") {
      found = true;
      return;
    }
    if (n.type === "span" && (n.name === "sidenote" || n.name === "aside" || n.name === "footnote")) {
      found = true;
      return;
    }
    if ("children" in n) n.children.forEach(walk);
  };
  walk(node);
  return found;
}

/** The content styling for an inline span. Effects animate (their real mq-*
 * class) when the cursor is away and go static when you edit them; spoilers
 * blur; color/font/size get inline style; unknown spans get a subtle mark. */
function spanContentSpec(
  node: Node & { type: "span" },
  from: number,
  to: number,
  active: boolean,
): DecoSpec {
  const name = node.name;
  if (name === "spoiler") {
    return { kind: "mark", from, to, class: "mq-spoiler" };
  }
  if (EFFECTS.has(name)) {
    return active ? { kind: "mark", from, to, class: "cm-mq-span" } : { kind: "mark", from, to, class: `mq-${name}` };
  }
  const style = spanStyle(name, node.attrs);
  return style !== null ? { kind: "mark", from, to, style } : { kind: "mark", from, to, class: "cm-mq-span" };
}

function spanStyle(name: string, attrs: Record<string, string>): string | null {
  switch (name) {
    case "color": {
      const v = attrs["color"];
      return v !== undefined && HEX_OR_TOKEN.test(v) ? `color:${v}` : null;
    }
    case "font": {
      const v = attrs["font"];
      const face = v !== undefined ? FONTS[v] : undefined;
      return face !== undefined ? `font-family:${JSON.stringify(face)}` : null;
    }
    case "size": {
      const v = attrs["size"];
      return v !== undefined && SIZE_EM[v] !== undefined ? `font-size:${SIZE_EM[v]}` : null;
    }
    case "teeny":
    case "tiny":
    case "huge":
    case "enormous":
      return `font-size:${SIZE_EM[NAMED_SIZE[name]!]}`;
    case "small":
      return "font-size:0.82em";
    case "big":
      return "font-size:1.15em";
    case "sup":
      return "vertical-align:super;font-size:0.75em";
    case "sub":
      return "vertical-align:sub;font-size:0.75em";
    default:
      return null;
  }
}
