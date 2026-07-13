<img src="https://raw.githubusercontent.com/cube-drone/marqueemarkup/main/marquee-logo.png" alt="Marquee Markup" width="96" align="right">

# @cube-drone/marquee-codemirror

A [CodeMirror 6](https://codemirror.net/) extension for editing
[Marquee](https://github.com/cube-drone/marqueemarkup): **Obsidian-style live preview** — the
halfway point between a WYSIWYG editor and a dual source/preview pane.

```
npm install @cube-drone/marquee-codemirror @codemirror/state @codemirror/view
```

```ts
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { marquee } from "@cube-drone/marquee-codemirror";

new EditorView({
  parent: document.body,
  state: EditorState.create({
    doc: "# hello *world*",
    extensions: [marquee()],
  }),
});
```

## How it works

The document never stops being **plain Marquee source** — there is no rich-text model, no
contenteditable, nothing to fall out of sync. Rendering is *projected onto* the source as
CodeMirror decorations:

- Inline formatting is **styled in place**: `**bold**` is drawn bold while its `**` stays
  visible (and dimmed). Headings get their size, colored spans get their color, links get
  their underline.
- The element **under the cursor shows its syntax**; move the cursor away and the syntax
  hides. So a line you're editing shows `## A Title`, and a line you're not shows a clean
  bold title. Arrow toward it and the syntax reveals as you approach.
- A few things become **rendered widgets** when the cursor is away — an image shows the
  picture, `:sparkles:` shows ✨, `---` shows a rule. Click the widget (or arrow into it) to
  edit its source.

This is exact rather than heuristic, because Marquee has exactly one parse: the extension
drives every decision from the real parser's AST and source positions
(`parseWithPositions`), not from a guess about whether a given `*` is an opener. The whole
policy is a **pure function** — `plan(source, cursors, profile) → decoration specs` — exported
for testing or for building your own editor surface on the same decisions.

## Options

```ts
marquee({ profile })
```

`profile` is `Partial<Profile>` — the **same embedder-policy socket** the renderers use. It
decides which images resolve into widgets, which emoji resolve into glyphs, which URL schemes
are allowed. Write your policy once; the editor and both renderers honor it. Defaults to the
bare-web profile.

Pair with `@cube-drone/marquee-css` if you want `[font=…]` spans to show their actual faces;
the editor's own look (marker dimming, heading sizes, widget styling) ships inside the
extension as a theme.

## What's in v1

Inline: headings, emphasis/strong/strikethrough, code spans, links, colored/font/size/`sup`/
`sub` spans (styled), other spans (bracket-hidden), comments (dimmed). Widgets: images,
resolved emoji, thematic breaks. Directives (`:::section`, tables, turbolinks) render as
source for now — seeing that structure while editing is arguably correct, and richer block
widgets are the natural next step.

## The demo

```
npm run demo                                       # in this package
npx serve ts/marquee-codemirror/demo/dist          # from the repo root
```

Loads `WRITING.mq` — the language's own tour — in a live-preview editor. Type in it.

License: MPL-2.0.
