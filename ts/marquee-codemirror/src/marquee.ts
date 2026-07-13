// The CodeMirror 6 extension. A ViewPlugin re-plans the decorations when the
// document or the selection changes, then translates the planner's specs
// into CM decorations. The parse is cached across pure cursor moves (the
// planner is cheap; the parse is the cost), so scrubbing the cursor around
// doesn't re-parse the whole document each keystroke.

import { type Extension, RangeSet } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { parseWithPositions, type Node, type Span } from "@cube-drone/marquee-parser";
import { bareWebProfile, type Profile } from "@cube-drone/marquee-html-renderer";
import { planFromAst, type DecoSpec, type Sel } from "./plan.ts";
import { makeWidget } from "./widgets.ts";
import { marqueeTheme } from "./theme.ts";

export interface MarqueeEditorOptions {
  /** Embedder policy - the SAME Profile socket the renderers use. Decides
   * which images resolve into widgets, which emoji resolve, which schemes
   * are allowed. Defaults to the bare-web profile. */
  profile?: Partial<Profile>;
}

function specsToDecorations(specs: DecoSpec[], profile: Profile): DecorationSet {
  const ranges = specs.map((spec) => {
    if (spec.kind === "mark") {
      const attributes = spec.style === undefined ? undefined : { style: spec.style };
      return Decoration.mark({
        ...(spec.class === undefined ? {} : { class: spec.class }),
        ...(attributes === undefined ? {} : { attributes }),
      }).range(spec.from, spec.to);
    }
    if (spec.kind === "hide") {
      return Decoration.replace({}).range(spec.from, spec.to);
    }
    return Decoration.replace({ widget: makeWidget(spec.widget, spec.from, profile) }).range(spec.from, spec.to);
  });
  // Decoration.set with sort=true handles the strict ordering CM requires.
  return Decoration.set(ranges, true);
}

function selections(view: EditorView): Sel[] {
  return view.state.selection.ranges.map((r) => ({ from: Math.min(r.from, r.to), to: Math.max(r.from, r.to) }));
}

/** The Marquee live-preview extension. Add it to a CodeMirror editor whose
 * document is Marquee source. */
export function marquee(options: MarqueeEditorOptions = {}): Extension {
  const profile: Profile = { ...bareWebProfile, ...options.profile };

  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      // Cached parse, reused across selection-only updates.
      private source = "";
      private doc: Node | null = null;
      private spans: WeakMap<Node, Span> = new WeakMap();

      constructor(view: EditorView) {
        this.reparse(view);
        this.decorations = this.replan(view);
      }

      update(u: ViewUpdate): void {
        if (u.docChanged) {
          this.reparse(u.view);
        }
        if (u.docChanged || u.selectionSet || u.viewportChanged) {
          this.decorations = this.replan(u.view);
        }
      }

      private reparse(view: EditorView): void {
        this.source = view.state.doc.toString();
        try {
          const { doc, spans } = parseWithPositions(this.source);
          this.doc = doc;
          this.spans = spans;
        } catch {
          // An unknown dialect version is the one thing the parser refuses;
          // in an editor, refuse gracefully - no decorations, just plain
          // source, which is exactly what the author needs to fix it.
          this.doc = null;
        }
      }

      private replan(view: EditorView): DecorationSet {
        if (this.doc === null) {
          return RangeSet.empty;
        }
        const specs = planFromAst(this.doc, this.spans, this.source, selections(view), profile);
        return specsToDecorations(specs, profile);
      }
    },
    {
      decorations: (v) => v.decorations,
      // No atomicRanges on purpose: arrowing toward a hidden marker or a
      // widget moves the cursor into the element's source range, which the
      // planner sees (`touched`) and re-opens on the next update - so the
      // syntax reveals as you approach it, and widgets reveal their source.
      // Mouse gets the same via each widget's click-to-edit handler.
    },
  );

  return [plugin, marqueeTheme];
}
