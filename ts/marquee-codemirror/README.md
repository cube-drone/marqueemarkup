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

- **Inline formatting** inside a plain paragraph is *styled in place*: `**bold**` is drawn
  bold while its `**` stays visible (and dimmed) under the cursor, then hides when the cursor
  leaves. Effects animate (their real `mq-*` classes) when you're not editing them, spoilers
  blur, colored spans take their color, `:sparkles:` shows ✨.
- **Every block the cursor isn't in becomes fully rendered** — by the actual Marquee HTML
  renderer. A list looks like a list, a code block like code, a table like a table; images
  flow full-size, `:::media` rows lay out, quotes get their spine, asides drop below their
  paragraph, turbolinks expand, spoilers hide, unknown widgets show their placeholder. Move
  the cursor into a block and it opens to source; click a rendered block (off any link) to
  put the cursor there.
- **Layout containers** (`:::page`, `:::section`) stay as source with their contents previewed
  inside — accurately previewing a page layout is the job of a separate window, not the inline
  editor.

Two things make this work. **Exactness:** Marquee has one parse, so every decision comes from
the real AST and source positions (`parseWithPositions`), never a guess about whether a `*` is
an opener. **Leverage:** rendered blocks *are* the HTML renderer's output — the editor doesn't
reimplement lists or tables, it calls `render(node, profile)` and shows the result, so the
preview and the page can't disagree. The decision layer is a **pure function** —
`plan(source, cursors, profile) → decoration specs` — exported for testing or for building your
own surface on the same policy.

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

## The demo

```
npm run demo                                       # in this package
npx serve ts/marquee-codemirror/demo/dist          # from the repo root
```

Loads `WRITING.mq` — the language's own tour — in a live-preview editor. Type in it.

License: MPL-2.0.
