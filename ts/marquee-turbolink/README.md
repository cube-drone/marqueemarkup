# marquee-turbolink

Link expanders as plugins. The Marquee renderer owns the floor (a plain link, always) and the
socket (`Profile.turbolink`); this library is what embedders plug into it — an image link
unfurls into a picture, an mp3 into play controls, YouTube into a playable embed, and whatever
link kinds 2035 brings into whatever they deserve.

## The plugin contract

```ts
interface TurbolinkPlugin {
  name: string;
  match(target: string): boolean;             // cheap recognition
  resolve?(target: string): Promise<unknown>; // async; the ONLY place network is allowed
  render(target, { level, data }): string | null; // sync, pure; null = decline
}
```

Two phases on purpose: `resolve()` gathers (OpenGraph fetches live here — run
`resolveTargets()` as a fetch-ahead pass for static builds, or on mount in interactive
renderers); `render()` is synchronous and deterministic, which is all the Marquee renderer
ever calls. Nothing can fetch mid-render.

Wiring it up:

```ts
import { composeTurbolinks, defaultPlugins } from "marquee-turbolink";

const profile = {
  ...bareWebProfile,
  turbolink: composeTurbolinks([myPlatformPlugin, ...defaultPlugins]),
};
```

First plugin that matches *and* renders wins; a declined or unmatched target falls to the
renderer's plain-link floor. And whatever a plugin renders, the renderer's wrapper appends
the original link beside it — enrichment augments, never replaces, and that guarantee is
structural: plugins don't need to remember it, and can't forget it. `defaultPlugins` is entirely fetchless (YouTube and Spotify embed
URLs are derivable; media kinds are extensions); `opengraphPlugin` fetches and is exported
separately — opting into network is a deliberate act.

## Your markup, your styles — declared, not distributed

Plugins own their presentation, so they own its skin — as a `css` string field on the plugin
itself. `turbolinkStyles(plugins)` collects the skins of exactly the chain you composed
(deduplicating shared chunks, always including the standard card's baseline) into one
artifact: emit it in a `<style>` block, or write it to a bundle file at build time. Importing
a plugin imports its style; there is no per-plugin file scavenger hunt to get wrong.

```ts
const plugins = [myPlatformPlugin, ...defaultPlugins];
const profile = { ...bareWebProfile, turbolink: composeTurbolinks(plugins) };
const styles = turbolinkStyles(plugins); // one string, same list, nothing forgotten
```

(Why not inline `style=` attributes on the markup instead? Inline styles can't express
`@media (prefers-reduced-motion)`, hover, or breakpoints — and they defeat embedder theming,
since inline beats every stylesheet rule. Classes + collected CSS keep plugins themeable and
motion-respectful.)

## Safety

Plugins are embedder-trusted code, exactly like `Profile.directive`. Author bytes only ever
enter as the `target` string: escape everything you interpolate (`escapeText` / `escapeAttr`
are exported for exactly that), and `renderCard` handles it for you on the common path.

Tests are this package's own (`npm test`) — renderer goldens never depend on plugin behavior.

## Writing a plugin

The complete worked example lives in
[`ts/marquee-turbolink-example-plugin`](../turbolink-example-plugin/): a plugin that recognizes
`https://marquee.click/...` links, performs a ritual HTTP request in its resolve phase and
throws the answer away, then renders the link's path in `<strong>`. It does almost nothing —
correctly — so every part of the contract is legible. The walkthrough:

**1. `match()` is cheap recognition.** It runs against every turbolink target in a document,
so keep it to a prefix or regex test — no parsing, no allocation drama, definitely no I/O:

```ts
match: (target) => target.startsWith("https://marquee.click/"),
```

**2. `css` is your skin, declared on the plugin.** The example mints one class, so it
declares one rule — collected by `turbolinkStyles()` along with every other composed plugin's,
so it travels wherever the plugin goes. Namespace classes to your plugin (`marquee-click-*`);
the `mq-*` prefix belongs to Marquee's own vocabulary.

```ts
css: `.marquee-click-path { color: rebeccapurple; font-size: 1.5em; }`,
```

**3. `resolve()` is where network lives — and nowhere else.** It's async, it may fetch, and
it runs *ahead of rendering* (a fetch-ahead pass over `turbolinkTargets(doc)` for static
builds; on mount for interactive renderers). Whatever it returns arrives in `render()` as
`ctx.data`. Return `null` to say "nothing gathered." If your plugin needs no network — most
don't — omit `resolve` entirely.

```ts
async resolve(target) {
  await fetch("https://example.org/"); // the example discards this, honestly
  return { ritualComplete: true };
},
```

**4. `render()` is sync, pure, and deterministic.** Given the same target, level, and data,
it returns the same string forever — no clocks, no randomness, no fetching. Two pieces of
etiquette:

- **Decline with `null`** when you have nothing appropriate — the chain continues and the
  renderer's plain-link floor catches everything. The default plugins all decline below
  `level=full`; a player is not a "title."
- **Escape everything you interpolate.** The target (and anything derived from it) is author
  bytes. Use the exported `escapeText`/`escapeAttr`, or hand your facts to `renderCard` and
  let the standard card do it.

```ts
render(target, { level }) {
  if (level !== "full") return null;
  const path = target.slice("https://marquee.click".length).split(/[?#]/, 1)[0]!;
  return `<strong class="marquee-click-path">${escapeText(path)}</strong>`;
},
```

**5. Test the pure parts.** `match()` and `render()` need no network by construction, so a
plugin's test suite is fetchless: recognition, escaping (feed it a `<b>` in the path),
decline behavior, and a `composeTurbolinks([yours, ...defaultPlugins])` integration check.
See the example's `test/plugin.test.ts`.

Then hand it to the chain, ahead of anything it should outrank:

```ts
turbolink: composeTurbolinks([marqueeClickPlugin, ...defaultPlugins]);
```
