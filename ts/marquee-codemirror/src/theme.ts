// The editor's own look: how styled marks and widgets appear inside the
// text surface. This is NOT marquee.css - that stylesheet is for RENDERED
// documents; here we're styling live source, so headings stay inline-sized
// (a giant H1 would wreck line editing), markers dim rather than vanish,
// and widgets sit on the baseline. Load marquee.css too if you want fonts.

import { EditorView } from "@codemirror/view";

export const marqueeTheme = EditorView.theme({
  // The caret shows in both themes. Without CM's drawSelection the NATIVE
  // caret is used (caret-color); style both it and CM's drawn cursor so it's
  // visible either way - a black caret on a dark background is invisible.
  "& .cm-content": { caretColor: "#3b82f6" },
  "& .cm-cursor, & .cm-dropCursor": { borderLeftColor: "#3b82f6", borderLeftWidth: "2px" },
  "& .cm-mq-marker": { opacity: "0.35" },
  "& .cm-mq-strong": { fontWeight: "bold" },
  "& .cm-mq-em": { fontStyle: "italic" },
  "& .cm-mq-strike": { textDecoration: "line-through" },
  "& .cm-mq-code": {
    fontFamily: "ui-monospace, monospace",
    background: "rgba(127,127,127,0.15)",
    borderRadius: "0.2em",
    padding: "0 0.2em",
  },
  "& .cm-mq-codeblock": {
    fontFamily: "ui-monospace, monospace",
    background: "rgba(127,127,127,0.1)",
  },
  "& .cm-mq-link": { color: "#3b82f6", textDecoration: "underline" },
  "& .cm-mq-comment": { opacity: "0.5", fontStyle: "italic" },
  "& .cm-mq-span": { borderBottom: "1px dotted rgba(127,127,127,0.5)" },
  // Headings: bold + a restrained bump (editing, not display).
  "& .cm-mq-h1": { fontSize: "1.7em", fontWeight: "bold" },
  "& .cm-mq-h2": { fontSize: "1.5em", fontWeight: "bold" },
  "& .cm-mq-h3": { fontSize: "1.3em", fontWeight: "bold" },
  "& .cm-mq-h4": { fontSize: "1.15em", fontWeight: "bold" },
  "& .cm-mq-h5": { fontSize: "1.05em", fontWeight: "bold" },
  "& .cm-mq-h6": { fontWeight: "bold" },
  "& .cm-mq-h7": { fontWeight: "bold", opacity: "0.85" },
  "& .cm-mq-h8": { fontWeight: "bold", opacity: "0.7" },
  // Widgets.
  "& .cm-mq-image": { maxWidth: "min(100%, 20rem)", maxHeight: "12rem", verticalAlign: "middle", borderRadius: "0.25rem" },
  "& .cm-mq-emoji": { height: "1.2em", width: "auto", verticalAlign: "-0.2em" },
  "& .cm-mq-placeholder": { opacity: "0.6", fontStyle: "italic" },
  "& .cm-mq-rule": {
    display: "inline-block",
    width: "100%",
    borderTop: "2px solid rgba(127,127,127,0.4)",
    verticalAlign: "middle",
  },
  // A rendered block sits in the text flow. PADDING, never margin: CodeMirror
  // measures a widget's offsetHeight (which excludes margin), so a margin
  // would drift every position below it by ~a line - breaking click accuracy
  // and vertical cursor motion. Padding is inside offsetHeight, so it's safe.
  "& .cm-mq-block": { padding: "0.2em 0", cursor: "text" },
  "& .cm-mq-block img, & .cm-mq-block video, & .cm-mq-block iframe": { maxWidth: "100%" },
  // The rendered preview held below the block you're editing: dimmed, and
  // set off with a left rule so it reads as "the result", not more source.
  "& .cm-mq-preview": {
    opacity: "0.55",
    borderLeft: "2px solid rgba(127,127,127,0.35)",
    paddingLeft: "0.6em",
    marginLeft: "-0.1em",
  },
});
