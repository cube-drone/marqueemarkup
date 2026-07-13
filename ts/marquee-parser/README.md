# @cube-drone/marquee-parser

The reference parser for the [Marquee markup language](https://github.com/cube-drone/marqueemarkup):
any byte sequence in, one exact AST out, identically across implementations — held to the
published conformance vectors alongside its Rust twin (`cube-drone-marquee-parser` on crates.io).

```ts
import { parse } from "@cube-drone/marquee-parser";

const doc = parse("# hello *world*\n");
// { type: "document", version: 0, children: [...] }
```

`parse()` is total — every input yields a document; the only refusal is an unknown dialect
version (`UnsupportedVersionError`). Malformed constructs become `invalid_directive` nodes
with spec'd reasons; confusing inline input degrades to literal text. Nothing is ever eaten.

**For editor tooling** there's `parseWithPositions(source)`, returning
`{ doc, spans, source }`: the same AST byte-for-byte (positions live in a `WeakMap`
side-table, never on the nodes, so serialization and the wire contract are untouched), with
each node mapped to its `[start, end)` extent in **UTF-16 code units** over the *normalized*
source (`\r\n` → `\n`; the returned `source` is the string offsets refer to — hand it, not
your raw input, to anything consuming the spans). A span covers its construct
opener-through-closer, markers included; the interiors of canonicalized text (merged
literals, resolved escapes) are covered but not subdivided. Built for CodeMirror
decorations; deliberately outside the cross-implementation conformance corpus (see SPEC.md,
"Source positions").

Three sharp edges, all consequences of "a span is a *source* extent":

- `slice(span) !== node.value` wherever the source is denser than the text — `a \*b\* c`
  slices nine characters for a seven-character text node.
- A construct that crosses a line inside a container **contains that container's prefix**:
  in `> *a\n> b*`, the emphasis span slices `*a\n> b*`, `> ` and all. Range *marks* are fine;
  a *replace* decoration over such a range would swallow the quote marker, so split
  multi-line ranges per line before replacing.
- Blank lines between blocks belong to no node: coverage has gaps, by design.

You probably want [`@cube-drone/marquee-markup`](https://www.npmjs.com/package/@cube-drone/marquee-markup)
(batteries included: parse + render + CLI) unless you're building a renderer or tool of your
own — in which case the AST contract is specified in
[SPEC.md](https://github.com/cube-drone/marqueemarkup/blob/main/SPEC.md), and the language
itself in [WRITING.md](https://github.com/cube-drone/marqueemarkup/blob/main/WRITING.md).
