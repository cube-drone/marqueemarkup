# cube-drone-marquee-parser

The reference Rust parser for [Marquee](https://github.com/cube-drone/marqueemarkup) — a
markup language that's a little bit of markdown, a little bit of RST, and a whole lot of dumb
old internet.

```rust
use marquee_parser::parse;

let doc = parse("# hello *world*\n")?;
```

- **Total prose**: any byte sequence parses — unrecognized syntax renders as the literal text
  typed. Strict constructs: malformed directives become typed `invalid_directive` nodes with
  spec'd reasons, never eaten content.
- **One input, one parse, everywhere**: held to the same published conformance vectors as the
  TypeScript implementation (`@cube-drone/marquee-parser` on npm), plus continuous
  differential fuzzing between the two. Same version number = passed the same corpus.
- The AST is the contract: renderers build UI from typed nodes; author bytes never reach
  anything `innerHTML`-shaped.

Code says `use marquee_parser::` — the registry name wears the cube-drone prefix because
crates.io has no scopes. Pair with `cube-drone-marquee-html-renderer` (rendering) or go
straight to `cube-drone-marquee-markup` (batteries included: pages, sites, the `marquee`
CLI). The spec, the vectors (CC0), and the language guide live in
[the repo](https://github.com/cube-drone/marqueemarkup).
