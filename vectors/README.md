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

Vectors enter the corpus two ways, at two different times:

1. **Seed vectors are hand-authored, before any parser exists.** Every deliberate ruling in
   SPEC.md (the emphasis worked example, off-grid list flooring, balanced-paren targets, each
   `invalid_directive` reason, each cap) gets its input and expected AST written by hand, from
   the spec text alone. These are TDD fixtures: the Rust implementation is written *to* them,
   not the other way around. A case that turns out to be hard to hand-author is a spec
   ambiguity discovered at the cheapest possible moment.
2. **The long tail is blessed.** Once Rust passes the seeds, candidate vectors are generated
   from new inputs (starting with `examples/*.mq`), human-reviewed against intent, and
   committed. Blessing grows the corpus; it never silently rewrites an existing vector —
   changing one is a spec decision, not a re-bless. The tool:

   ```
   cd rust/parser && cargo run --bin bless -- ../../examples/*.mq > ../../vectors/examples.json
   ```

   `examples.json` is exactly that: the six example documents, blessed (reviewed structure
   summaries against the examples README's intent notes; the two count discrepancies were
   `%%`-commented mapping notes, correctly unparsed).

Independence never came from where a vector originated: it comes from the TypeScript
implementation being held to files it had no hand in producing, from human review at bless
time, and from differential fuzzing at the end.
