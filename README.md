# Marquee (Markup)

the marquee markup language: a little bit of markdown, a little bit of RST, a whole lot of dumb old internet

## Repository layout

This is a monorepo: the spec, the conformance vectors, and every reference implementation
version together, because they are one conformance unit.

- `WRITING.md` — **start here to write Marquee**: the authoring guide, every tag with examples
- `SPEC.md` — the language specification (grammar, AST contract, conformance rules)
- `examples/` — hand-written `.mq` documents; the ergonomics testbed and vector seed corpus
- `vectors/` — published conformance vectors (`*.json`, input → exact AST); see `vectors/README.md`
- `rust/parser/` — reference parser, Rust (`cargo test` runs the vectors; `cargo run --bin bless` grows them)
- `ts/parser/` — reference parser, TypeScript (`npm test` runs the same vectors; `npm run check` typechecks)
- `ts/html_renderer/` — reference static HTML renderer (fragment out, embedder policy via `Profile`;
  behavioral suite encodes the spec's renderer obligations, self-goldens catch regressions)
- `css/marquee.css` — the reference stylesheet: the `mq-*` class contract renderers target, effects
  under `prefers-reduced-motion`, layouts, schemes
- differential fuzzer — `cargo run --release --bin diff_fuzz` (in `rust/parser/`, needs `node` on PATH):
  seeded generated documents through both parsers, identical ASTs demanded; found its first real bug
  within 40k documents

Renderers land beside the parsers as they come (`rust/html_renderer`, `ts/html_renderer`,
`ts/preact_interactive_renderer`, ...): one parser per language, many renderers, per the
"parsers may never differ, renderers may" contract in the spec.
