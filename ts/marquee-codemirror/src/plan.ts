// The decoration planner - the Obsidian live-preview brain, as a pure
// function of (source, cursor selections) -> a list of decoration specs.
// No CodeMirror, no DOM: it is the testable core, and the CM adapter
// (marquee.ts) is a thin translation of these specs into CM decorations.
//
// The model (SPEC.md, "Source positions" is what makes it possible): the
// source never stops being plain text. Rendering is projected onto it -
// text is *styled in place* (bold text that still shows its `**`), and some
// ranges are *replaced* by rendered widgets (an image, an emoji glyph).
// The cursor rule: an element whose source the cursor is touching stays
// "open" - its syntax is shown, dimmed; move away and the syntax hides (or
// the element becomes its rendered widget). Marquee's determinism is what
// lets this be exact instead of heuristic: there is one parse, and it says
// precisely where every construct begins and ends.

import { parseWithPositions, type Node, type Span } from "@cube-drone/marquee-parser";
import { FONTS, type Profile } from "@cube-drone/marquee-html-renderer";

/** A cursor or selection, as CodeMirror offsets (UTF-16, same space as the
 * parser's spans over the normalized source). */
export interface Sel {
  from: number;
  to: number;
}

export type DecoSpec =
  /** Style raw text in place (bold, a heading size, a color). */
  | { kind: "mark"; from: number; to: number; class?: string; style?: string }
  /** Hide a range entirely - a marker the cursor isn't near. */
  | { kind: "hide"; from: number; to: number }
  /** Replace a range with a rendered widget. */
  | { kind: "widget"; from: number; to: number; widget: WidgetSpec };

export type WidgetSpec =
  | { type: "image"; target: string; alt: string }
  | { type: "emoji"; slug: string }
  | { type: "rule" };

/** <font size=1..7>-ish em scale, for the size dial in the editor. */
const SIZE_EM: Record<string, string> = {
  "1": "0.65em", "2": "0.82em", "3": "1em", "4": "1.15em",
  "5": "1.35em", "6": "1.7em", "7": "2.4em",
};
const NAMED_SIZE: Record<string, string> = { teeny: "1", tiny: "2", huge: "6", enormous: "7" };

/** Parse and plan in one step (used by tests; the CM adapter caches the
 * parse and calls planFromAst on every cursor move). */
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

  /** Emit the markers of an element: dimmed-but-visible when the cursor is
   * on the element, hidden when it isn't. This is the whole live-preview
   * gesture, in one helper. */
  const markers = (open: [number, number], close: [number, number], active: boolean): void => {
    for (const [a, b] of [open, close]) {
      if (b > a) {
        out.push(active ? { kind: "mark", from: a, to: b, class: "cm-mq-marker" } : { kind: "hide", from: a, to: b });
      }
    }
  };

  const walk = (node: Node): void => {
    const span = spans.get(node);
    switch (node.type) {
      case "heading": {
        if (span) {
          const active = touched(span);
          const prefix = node.level + 1; // the #s and their space
          markers([span.start, span.start + prefix], [span.start, span.start], active);
          out.push({ kind: "mark", from: span.start + prefix, to: span.end, class: `cm-mq-h${node.level}` });
        }
        node.children.forEach(walk);
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
        node.children.forEach(walk);
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
          const active = touched(span);
          const tail = source.indexOf("](", span.start);
          const textEnd = tail === -1 || tail >= span.end ? span.end : tail;
          out.push({ kind: "mark", from: span.start + 1, to: textEnd, class: "cm-mq-link" });
          markers([span.start, span.start + 1], [textEnd, span.end], active);
        }
        node.children.forEach(walk);
        return;
      }
      case "embed": {
        // The image itself when the cursor is away; raw source when editing.
        if (span && !touched(span) && profile.media(node.target)?.kind === "image") {
          out.push({ kind: "widget", from: span.start, to: span.end, widget: { type: "image", target: node.target, alt: node.alt } });
        }
        return;
      }
      case "emoji": {
        if (span && !touched(span) && profile.emoji(node.slug) !== null) {
          out.push({ kind: "widget", from: span.start, to: span.end, widget: { type: "emoji", slug: node.slug } });
        }
        return;
      }
      case "thematic_break": {
        if (span && !touched(span)) {
          out.push({ kind: "widget", from: span.start, to: span.end, widget: { type: "rule" } });
        }
        return;
      }
      case "comment": {
        if (span) out.push({ kind: "mark", from: span.start, to: span.end, class: "cm-mq-comment" });
        return;
      }
      case "code_block": {
        if (span) out.push({ kind: "mark", from: span.start, to: span.end, class: "cm-mq-codeblock" });
        return;
      }
      case "span": {
        if (span) {
          const active = touched(span);
          const openEnd = source.indexOf("]", span.start);
          const open: [number, number] = [span.start, openEnd === -1 ? span.start : openEnd + 1];
          const close: [number, number] = [span.end - (node.name.length + 3), span.end];
          const style = spanStyle(node.name, node.attrs);
          if (style !== null) {
            out.push({ kind: "mark", from: open[1], to: close[0], style });
          } else {
            out.push({ kind: "mark", from: open[1], to: close[0], class: "cm-mq-span" });
          }
          markers(open, close, active);
        }
        node.children.forEach(walk);
        return;
      }
      default:
        if ("children" in node) node.children.forEach(walk);
    }
  };

  walk(doc);
  return out;
}

/** The static, in-editor-friendly styling for a styled span - color, font,
 * size, sup/sub. Effects (blink, spoiler, ...) return null: we don't animate
 * or hide inside the editor, just mark the run as a span. */
function spanStyle(name: string, attrs: Record<string, string>): string | null {
  const HEX_OR_TOKEN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$|^[a-z][a-z0-9-]{0,31}$/;
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
