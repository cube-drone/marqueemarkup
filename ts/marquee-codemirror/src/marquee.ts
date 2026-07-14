// The CodeMirror 6 extension. Decorations come from a StateField (not a
// ViewPlugin) because block-level widgets - a whole rendered list, a code
// block - are only allowed from the state, not from plugins. The field
// value carries its own parse and per-block render caches, so scrubbing the
// cursor around re-plans (cheap) without re-parsing or re-rendering.

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
  html: WeakMap<Node, string>;
}

function selectionsOf(state: EditorState): Sel[] {
  return state.selection.ranges.map((r) => ({ from: Math.min(r.from, r.to), to: Math.max(r.from, r.to) }));
}

export function marquee(options: MarqueeEditorOptions = {}): Extension {
  const profile: Profile = { ...bareWebProfile, ...options.profile };

  const renderBlock = (node: Node, html: WeakMap<Node, string>): string => {
    let cached = html.get(node);
    if (cached === undefined) {
      cached = render(node, profile);
      html.set(node, cached);
    }
    return cached;
  };

  const toDecorations = (specs: DecoSpec[], html: WeakMap<Node, string>): DecorationSet => {
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
        return Decoration.replace({ widget: new EmojiWidget(spec.from, spec.widget.slug, profile) }).range(spec.from, spec.to);
      }
      return Decoration.replace({
        widget: new BlockWidget(spec.from, spec.node, renderBlock(spec.node, html)),
        block: true,
      }).range(spec.from, spec.to);
    });
    return Decoration.set(ranges, true);
  };

  /** Parse afresh (a new document) and plan. */
  const fromDoc = (state: EditorState): State => {
    const source = state.doc.toString();
    const html = new WeakMap<Node, string>();
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
    return { deco: toDecorations(specs, html), source, doc, spans, html };
  };

  /** Re-plan for a moved cursor, reusing the cached parse and renders. */
  const reselect = (prev: State, state: EditorState): State => {
    if (prev.doc === null) {
      return prev;
    }
    const specs = planFromAst(prev.doc, prev.spans, prev.source, selectionsOf(state), profile);
    return { ...prev, deco: toDecorations(specs, prev.html) };
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
