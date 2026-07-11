# @cube-drone/marquee-emoji

The standard emoji shortcode table, made installable. The Marquee spec deliberately refuses
to own the contested 3,000-entry shortcode table — it says implementations should reference
the standard one. This package **is** that reference:

- `standardEmoji` — [gemoji](https://github.com/github/gemoji)'s slug → character data,
  repackaged verbatim (1,900+ shortcodes: `:sparkles:` → ✨, `:+1:` → 👍). Regenerated from
  upstream with `npm run fetch-standard`; the data is MIT (see `GEMOJI-LICENSE`).

`@cube-drone/marquee-markup` loads it implicitly, so shortcodes just work there. Wiring it
into a renderer profile yourself:

```ts
import { standardEmoji } from "@cube-drone/marquee-emoji";

const profile = {
  ...bareWebProfile,
  emoji: (slug) => standardEmoji[slug] ?? null,
};
```

Custom image emoji belong to the embedder's own table, layered on top — every value in this
one is a plain unicode character. Dependency-free on purpose: the table is a plain record,
usable by any embedder — or any project — without pulling in a parser or renderer.
