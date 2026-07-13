// @cube-drone/marquee-codemirror: Obsidian-style live-preview editing for
// Marquee, as a CodeMirror 6 extension.
//
//     import { EditorView } from "@codemirror/view";
//     import { marquee } from "@cube-drone/marquee-codemirror";
//
//     new EditorView({ doc: "# hello *world*", extensions: [marquee()], parent });
//
// The source stays plain text; the extension projects the rendering onto it
// as decorations and opens each element's syntax when the cursor is on it.
// Pair with @cube-drone/marquee-css if you want the grab-bag fonts to show.

export { marquee } from "./marquee.ts";
export type { MarqueeEditorOptions } from "./marquee.ts";
export { marqueeTheme } from "./theme.ts";

// The pure planner, exported for anyone building their own editor surface on
// top of the same decisions (or testing them).
export { plan, planFromAst } from "./plan.ts";
export type { DecoSpec, WidgetSpec, Sel } from "./plan.ts";

// The parser and Profile socket, re-exported: one policy object, honored by
// the editor and both renderers.
export { parse, parseWithPositions } from "@cube-drone/marquee-parser";
export type { Node, Span } from "@cube-drone/marquee-parser";
export { bareWebProfile } from "@cube-drone/marquee-html-renderer";
export type { Profile } from "@cube-drone/marquee-html-renderer";
