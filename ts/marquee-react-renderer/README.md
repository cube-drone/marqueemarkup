<img src="https://raw.githubusercontent.com/cube-drone/marqueemarkup/main/marquee-logo.png" alt="Marquee Markup" width="96" align="right">

# @cube-drone/marquee-react-renderer

The **interactive** renderer for [Marquee](https://github.com/cube-drone/marqueemarkup): a
React component that renders Marquee source (or a parsed AST) into React elements — and adds
the three things a string of HTML cannot do.

```
npm install @cube-drone/marquee-react-renderer @cube-drone/marquee-css
```

```tsx
import { Marquee } from "@cube-drone/marquee-react-renderer";
import "@cube-drone/marquee-css/marquee.css";

<Marquee source="# hello [rainbow by=letter]world[/rainbow]" />
```

That's it. Motion, effects, fonts, emoji, layout — all of it, from the same stylesheet and
the same `mq-*` class contract the static renderer targets.

## What it adds over the static renderer

The spec's animation contract has four rules; the static HTML renderer can only keep two of
them, and explicitly defers the rest to "the interactive renderer". This is that renderer.

- **Effects start when they're seen, not when the page loads.** An `IntersectionObserver`
  releases each effect the first time it scrolls into view. (A typewriter that finished
  typing three screens above you is a typewriter you never saw.)
- **The reader can always skip.** One click stills every effect and shows all text, whole —
  "animated text is a performance, never a hostage situation." Also available as
  `handle.skip()` for a toolbar button or a keystroke.
- **Scroll sync for side-by-side editors.** The component knows which DOM element every AST
  node became *and* which source offsets it came from, in both directions.

## Editor sync (the side-by-side pattern)

Give it `source` (not `doc`) and the parse carries source positions. Then:

```tsx
const view = useRef<MarqueeHandle>(null);

// editor cursor moved -> scroll the preview to it, centered
onCursorMove={(offset) => view.current?.scrollToSource(offset)}

<Marquee
  ref={view}
  source={text}
  // reader clicked the preview -> move the editor's cursor there
  onNodeClick={(node, span) => span && editor.setCursor(span.start)}
/>
```

Every rendered element also carries `data-mq-start` / `data-mq-end` (its source extent), so a
host that would rather do its own DOM work has everything it needs without touching the
handle. Offsets are **UTF-16 code units over the normalized source** — the same units
JavaScript strings and CodeMirror speak. (See `@cube-drone/marquee-parser`'s
`parseWithPositions` for the three sharp edges: spans are *source* extents, so they can be
longer than the text they cover.)

## Why CSS animations and not an animation library

Because the three features above are not animation problems — they're animation *control*
problems, and CSS animations are already controllable: `animation-play-state` for the
visibility gate, `animation: none` for skip. JavaScript decides *when the clock runs*; it
never animates anything.

The deeper reason: Marquee's effect set is a **closed vocabulary**. A renderer doesn't get to
invent effects — only the spec does. An animation library would buy expressiveness the
language doesn't permit us to spend, at the cost of a dependency, a bundle, and a second
implementation of `[wave]` that could drift from the stylesheet every other renderer shares.
So: zero runtime dependencies beyond React, and the motion is the *same motion* the static
renderer produces.

Reduced-motion is honored by the stylesheet, not by this component: under
`prefers-reduced-motion`, there is simply nothing to gate.

## Props

| prop | type | default | contract |
|---|---|---|---|
| `source` | `string` | — | Marquee source. Parsed with positions, which is what enables editor sync |
| `doc` | `Node` | — | a pre-parsed AST instead (no positions, so no source sync) |
| `profile` | `Partial<Profile>` | bare web | embedder policy — schemes, media, emoji, turbolinks, custom vocabulary. **The same socket the static renderer uses**: write your policy once, both renderers honor it |
| `hooks` | `ReactHooks` | — | React-returning versions of the `turbolink` / `directive` / `span` rendering hooks. When given, no HTML string is ever injected (see Safety) |
| `animate` | `"visible" \| "immediate" \| "never"` | `"visible"` | when effects start |
| `skipOnClick` | `boolean` | `true` | a click anywhere stills everything |
| `onNodeClick` | `(node, span, event) => void` | — | reverse sync: which node did the reader click, and where did it come from |
| `className` | `string` | — | extra classes on the root |

## The handle (`ref`)

```ts
interface MarqueeHandle {
  root: HTMLElement | null;
  elementFor(node: Node): HTMLElement | null;
  nodeAt(offset: number): Node | null;
  scrollToNode(node: Node, options?: ScrollIntoViewOptions): boolean;
  scrollToSource(offset: number, options?: ScrollIntoViewOptions): boolean;
  skip(): void;
  replay(): void;
}
```

`scrollToSource` centers by default (`block: "center"`), because the top edge of the viewport
is not where a human looks. If the innermost node at that offset has no element of its own
(inline text inside a split effect), it walks outward until it finds one that does.

## Safety

The AST is the contract: this renderer builds **React elements**, never an HTML string, so
there is no `innerHTML` path for author bytes — not even a tempting one. React escapes
everything.

The one exception is embedder-trusted hook output: `Profile.turbolink` / `.directive` /
`.span` return HTML strings (that's the static renderer's socket), so those are injected as
trusted HTML — exactly the same trust boundary as a turbolink plugin, where author bytes only
ever arrive as a target string. Pass `hooks` instead and even that path disappears.

## Preact

React is a peer dependency (`>=18`), and this package uses no React internals — so
`preact/compat` aliasing works. One package, both ecosystems.

License: MPL-2.0.
