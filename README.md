# Marquee (Markup)

the marquee markup language: a little bit of markdown, a little bit of RST, a whole lot of dumb old internet

## Repository layout

This is a monorepo: the spec, the conformance vectors, and every reference implementation
version together, because they are one conformance unit. The implementations publish
piecemeal as public infrastructure — npm: `@classam/marquee-parser`,
`@classam/marquee-html-renderer`, `@classam/turbolink`; crates.io: `marquee-parser` — and
downstream embedders (Ringtome included) consume them through the public registries like
anybody else. The TypeScript side is an npm workspace: `npm install` once at the root,
`npm test` runs every package.

- `WRITING.md` — **start here to write Marquee**: the authoring guide, every tag with examples
  (`WRITING.mq` is its live twin — preview it to see everything running)
- `SPEC.md` — the language specification (grammar, AST contract, conformance rules)
- `examples/` — hand-written `.mq` documents; the ergonomics testbed and vector seed corpus
  (`examples/borsalino/` is a complete little website with shared nav/footer, built via
  `npm run marquee -- examples/borsalino /tmp/borsalino`)
- `vectors/` — published conformance vectors (`*.json`, input → exact AST); see `vectors/README.md`
- `rust/parser/` — reference parser, Rust (`cargo test` runs the vectors; `cargo run --bin bless` grows them)
- `rust/html_renderer/` — reference static HTML renderer, Rust: same class contract and Profile
  socket as the TypeScript renderer, its own behavioral suite and self-goldens
  (`cargo run --bin bless` re-blesses)
- `ts/parser/` — reference parser, TypeScript (`npm test` runs the same vectors; `npm run check` typechecks)
- `ts/html_renderer/` — reference static HTML renderer (fragment out, embedder policy via `Profile`;
  behavioral suite encodes the spec's renderer obligations, self-goldens catch regressions)
- `ts/turbolink/` — pluggable turbolink rendering: link expanders as plugins (YouTube, Spotify, media,
  OpenGraph-fetch-ahead), composed by the embedder into `Profile.turbolink`; each plugin declares the
  CSS for the markup it emits, and `turbolinkStyles()` collects the composed chain's skins into one artifact
- `ts/turbolink-example-plugin/` — the worked example for plugin authors, paired with the
  "Writing a plugin" guide in `ts/turbolink/README.md`
- `ts/marquee-css/` — the reference stylesheet as a package: the `mq-*` class contract renderers
  target, effects under `prefers-reduced-motion`, layouts, schemes (file + string export)
- `ts/marquee-fonts/` — the 31-face grab bag as an *optional* package: `externalFontFaces()` for
  hosted files, `inlineFontFaces()` for self-contained base64 pages; without it every font name
  degrades to its fallback stack
- `ts/marquee-markup/` — **the batteries-included omnibus and the place to start**:
  `marquee(source)` → a complete page, `buildSite(dir, out)` → a website, the `marquee` CLI,
  everything underneath re-exported
- differential fuzzer — `cargo run --release --bin diff_fuzz` (in `rust/parser/`, needs `node` on PATH):
  seeded generated documents through both parsers, identical ASTs demanded; found its first real bug
  within 40k documents

Renderers land beside the parsers as they come (`rust/html_renderer`, `ts/html_renderer`,
`ts/preact_interactive_renderer`, ...): one parser per language, many renderers, per the
"parsers may never differ, renderers may" contract in the spec.
