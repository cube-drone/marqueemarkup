# @classam/marquee-parser

The reference parser for the [Marquee markup language](https://github.com/cube-drone/marqueemarkup):
any byte sequence in, one exact AST out, identically across implementations — held to the
published conformance vectors alongside its Rust twin (`marquee-parser` on crates.io).

```ts
import { parse } from "@classam/marquee-parser";

const doc = parse("# hello *world*\n");
// { type: "document", version: 0, children: [...] }
```

`parse()` is total — every input yields a document; the only refusal is an unknown dialect
version (`UnsupportedVersionError`). Malformed constructs become `invalid_directive` nodes
with spec'd reasons; confusing inline input degrades to literal text. Nothing is ever eaten.

You probably want [`@classam/marquee-markup`](https://www.npmjs.com/package/@classam/marquee-markup)
(batteries included: parse + render + CLI) unless you're building a renderer or tool of your
own — in which case the AST contract is specified in
[SPEC.md](https://github.com/cube-drone/marqueemarkup/blob/main/SPEC.md), and the language
itself in [WRITING.md](https://github.com/cube-drone/marqueemarkup/blob/main/WRITING.md).
