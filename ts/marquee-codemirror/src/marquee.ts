// The CodeMirror 6 extension. Decorations come from a StateField (not a
// ViewPlugin) because block-level widgets - a whole rendered list, a code
// block - are only allowed from the state, not from plugins.
//
// The flail-killer: rendered HTML is cached by the block's SOURCE TEXT, not
// by AST-node identity. Every keystroke re-parses, minting fresh nodes, so a
// node-keyed cache would miss on every block and re-render (and re-load every
// image, and re-measure every height) the whole document each keystroke -
// which is exactly the "page flails around between keystrokes" symptom. Keyed
// by source text, an unedited block hits the cache, and because BlockWidget's
// `eq` compares HTML, CodeMirror keeps its existing DOM: no re-render, no
// image reload, no height change. Only the block you're actually editing moves.

import { StateField, type EditorState, type Extension } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, layer, type LayerMarker } from "@codemirror/view";
import { parseWithPositions, type Node, type Span } from "@cube-drone/marquee-parser";
import { bareWebProfile, render, type Profile } from "@cube-drone/marquee-html-renderer";
import { planFromAst, type DecoSpec, type Sel } from "./plan.ts";
import { BlockWidget, EmojiWidget, FrameMarker, LinkWidget } from "./widgets.ts";
import { marqueeTheme } from "./theme.ts";

export interface MarqueeEditorOptions {
  /** Embedder policy - the SAME Profile socket the renderers use: which
   * images/emoji/schemes resolve, how turbolinks expand. Bare-web default. */
  profile?: Partial<Profile>;
}

type Zone = Extract<DecoSpec, { kind: "zone" }>;

/** A window's opening fence sits in its title bar rather than clearing it. */
const TITLED = /\bmq-scheme-windows(-xp)?\b/;

interface State {
  deco: DecorationSet;
  zones: Zone[];
  source: string;
  doc: Node | null;
  spans: WeakMap<Node, Span>;
}

function selectionsOf(state: EditorState): Sel[] {
  return state.selection.ranges.map((r) => ({ from: Math.min(r.from, r.to), to: Math.max(r.from, r.to) }));
}

