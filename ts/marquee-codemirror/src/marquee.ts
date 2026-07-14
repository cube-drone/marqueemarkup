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
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";
import { parseWithPositions, type Node, type Span } from "@cube-drone/marquee-parser";
import { bareWebProfile, render, type Profile } from "@cube-drone/marquee-html-renderer";
import { planFromAst, type DecoSpec, type Sel } from "./plan.ts";
import { BlockWidget, EmojiWidget } from "./widgets.ts";
import { marqueeTheme } from "./theme.ts";

export interface MarqueeEditorOptions {
  /** Embedder policy - the SAME Profile socket the renderers use: which
   * images/emoji/schemes resolve, how turbolinks expand. Bare-web default. */
  profile?: Partial<Profile>;
}

interface State {
  deco: DecorationSet;
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
  const htmlCache = new Map<string, string>();
  const renderBlock = (node: Node, spans: WeakMap<Node, Span>, source: string): string => {
    const span = spans.get(node);
    if (span === undefined) return render(node, profile);
    const key = `${span.start}:${source.slice(span.start, span.end)}`;
    let cached = htmlCache.get(key);
    if (cached === undefined) {
      cached = render(node, profile);
      if (htmlCache.size > 2000) htmlCache.clear();
      htmlCache.set(key, cached);
    }
    return cached;
  };

  const toDecorations = (specs: DecoSpec[], spans: WeakMap<Node, Span>, source: string): DecorationSet => {
    const ranges = specs.map((spec) => {
      if (spec.kind === "mark") {
        return Decoration.mark({
          ...(spec.class === undefined ? {} : { class: spec.class }),
          ...(spec.style === undefined ? {} : { attributes: { style: spec.style } }),
        }).range(spec.from, spec.to);
      }
      if (spec.kind === "hide") {
        return Decoration.replace({}).range(spec.from, spec.to);
      }
      if (spec.kind === "widget") {
        return Decoration.replace({ widget: new EmojiWidget(spec.widget.slug, profile) }).range(spec.from, spec.to);
      }
      if (spec.kind === "preview") {
        // A dimmed rendered copy just below the block you're editing.
        return Decoration.widget({
          widget: new BlockWidget(renderBlock(spec.node, spans, source), true),
          block: true,
          side: 1,
        }).range(spec.at);
      }
      return Decoration.replace({
        widget: new BlockWidget(renderBlock(spec.node, spans, source), false),
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
    return { deco: toDecorations(specs, spans, source), source, doc, spans };
  };

  /** Re-plan for a moved cursor, reusing the cached parse and renders. */
  const reselect = (prev: State, state: EditorState): State => {
    if (prev.doc === null) {
      return prev;
    }
    const specs = planFromAst(prev.doc, prev.spans, prev.source, selectionsOf(state), profile);
    return { ...prev, deco: toDecorations(specs, prev.spans, prev.source) };
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

  return [field, marqueeTheme];
}
