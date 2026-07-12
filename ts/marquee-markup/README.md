<img src="https://raw.githubusercontent.com/cube-drone/marqueemarkup/main/marquee-logo.png" alt="Marquee Markup" width="96" align="right">

# @cube-drone/marquee-markup

The [Marquee](https://github.com/cube-drone/marqueemarkup) Markup Language.

Marquee source in, complete styled HTML out, with the stylesheet, fonts, and emoji table along for the ride.

This is the package you want unless you know why you want a smaller one.

```
npm install @cube-drone/marquee-markup
```

```ts
import { marquee } from "@cube-drone/marquee-markup";
import { readFileSync, writeFileSync } from "node:fs";

writeFileSync("hello.html", marquee(readFileSync("hello.mq", "utf8")));
```

To learn the *language*, read [WRITING.md](https://github.com/cube-drone/marqueemarkup/blob/main/WRITING.md)
or see it live at [marquee.cube-drone.com](https://marquee.cube-drone.com). This document is
the contract for the *tools*.

## The CLI

```
npx marquee <file.mq>                 render one page to stdout
npx marquee <file.mq> -o out.html    ...or to a file
npx marquee <site-dir> <out-dir>      build a whole site
```

| flag | effect |
|---|---|
| `--nofetch` | skip the network fetch-ahead pass. Default is ON: bare web links become real OpenGraph preview cards, fetched once at build time. With `--nofetch`, unrecognized links stay plain links and the build touches no network |
| `--envelope` | wrap plain documents in a 650px centered column for readability. Documents whose top-level content is `:::page` directives are left alone (the author took layout control) |
| `--darkmode` | force `color-scheme: dark`. Default: pages follow the reader's OS theme |
| `--noreadable` | disable the color-readability rescue (see `readable` below). Default is ON for pages |

Every flag is a library option first; the CLI is sugar over the functions below.

## Functions

### What Happens if the Marquee is unparseable? 

I have good news for you: if you give it _text_ you are very likely to be in the clear:
this language is designed to _always_ be parseable. **any input renders: nothing throws**.

The only exception in the whole API is an unknown dialect version declaration
(`#!marquee 99`), which throws `UnsupportedVersionError` — so that old versions of Marquee
don't try to parse documents it doesn't understand yet. 

### `marquee(source, options?) => string`

* parse
* render
* inline the stylesheet 
* inline exactly the font faces the page actually uses (as base64, by default) 
* wrap in a complete `<!doctype html>` page shell. 

The returned string is self-contained (thanks to all of the inlining): you should be able to deliver it as a complete .html file.

Turbolinks (bare URLs alone in a paragraph) render through the _fetchless_ plugin chain:
which is to say, we don't go chasing after OpenGraph data to expand them. 

YouTube/Spotify links become embeds (these won't work if you don't serve the file from _somewhere_), 

image/audio/video links become the media, everything else degrades to a plain link.

### `marqueeFetch(source, options?) => Promise<string>`

In the above function we didn't fetch OpenGraph data (how could we? we were running in sync mode).
`marqueeFetch` does the same thing but it _does, in fact, go fetch that OpenGraph data!_.

`marquee()` plus the network: before rendering, runs every composed turbolink plugin's async
`resolve()` phase over the document's link targets — concurrently across targets, with the
OpenGraph plugin joining the chain automatically (10-second timeout per fetch). Gathered
summaries render as preview cards; failed or timed-out fetches degrade to plain links.

**Trust contract:** this function *executes plugin fetch code*. The default chain is safe;
if you pass your own turbolink `plugins`, you are vouching for them. Rendering itself remains synchronous and
fetchless — all network happens in the resolve phase, before render, never during.

### `marqueeFragment(source, options?) => { body, css, title, fontTokens }`

The pieces, for embedding in your own page:

- `body: string` — one `<div class="mq-doc">…</div>` fragment
- `css: string` — everything the body needs styled: the Marquee stylesheet, the composed
  plugins' skins, and font faces per the `fonts` option
- `title: string` — the `title` option, else the document's `:::meta title`, else `"Marquee"`
- `fontTokens: string[]` — which font faces the body actually wears (feed to
  `fontFilePath()` if you're hosting font files yourself)

### `marqueeBody(source, options?) => string` / `marqueeHead(source, options?) => string`

The fragment, pre-split for template stitching: `marqueeBody` returns just the body
fragment; `marqueeHead` returns `<title>…</title>\n<style>…</style>`, paste-ready for a
`<head>`.

### `buildSite(siteDir, outDir, options?) => SiteReport`

A folder of `.mq` files in, a static website out. The contract, precisely:

- **Every `<id>.mq` becomes `<id>.html`**, except files named `_*.mq`, which are *partials*:
  includable via `:::include doc=_nav:::` but not rendered as pages. Includes resolve beside
  the including file; included documents may not themselves include (cycles are therefore
  unrepresentable); a missing include renders a visible placeholder, never an error.
- **Relative doc-id links resolve to built pages**: `[Menu](menu)` becomes `href="menu.html"`.
- **Relative media is copied** into `<out>/media/` (deduplicated, name-collision-safe) and
  embeds re-point to the copies. Remote (`https:`) media is left as-is: readers fetch it.
- **Fonts ship as real files**: only the faces the site's pages actually use are copied to
  `<out>/fonts/`, with a generated `css/fonts.css` pointing at them — cacheable across pages,
  never base64.
- **Stylesheets are files**: `css/marquee.css` and `css/turbolink.css` (the composed plugin
  chain's skins), linked from every page shell.
- Page titles come from each document's `:::meta title`, falling back to the file's id.
- Returns `{ pages: string[], mediaFiles: number, fontFaces: string[], outDir: string }`.

### `buildSiteFetch(siteDir, outDir, options?) => Promise<SiteReport>`

`buildSite()` with the fetch-ahead pass: gathers turbolink targets across *all* the site's
`.mq` files (partials included), resolves them once, builds with the results. Same trust
contract as `marqueeFetch`.

## Options

`MarqueeOptions` — every field optional:

| option | type | default | contract |
|---|---|---|---|
| `title` | `string` | document's `:::meta title`, else `"Marquee"` | the page `<title>` |
| `fonts` | `"inline" \| "external" \| "none"` | `"inline"` | `inline`: used faces embedded as base64 (self-contained page). `external`: `@font-face` rules point at `<fontBase><token>.woff2` — you copy the files (`fontTokens` names them, `fontFilePath()` locates them). `none`: no faces; font names degrade to their fallback stacks |
| `fontBase` | `string` | `"fonts/"` | URL prefix for `fonts: "external"` |
| `emoji` | `Record<string, string \| { image, alt? }>` | `{}` | your emoji table, layered over the defaults; yours win on collision. String values are replacement text; `{ image, alt? }` renders a character-sized inline `<img>` (the custom-emoji mechanism — the image URL is embedder-trusted, like every hook) |
| `emojiDefaults` | `boolean` | `true` | the standard gemoji table (`:sparkles:` and ~1,900 friends) loads implicitly. `false`: unlisted shortcodes stay literal `:slug:` |
| `colorScheme` | `"light" \| "dark"` | follow the reader's OS | forces the page shell's `color-scheme`. Applies to whole pages only; fragments follow their host |
| `envelope` | `boolean` | `false` | wrap the document in a 650px centered readability column. Defers to documents that *are* a `:::page` |
| `readable` | `boolean` | `true` for pages, `false` for fragments | the color-readability rescue: author colors keep their hue but their lightness is clamped toward the canvas's opposite (via CSS relative color syntax), so dark-red text survives dark mode. Containers that paint their own background are left alone; browsers without support see raw colors. Fragments default off because a host theming by class rather than OS preference would get the clamp backwards |
| `plugins` | `TurbolinkPlugin[]` | the fetchless default set | the turbolink chain, in priority order. In fetch mode, `opengraphPlugin` is appended unless already present |
| `profile` | `Partial<Profile>` | — | override any embedder policy hook (allowed URL schemes, media resolution, emoji, directives). Wins over everything above |

`SiteOptions` (for `buildSite`/`buildSiteFetch`) accepts `emoji`, `emojiDefaults`,
`colorScheme`, `envelope`, `readable`, `plugins`, and `profile` with identical meanings,
applied per-page.

## Safety, stated plainly

- Author bytes never reach output except through escaping; targets only through the profile's
  scheme allowlist; the AST is the contract — nothing `innerHTML`-shaped exists.
- Unknown vocabulary degrades visibly (placeholders, literal text) and **never eats content**.
- The rendered page contains **zero JavaScript**. Effects are CSS, honor
  `prefers-reduced-motion`, and reveal effects cannot hide text where animations don't run.
- The only code execution surface is plugin `resolve()` in the fetch functions, and only for
  plugins you composed.

## Reaching deeper

Everything underneath is re-exported, so outgrowing the convenience never means switching
packages: `parse` and the AST types (`Node`, `Attrs`, `Reason`), `render` / `renderMarquee` /
`bareWebProfile` / `Profile` and the escapes, `marqueeCss`, `standardEmoji`, the font helpers
(`FONT_MANIFEST`, `fontFilePath`, `inlineFontFaces`, `externalFontFaces`), and the whole
turbolink toolkit (`TurbolinkPlugin`, `composeTurbolinks`, `resolveTargets`,
`turbolinkTargets`, `turbolinkStyles`, `renderCard`, `defaultPlugins`, `opengraphPlugin`).
The leaner-diet packages behind them: `@cube-drone/marquee-parser`, `-html-renderer`,
`-css`, `-fonts`, `-emoji`, `-turbolink` — same code, à la carte. This package deliberately
includes the ~1.3MB font grab bag; that's what batteries-included means.

Same version number across every package and the Rust crates = passed the same published
conformance corpus, by definition. License: MPL-2.0.
