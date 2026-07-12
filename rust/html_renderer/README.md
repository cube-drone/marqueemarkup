# cube-drone-marquee-html-renderer

The reference Rust static HTML renderer for
[Marquee](https://github.com/cube-drone/marqueemarkup).

```rust
use marquee_html_renderer::{render_marquee, BareWebProfile};

let html = render_marquee("# hello [rainbow]world[/rainbow]\n", &BareWebProfile)?;
// -> one <div class="mq-doc"> fragment, ready to place in a page
```

- Emits an HTML **fragment** styled by the shared `mq-*` class contract (`marquee.css`, from
  `cube-drone-marquee-markup` or npm's `@cube-drone/marquee-css`). Best-effort CSS motion;
  effects honor `prefers-reduced-motion`.
- **The embedder defines policy** via the `Profile` trait: which URL schemes resolve, how
  media targets map, emoji tables, turbolink enrichment. Defaults are the bare-web profile —
  https links, extension-sniffed media, everything else degrading politely.
- Safety as architecture: author bytes reach output only through escaping, targets only
  through the profile's allowlist, unknown vocabulary shrugs visibly, and content is never
  eaten - the renderer obligations come from the spec, not from vibes.
- Renderers may differ in fanciness; parsers may never differ in structure. This crate keeps
  its own behavioral suite and self-goldens against the same corpus as the TypeScript
  renderer.

Most consumers want `cube-drone-marquee-markup` instead — this crate plus the stylesheet,
fonts, emoji table, turbolinks, and the `marquee` CLI, batteries included. The spec and
conformance vectors (CC0) live in [the repo](https://github.com/cube-drone/marqueemarkup).
