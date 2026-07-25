# cube-drone-marquee-parser

The reference Rust parser for [Marquee](https://github.com/cube-drone/marqueemarkup) — a
markup language that's a little bit of Markdown, a little bit of RST, and a whole lot of dumb
old internet (blink tags, marquees, rainbow text, the works).

It does one job: turn Marquee source text into a typed syntax tree. It does **not** render
HTML — that's [`cube-drone-marquee-html-renderer`](https://crates.io/crates/cube-drone-marquee-html-renderer),
or [`cube-drone-marquee-markup`](https://crates.io/crates/cube-drone-marquee-markup) if you
want the whole enchilada (styling, fonts, a `marquee` CLI). This crate is the foundation the
rest is built on.

## Parsing

```rust
use marquee_parser::parse;

let doc = parse("# hello *world*\n").expect("a known dialect");
```

`parse` hands back a `Result<Node, ParseError>`. The `Ok` is always a `Node::Document` — the
root of the tree. You will almost never see an `Err`, because Marquee parsing is *total*:
every possible byte sequence is a valid document (more on why that matters below). The one
exception is a document that declares a dialect version this parser doesn't know — a
`#!marquee 99` line — which comes back as `Err(ParseError)` rather than a guess about what a
future version might mean.

## The syntax tree

The tree is the whole point. It's the contract every renderer, formatter, and tool consumes,
and it's a plain `enum` with public fields — so you walk it with ordinary pattern matching:

```rust
use marquee_parser::{parse, Node};

let doc = parse("a *b* c\n").expect("a known dialect");

// The root is always a Document; its children are block-level nodes.
let Node::Document { children, .. } = &doc else { unreachable!() };

// A single line of prose is one Paragraph, whose children are inline nodes.
let Node::Paragraph { children: inlines } = &children[0] else { unreachable!() };

// "a *b* c" splits into three inlines: Text("a "), Emphasis(["b"]), Text(" c").
assert_eq!(inlines.len(), 3);
assert!(matches!(inlines[1], Node::Emphasis { .. }));
```

Nodes come in two families: **blocks** (`Heading`, `Paragraph`, `List`, `Blockquote`,
`CodeBlock`, `Directive`, …) and **inlines** (`Text`, `Emphasis`, `Strong`, `Link`, `Emoji`,
`Span`, …). The full inventory — 22 node types, frozen by the version number — lives in
[`SPEC.md`](https://github.com/cube-drone/marqueemarkup/blob/main/SPEC.md#the-ast-the-contract).

## Serializing (tree → source)

The tree road runs both ways. `serialize` is the inverse of `parse`: give it a `Node` and get
Marquee source back out.

```rust
use marquee_parser::{parse, serialize};

let doc = parse("# hello *world*\n").expect("a known dialect");
assert_eq!(serialize(&doc), "# hello *world*\n");
```

There is exactly *one* tree for any given source, but many source spellings can produce the
same tree — so `serialize` is really a **formatter**: it picks one canonical spelling. Sending
a document through `parse` then `serialize` tidies it into that canonical form. Ordered-list
numbers are a good example: the tree records only that a list *is* ordered, not what you
numbered it, so they come back renumbered from one:

```rust
use marquee_parser::{parse, serialize};

let messy = parse("3. first\n7. second\n").expect("a known dialect");
assert_eq!(serialize(&messy), "1. first\n1. second\n");
```

And formatting is stable — running it on an already-formatted document changes nothing:

```rust
use marquee_parser::{parse, serialize};

let once = serialize(&parse("**bold**\n").expect("known"));
let twice = serialize(&parse(&once).expect("known"));
assert_eq!(once, twice);
```

This is the piece a `marquee fmt` command would stand on, and it's how you convert *into*
Marquee from another format: build the tree, then serialize it out. (One deep corner of the
grammar can't be canonicalized — an unescapable bracket inside a link or span — but you'd have
to go looking for it; ordinary documents round-trip exactly.)

## What makes Marquee parsing different

- **It never fails on content.** Any byte sequence parses; unrecognized syntax simply becomes
  the literal text you typed. Genuinely malformed *directives* turn into typed
  `invalid_directive` nodes (each with a spec'd reason) rather than being silently dropped —
  your words are never eaten. That's what makes it safe for hosting other people's writing.
- **One input, one parse, everywhere.** This crate is held to the same published conformance
  vectors as the TypeScript implementation (`@cube-drone/marquee-parser` on npm), with
  continuous differential fuzzing between the two. Same version number means both passed the
  same corpus, byte for byte.
- **The tree is the security boundary.** Renderers build their output from typed nodes; author
  bytes never reach anything `innerHTML`-shaped. Marquee has no raw-HTML passthrough at all —
  which is the entire reason it exists.

## A note on the name

Your code reads `use marquee_parser::` — the pretty name. The crate on crates.io wears the
`cube-drone-` prefix only because crates.io has no scopes to namespace with. Pair it with
`cube-drone-marquee-html-renderer` to render, or reach straight for
`cube-drone-marquee-markup` for the batteries-included experience: complete HTML pages, whole
static sites, and the `marquee` CLI. The spec, the conformance vectors (CC0), and the
language-writing guide all live in [the repo](https://github.com/cube-drone/marqueemarkup).
