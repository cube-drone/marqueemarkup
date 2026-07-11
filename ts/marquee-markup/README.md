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
```

The site form renders every `.mq` in the folder (files named `_*.mq` are shared partials for
`:::include doc=_nav:::` — nav and footer once, every page), resolves page-to-page links,
copies referenced media, and ships only the font faces the site actually uses.

If `marquee` is a little too all-inclusive for your tastes: 

- `marqueeBody(source, opts)` → just what goes inside `<body>`
- `marqueeHead(source, opts)` → just what goes inside `<head>` (title + one `<style>` block)
- `marqueeFragment(source, opts)` → `{ body, css, title, fontTokens }` — all the pieces
- `buildSite(siteDir, outDir, opts)` → the CLI's site build as a function
- options: `{ title, fonts: "inline" | "external" | "none", fontBase, emoji, plugins,
  profile }` — inline the fonts, reference them externally (copy the `fontTokens` files via
  `fontFilePath()`), or skip them; plug in an emoji table (values are replacement text or
  `{ image, alt? }` for custom image emoji); add turbolink expanders; override any embedder
  policy
- **everything underneath is re-exported** — `parse`, `render`, `Profile`, the plugin
  machinery, the stylesheet, the font helpers — so when you outgrow the convenience you
  don't switch packages, you just reach deeper

To learn the language itself, read [WRITING.md](https://github.com/cube-drone/marqueemarkup/blob/main/WRITING.md).
