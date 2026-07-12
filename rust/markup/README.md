# cube-drone-marquee-markup

[Marquee](https://github.com/cube-drone/marqueemarkup), batteries included — the Rust
spelling of the npm omnibus `@cube-drone/marquee-markup`:

```rust
use marquee_markup::{marquee, MarqueeOptions};

let page = marquee("# hello *world*\n", &MarqueeOptions::default())?;
```

One motion: parse, render, style, inline exactly the fonts the page wears, wrap in a page
shell. **The stylesheet, the 31-face font grab bag, and the standard emoji table are
embedded** — no npm, no asset scavenger hunt; lockstep tests pin the embedded copies to the
npm packages byte-for-byte, and lockstep versioning means same number = same artifacts.

Also in the box, mirroring the npm omnibus:

- `marquee_fetch()` — plus the network: the turbolink fetch-ahead pass (OpenGraph summaries
  for bare web links; executes plugin fetch code, so trust your chain)
- `marquee_fragment()` / `marquee_body()` / `marquee_head()` — the pieces, for embedders
- `build_site()` / `build_site_fetch()` — a folder of `.mq` in, a website out (shared
  `_nav.mq` includes, doc-id links, media copying, per-site font subsetting)
- the `marquee` CLI (`cargo install cube-drone-marquee-markup`), flag-for-flag with npm's:
  `--nofetch`, `--envelope`, `--darkmode`, `--noreadable`
- options for everything: forced color scheme, the readability color-rescue (on by default
  for pages), custom emoji tables, your own turbolink plugin chain (`TurbolinkPlugin` trait)
- everything underneath re-exported: `parse`, `render`, `Profile`, the escapes, the tables

Code says `use marquee_markup::` — the registry name wears the cube-drone prefix because
crates.io has no scopes, and the one namespace we feel polite mucking up is our own. To learn
the language, read
[WRITING.md](https://github.com/cube-drone/marqueemarkup/blob/main/WRITING.md).
