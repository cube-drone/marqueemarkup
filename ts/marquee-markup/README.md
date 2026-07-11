# @cube-drone/marquee-markup

Marquee, batteries included. One install, everything working:

```
npm install @cube-drone/marquee-markup
```

```ts
import { marquee } from "@cube-drone/marquee-markup";
import { readFileSync, writeFileSync } from "node:fs";

writeFileSync("hello.html", marquee(readFileSync("hello.mq", "utf8")));
```

`marquee(source)` parses, renders, styles, inlines exactly the fonts the page wears, 
and hands back a complete self-contained HTML page. 

Or use the CLI:

```
npx marquee hello.mq > hello.html     one self-contained page
npx marquee mysite/ dist/             a whole website
npx marquee --nofetch hello.mq        no network: web turbolinks stay plain links
```

Batteries included, no surprises: by default the CLI runs the turbolink fetch-ahead pass, so
a bare web link unfurls into a real OpenGraph summary card. `--nofetch` skips all network for
the spartan, safer output.

The site form renders every `.mq` in the folder (files named `_*.mq` are shared partials for
`:::include doc=_nav:::` — nav and footer once, every page), resolves page-to-page links,
copies referenced media, and ships only the font faces the site actually uses.

If `marquee` is a little too all-inclusive for your tastes: 

- `marqueeFetch(source, opts)` → `marquee()` plus the network (async): runs the composed
  plugins' `resolve()` phase ahead of the render — OpenGraph summaries for bare web links,
  plus whatever gathering your own plugins declare. **This executes plugin fetch code**, even
  malicious code if you've somehow loaded a plugin you shouldn't trust — the chain is yours.
  Rendering itself stays sync and fetchless; failed fetches degrade to plain links.
- `buildSiteFetch(siteDir, outDir, opts)` → the same fetch-ahead pass over a whole site
- `marqueeBody(source, opts)` → just what goes inside `<body>`
- `marqueeHead(source, opts)` → just what goes inside `<head>` (title + one `<style>` block)
- `marqueeFragment(source, opts)` → `{ body, css, title, fontTokens }` — all the pieces
- `buildSite(siteDir, outDir, opts)` → the CLI's site build as a function
- options: `{ title, fonts: "inline" | "external" | "none", fontBase, emoji, emojiDefaults,
  envelope, plugins, profile }` — inline the fonts, reference them externally (copy the
  `fontTokens` files via `fontFilePath()`), or skip them; add turbolink expanders; override
  any embedder policy
- `envelope: true` (or `npx marquee --envelope`) wraps plain documents in a 650px centered
  envelope so unstructured text reads comfortably. Opt-in, because it could interfere with a
  host stack's own layout — and a document that *is* a `:::page` (top-level content is page
  directives) is left alone either way; merely mentioning a page demo mid-prose doesn't count
- emoji just work: `:sparkles:` and 1,900 friends resolve out of the box (the standard gemoji
  table, via `@cube-drone/marquee-emoji`). Layer your own entries on with
  `emoji: { slug: "🎩" }` or `emoji: { slug: { image, alt? } }` for custom image emoji —
  yours win on collision — or pass `emojiDefaults: false` to start from a blank table
- **everything underneath is re-exported** — `parse`, `render`, `Profile`, the plugin
  machinery, the stylesheet, the font helpers — so when you outgrow the convenience you
  don't switch packages, you just reach deeper

To learn the language itself, read [WRITING.md](https://github.com/cube-drone/marqueemarkup/blob/main/WRITING.md).