export function marquee(options: MarqueeEditorOptions = {}): Extension {
  const profile: Profile = { ...bareWebProfile, ...options.profile };

  // Persistent across parses, keyed by a block's source text. Bounded so a
  // long editing session (each keystroke on a block mints a new key) can't
  // grow it without limit; clearing just costs a one-frame re-render.
  // The text is the whole key - never the block's offset: typing above a
  // block moves its offset without changing a byte of it, and an offset in
  // the key turned every keystroke into a re-render of every block below the
  // caret. Position can't change the output: each block renders on its own
  // (render() starts fresh state - its own aside numbering - every call), so
  // the same text renders the same HTML anywhere. The node type rides along
  // only as a guard.
  const htmlCache = new Map<string, string>();
  const renderBlock = (node: Node, spans: WeakMap<Node, Span>, source: string): string => {
    const span = spans.get(node);
    if (span === undefined) return render(node, profile);
    const key = `${node.type}:${source.slice(span.start, span.end)}`;
    let cached = htmlCache.get(key);
    if (cached === undefined) {
      cached = render(node, profile);
      if (htmlCache.size > 2000) htmlCache.clear();
      htmlCache.set(key, cached);
    }
    return cached;
  };

  const zonesOf = (specs: DecoSpec[]): Zone[] => specs.filter((s): s is Zone => s.kind === "zone");

  const toDecorations = (specs: DecoSpec[], spans: WeakMap<Node, Span>, source: string): DecorationSet => {
    const ranges = specs.flatMap((spec) => {
      if (spec.kind === "zone") {
        // One line decoration per line of the container: the scheme class
        // sets the --mq-* slots (marquee.css) and the style knobs set them
        // inline; the cm-mq-zone rule in the theme consumes them. The frame
        // itself is drawn once, behind them (the frames layer below). Directive
        // fences sit at column 0, so spec.from is already a line start.
        // A line belongs to the innermost zone holding it, which already
        // carries everything inherited from the zones around it.
        const line = (edge: string) =>
          Decoration.line({
            attributes: {
              class: `cm-mq-zone${edge}${spec.look.class === "" ? "" : ` ${spec.look.class}`}`,
              style: `${spec.look.style === "" ? "" : `${spec.look.style};`}--cm-mq-depth:${spec.depth}`,
            },
          });
        const nested = zonesOf(specs).filter((z) => z.depth > spec.depth && z.from >= spec.from && z.to <= spec.to);
        const open = TITLED.test(spec.class ?? "") ? " cm-mq-zone-titled" : " cm-mq-zone-open";
        const lines = [];
        const last = source.lastIndexOf("\n", spec.to - 1) + 1;
        for (let pos = spec.from; pos <= spec.to; ) {
          if (!nested.some((z) => pos >= z.from && pos <= z.to)) {
            const edge = (pos === spec.from ? open : "") + (pos === last ? " cm-mq-zone-close" : "");
            lines.push(line(edge).range(pos));
          }
          const nl = source.indexOf("\n", pos);
          if (nl === -1) break;
          pos = nl + 1;
        }
        return lines;
      }
      if (spec.kind === "mark") {
        // CodeMirror throws on an empty mark, and a throw here wedges the
        // editor: the keystroke lands in the DOM but never in the state.
        if (spec.to <= spec.from) return [];
        const attributes = { ...spec.attrs, ...(spec.style === undefined ? {} : { style: spec.style }) };
        return Decoration.mark({
          ...(spec.class === undefined ? {} : { class: spec.class }),
          ...(Object.keys(attributes).length === 0 ? {} : { attributes }),
        }).range(spec.from, spec.to);
      }
      if (spec.kind === "hide") {
        return Decoration.replace({}).range(spec.from, spec.to);
      }
      if (spec.kind === "widget") {
        const widget =
          spec.widget.type === "link" || spec.widget.type === "span"
            ? new LinkWidget(render(spec.widget.node, profile))
            : new EmojiWidget(spec.widget.slug, profile);
        return Decoration.replace({ widget }).range(spec.from, spec.to);
      }
      if (spec.kind === "preview") {
        // A dimmed rendered copy just below the media block you're editing.
        return Decoration.widget({
          widget: new BlockWidget(renderBlock(spec.node, spans, source), true, spec.look),
          block: true,
          side: 1,
        }).range(spec.at);
      }
      return Decoration.replace({
        widget: new BlockWidget(renderBlock(spec.node, spans, source), false, spec.look),
        block: true,
      }).range(spec.from, spec.to);
    });
    return Decoration.set(ranges, true);
  };

  /** Parse afresh (a new document) and plan. */
  const fromDoc = (state: EditorState): State => {
    const source = state.doc.toString();
    let doc: Node | null;
    let spans: WeakMap<Node, Span> = new WeakMap();
    try {
      const parsed = parseWithPositions(source);
      doc = parsed.doc;
      spans = parsed.spans;
    } catch {
      // Unknown dialect version: the one parser refusal. Refuse gracefully -
      // plain source, so the author can see and fix the offending line.
      doc = null;
    }
    const specs = doc === null ? [] : planFromAst(doc, spans, source, selectionsOf(state), profile);
    return { deco: toDecorations(specs, spans, source), zones: zonesOf(specs), source, doc, spans };
  };

  /** Re-plan for a moved cursor, reusing the cached parse and renders. */
  const reselect = (prev: State, state: EditorState): State => {
    if (prev.doc === null) {
      return prev;
    }
    const specs = planFromAst(prev.doc, prev.spans, prev.source, selectionsOf(state), profile);
    return { ...prev, deco: toDecorations(specs, prev.spans, prev.source), zones: zonesOf(specs) };
  };

  const field = StateField.define<State>({
    create: (state) => fromDoc(state),
    update(value, tr) {
      if (tr.docChanged) {
        return fromDoc(tr.state);
      }
      if (tr.selection) {
        return reselect(value, tr.state);
      }
      return value;
    },
    provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
  });

  // Each painted container's one frame, behind the text. Measured from the
  // height map rather than the DOM, so a frame reaching past the viewport still
  // gets its true box, and only frames touching the viewport are drawn. Zones
  // come outer-first, so nested frames stack the right way up.
  const frames = layer({
    above: false,
    class: "cm-mq-frames",
    update: (u) =>
      u.docChanged || u.geometryChanged || u.viewportChanged || u.startState.field(field) !== u.state.field(field),
    markers(view): LayerMarker[] {
      const frameLayer = view.scrollDOM.querySelector(":scope > .cm-mq-frames");
      if (frameLayer === null) return [];
      const base = frameLayer.getBoundingClientRect();
      const content = view.contentDOM.getBoundingClientRect();
      const { from: vFrom, to: vTo } = view.viewport;
      const inset = "1.25rem";
      return view.state
        .field(field)
        .zones.filter((z) => z.to >= vFrom && z.from <= vTo)
        .map((z) => {
          const first = view.lineBlockAt(z.from);
          const top = (view.documentTop + first.top - base.top) / view.scaleY;
          const height = view.lineBlockAt(z.to).bottom - first.top;
          const left = (content.left - base.left) / view.scaleX;
          const width = content.width / view.scaleX;
          const css = [
            z.look.style === "" ? undefined : z.look.style,
            `--cm-mq-fence-h:${first.height}px`,
            "position:absolute",
            "box-sizing:border-box",
            "margin:0",
            "max-width:none",
            `left:calc(${left}px + ${z.depth - 1} * ${inset})`,
            `top:${top}px`,
            `width:calc(${width}px - ${2 * (z.depth - 1)} * ${inset})`,
            `height:${height}px`,
          ];
          return new FrameMarker(z.class ?? "", css.filter((c) => c !== undefined).join(";"));
        });
    },
  });

  return [field, frames, marqueeTheme];
}
