# Marquee (Markup)

the marquee markup language: a little bit of markdown, a little bit of RST, a whole lot of dumb old internet

## Repository layout

This is a monorepo: the spec, the conformance vectors, and every reference implementation
version together, because they are one conformance unit.

- `SPEC.md` — the language specification (grammar, AST contract, conformance rules)
- `examples/` — hand-written `.mq` documents; the ergonomics testbed and vector seed corpus
- `vectors/` — published conformance vectors (`*.json`, input → exact AST); see `vectors/README.md`
- `rust/parser/` — reference parser, Rust (validation / authoring-gate side) *(planned)*
- `ts/parser/` — reference parser, TypeScript (rendering side) *(planned)*

Renderers land beside the parsers as they come (`rust/html_renderer`, `ts/html_renderer`,
`ts/preact_interactive_renderer`, ...): one parser per language, many renderers, per the
"parsers may never differ, renderers may" contract in the spec.
