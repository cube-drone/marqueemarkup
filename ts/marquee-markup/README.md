# @classam/marquee-markup

Marquee, batteries included. One install, everything working:

```
npm install @classam/marquee-markup
```

```ts
import { marquee } from "@classam/marquee-markup";
import { readFileSync, writeFileSync } from "node:fs";

writeFileSync("hello.html", marquee(readFileSync("hello.mq", "utf8")));
```

That's the whole tutorial: `marquee(source)` parses, renders, styles, inlines exactly the
fonts the page wears, and hands back a complete self-contained HTML page. Or use the CLI:

```
npx marquee hello.mq > hello.html     one self-contained page
npx marquee mysite/ dist/             a whole website
```

The site form renders every `.mq` in the folder (files named `_*.mq` are shared partials for
`:::include doc=_nav:::` — nav and footer once, every page), resolves page-to-page links,
copies referenced media, and ships only the font faces the site actually uses.

More control, same package:

- `marqueeFragment(source, opts)` → `{ html, css, title }` for embedding in your own pages
- `buildSite(siteDir, outDir, opts)` → the CLI's site build as a function
- options: `{ title, fonts: "inline" | "none", plugins, profile }` — add your own turbolink
  expanders, override the embedder policy
- **everything underneath is re-exported** — `parse`, `render`, `Profile`, the plugin
  machinery, the stylesheet, the font helpers — so when you outgrow the convenience you
  don't switch packages, you just reach deeper

This package deliberately includes the ~1.3MB font grab bag; that's what batteries-included
means. If you want a leaner diet, compose the pieces yourself: `@classam/marquee-parser`,
`@classam/marquee-html-renderer`, `@classam/marquee-css`, `@classam/marquee-fonts` (optional),
`@classam/turbolink`. To learn the language itself, read
[WRITING.md](https://github.com/cube-drone/marqueemarkup/blob/main/WRITING.md).
