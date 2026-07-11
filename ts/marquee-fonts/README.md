# @classam/marquee-fonts

The grab bag: the curated faces behind Marquee's closed `font` name list — 31 WOFF2s (latin
subsets), each with its license text beside it. The OFL permits exactly this redistribution
and requires the license ride along; thirty faces are SIL OFL, and the one exception is
`special-elite` (Astigmatic), which is **Apache 2.0** (`special-elite.LICENSE.txt`).

**This package is optional.** The renderer works fully without it: every font name degrades
to its fallback stack in `@classam/marquee-css`, readable always. Install it when you want
the actual faces.

**Self-hosted on principle:** an embedder serves these files itself. Linking a third-party
font CDN leaks every reader's IP per page view — fonts are a tracking vector, and care-modes
apply to them like any other fetch.

Two deliveries, both fed by the renderer's `usedFontTokens(html)` scan so you ship exactly
what your pages wear:

```ts
import { usedFontTokens } from "@classam/marquee-html-renderer";
import { externalFontFaces, fontFilePath, inlineFontFaces } from "@classam/marquee-fonts";

const tokens = usedFontTokens(body);

// a real site: copy fontFilePath(t) for each token next to your pages, then
const fontsCss = externalFontFaces(tokens, "fonts/");

// a self-contained single file: the bytes come along as base64
const styles = inlineFontFaces(tokens);
```

`fonts.css` at the package root declares *all* faces (urls relative to the package — serve
its `fonts/` beside it) for the lazy path; browsers only fetch faces that rendered text
actually uses, so even that costs readers nothing for unused names.

The vocabulary itself (token → face) lives with the renderer; this package's manifest is
held in lockstep by its tests. `npm run fetch-fonts` (re)downloads faces and licenses from
Google Fonts and regenerates `fonts.css` — the only thing that ever talks to a font CDN, so
readers never do. Faces are display faces, latin subsets only — not body-text workhorses.
