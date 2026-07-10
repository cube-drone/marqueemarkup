# Conformance vectors

Each `*.json` file here is a themed set (emphasis, spans, lists, directives, caps, ...) of
cases proving that every implementation parses identically. The serialization rules are
normative in SPEC.md ("Conformance"); in short:

```json
[
  {
    "name": "emphasis/wrong-kind-closer-is-literal",
    "marquee": "*a **b* c**",
    "ast": { "type": "document", "version": 0, "children": ["..."] }
  }
]
```

- A file is a JSON array of `{name, marquee, ast}` objects. `name` is `theme/case-slug`,
  unique across the corpus.
- `marquee` is the input **after front-door normalization**: `\n` line endings only.
- Nodes are objects with `type` plus the fields SPEC.md's node inventory gives that type.
  Container nodes always carry `children` (possibly empty). Optional fields are omitted when
  absent, never `null`. Object keys sort lexicographically.
- **No source positions, no `diagnostic` nodes** — both are excluded from conformance
  (SPEC.md, "The AST").
- There is no separate rejection format: an error case is a vector whose AST contains
  `invalid_directive` nodes with their exact spec'd `reason` values.

## Workflow

Vectors are **blessed, not hand-typed**: the Rust implementation generates candidate ASTs, a
human reviews the diff against intent, and the blessed output is committed. The TypeScript
implementation then consumes the same files as a pure conformance suite. Hand-authoring ASTs
in advance invites subtle serialization drift; reviewing generated output pins behavior just
as hard without it. The `examples/*.mq` documents get vectorized the same way once the Rust
parser exists.
