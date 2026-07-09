# Marquee — Language Specification

**Status: DRAFT v0.** The grammar's *shape* is settled; the vocabulary is deliberately
unfinished (it grows from real usage - see Ringtome's NOTES_APP.md on the corpus). This
document is released under **CC0**: a spec that isn't freely implementable isn't a spec.

Marquee is a markup language for pages and posts: a little bit of markdown, a little bit of
RST, a whole lot of dumb old internet. It is a **standalone product** - Ringtome is its first
embedder, not its owner - and it renders on the regular web.

## Design principles

1. **Markdown's hands, RST's skeleton, our own skin.** The prose surface is markdown-familiar
   (that familiarity is the entire UX budget); the extension model is RST-style directive
   blocks (new constructs are *vocabulary*, never grammar changes); presentation is a closed
   style vocabulary, never CSS-the-language.
2. **One input, one parse, everywhere.** Marquee will be parsed by many independent
   implementations on both sides of trust boundaries. Grammar ambiguity is parser-differential
   risk (content that reads as prose to a validator and as an active construct to a renderer -
   the mXSS genre) and it is also just broken cozy ("my page looks like my page on every
   client"). The grammar is therefore small and unambiguous, specified by this document plus
   **published test vectors** (input → exact AST), CommonMark's philosophy deliberately
   refused. Prior art in spirit: Djot.
3. **Total prose, strict constructs.** Any byte sequence parses: unrecognized syntax renders as
   the literal text typed - an author never sees a red underline for writing a paragraph.
   Directives and their attributes are strict: malformed constructs are errors (surfaced at
   authoring; refused fail-closed when rendering others' content).
4. **The AST is the contract.** Renderers construct UI from the AST (DOM nodes, native
   controls); author bytes are never passed to anything `innerHTML`-shaped. Rendering all of
   Marquee means implementing a closed vocabulary, not embedding a browser.
5. **The language defines meaning; the embedder defines policy.** Marquee says what a construct
   *is*; the host application says what it may *do* - which URL schemes resolve, whether remote
   media is fetched, which widgets exist, how far trust extends. See "Embedder profiles."

## The four mechanisms (and the bloat firewall)

Everything in Marquee is an instance of exactly four mechanisms:

1. **The prose core** - paragraphs and inline formatting.
2. **Directive blocks** - layout, sections, widgets, includes, media: all vocabulary.
3. **Targets** - one reference grammar for links, media, includes, oneboxes, with a
   live-vs-pinned duality (id-addressed targets may change; hash-addressed targets cannot).
4. **Embedder policy** - render-time capability decisions (fetch, trust, privacy), owned
   entirely by the host; zero grammar surface.

**The firewall:** a proposed feature must land as vocabulary inside one of these four, or it is
a change to the language itself and requires a version bump and a very good reason. "It's just
one more syntax" is how markup languages die.

## The prose core (v0)

Blocks, separated by blank lines:

- **Paragraph** - the default block.
- **Heading** - ATX only: 1-6 `#` + space + text. No setext underlines.
- **Fenced code** - triple-backtick fences, optional info string, no indentation-based code.
- **Blockquote** - `>` prefix per line. No lazy continuation.
- **List** - `- `, `* `, or `+ ` unordered (pure synonyms: markdown muscle memory is the UX
  budget, and a list that silently isn't a list is worse than any extra grammar line); `1. `
  ordered (renderer numbers; author's digits not significant). **Marker choice never carries
  meaning** - adjacent items with different markers are one list; there is no
  CommonMark-style split-on-marker-switch. Canonical AST records the list, not the spelling.
  Nesting by exactly two spaces per level, capped depth.
- **Thematic break** - `---` alone on a line.
- **Directive block** - see below.

Inlines:

- `\` escapes the next punctuation character (renders it literal).
- `` `code` `` spans; `*emphasis*`; `**strong**`. **The whole emphasis rule:** asterisk runs of
  length 1 (emphasis) or 2 (strong) are delimiters; runs of 3+ are literal asterisks (bold
  italic nests: `**bold and *italic* too**`). An opener is followed by non-whitespace, a closer
  preceded by non-whitespace; pairs match nearest-first without crossing; unmatched delimiters
  render literal. **`_` is always literal text** - snake_case_names never italicize. (This
  paragraph replaces CommonMark's seventeen emphasis rules, its flanking taxonomy, its Rule of
  Three, and its second delimiter character. Confusing input degrades to visible literal
  asterisks - total prose - never to a clever surprise.) `~~strikethrough~~` rides the same
  rule verbatim: tilde runs of length 2 are delimiters, any other length is literal.
- `[text](target)` links; `![alt](target)` media embeds.
- **Spans** - BBCode-shaped, explicitly closed, arbitrarily nestable - one inline mechanism
  carrying both *animated* vocabulary (effects) and *typographic* vocabulary (`[sup]`, `[sub]`):
  `[marquee][blink]still open at 3am[/blink][/marquee]`, `[color=red]hp low[/color]`,
  `[typewriter speed=30]...[/typewriter]`. Explicit closers make nesting unambiguous (no
  emphasis-style matching rules); an opener without its closer renders as literal text (total
  prose); links are distinguished by their immediate `(` - `[text](target)` is a link,
  `[name ...]` is a span opener. The parser accepts any well-formed span name (grammar, not
  vocabulary); effect names are vocabulary, validated by the embedder layer like directives.
- A paragraph consisting of exactly one bare target is an **Onebox** node: the client may
  render an inline summary of the referenced content; how much (full card / title only / plain
  link) is embedder + user policy. `:::onebox` exists for explicit configuration.
- Hard line break: trailing backslash.

Deliberately absent, forever or until a version bump: embedded HTML, setext headings,
reference-style links, lazy continuation, indented code blocks. Tables arrive later as a
directive, not syntax.

**Caps are spec, not implementation** - an implementation-defined depth limit is a manufactured
parser differential (input parses on one client, blows the stack on another), so the limits are
conformance rules with vectors: list nesting ≤ 8, directive nesting ≤ 4, targets ≤ 2048 bytes,
attribute values ≤ 1024 bytes. Document size is deliberately the embedder's, not the
language's. Behavior at a cap follows the prose/construct split: over-deep list indentation
stays inside the deepest item as literal text (prose degrades); over-deep directives are
`invalid_directive` nodes (constructs error, visibly for authors, fail-closed for strangers).

## Directive blocks

```
:::name key=value key="quoted value"
  ...content blocks...
:::
```

- Names and attribute keys are a **closed, versioned vocabulary**; attribute grammar is strict.
- Nesting is allowed to a fixed depth cap.
- **Unknown directive names render as an inert placeholder** ("this page uses a widget your
  client doesn't know") - that is the additive-evolution mechanism: new vocabulary degrades
  gracefully on old renderers, and the document version tag says which dialect to expect.

### Layout: pages, sections, slots

Page layout is *picked, not authored* - the Geocities move, and the anti-CSS firewall:

```
:::page layout=two-column-nav-footer background=tile:blob:HASH
:::section slot=nav        ...
:::section slot=main       ...
:::section slot=right      ...
:::section slot=footer     ...
```

- `layout` is an enum; each layout defines its named slots. v0 set: `basic`,
  `nav-footer`, `two-column-nav-footer`, `three-column-nav-footer`.
- Duplicate slot claims are a strict error; unclaimed slots collapse.
- Style attributes (`background`, `cursor`, `scheme`, ...) are a closed enum per directive,
  versioned with the vocabulary. CSS-the-capability behind a counter.

### Includes: shared nav, footers, mix-ins

```
:::include doc=NAV_ID                        (relative: a sibling in the same context)
:::include doc=ringtome://identity/NAV_ID    (absolute: someone else's, where permitted)
```

- Includes are **live by default** (a relative or location-addressed reference: edit your nav
  once, every page updates) or **pinned** (`blob:`-addressed: this exact version forever).
  Live-vs-pinned is the target duality, chosen per reference.
- The language enforces mechanics: include depth cap (v0: includes may not include), cycle =
  strict error. The *trust scope* - whose documents may be included - is embedder policy
  (Ringtome's profile: same-identity only in v1; someone else's mutable content inside your
  signed page is a defacement vector to opt into deliberately, later).
- Honesty note: a live include means a page's rendered content can change after signing. That
  is the feature (shared nav) and the hazard (what moderation saw ≠ what readers see later);
  embedders choose their exposure via trust scope and pin policies.

### Computed slots: the client fills in the blank

```
:::computed role=next-in-stream stream=STREAM_ID
:::computed role=prev-in-stream stream=STREAM_ID
```

The webcomic "next" button: the *author* declares intent, the *client* computes the content at
render time (from a stream/taxonomy artifact the role names). Roles are vocabulary; a client
without the role renders the placeholder. This is "interactivity as platform widgets, never
user code" - behavior lives in the client, state lives in the host protocol.

### Text effects (language-defined) and the animation contract

Effects are **pure presentation semantics with no state and no host services** - kin to
`*emphasis*`, not to `:::guestbook` - so the language defines them completely: meaning,
parameters, composition, degradation. They apply inline (effect spans, above) and to blocks
(`:::marquee` as a directive wraps its blocks). Draft v0 vocabulary, grown from use like all
vocabulary: animated - `marquee` (direction, speed), `blink` (rate), `rainbow`,
`bounce`, `jitter`, `wave`, `typewriter` (speed); typographic - `sup`, `sub`,
`color=<token|hex>` (the hex question belongs to the style-enum open item). Effects nest freely - marquee and blink at
the same time is not an edge case, it is the point. (Godot's RichTextLabel speaks BBCode with
effect tags natively; a game-engine Marquee renderer for RPG dialogue is an intended
out-of-Ringtome embedder, and the effect set is chosen with it in mind.)

**The animation contract** - renderer obligations at the same level as "never innerHTML":

1. **Animate on visibility** - effects start when the text enters view, not at page load.
2. **The user can always skip** - one interaction completes a typewriter, stills motion, shows
   the whole text plainly. Animated text is a performance, never a hostage situation.
3. **Reduced-motion is honored** - under an OS/user reduced-motion signal, every effect
   degrades to its static text (color effects may keep their color). The old web's mistake was
   never marquee; it was marquee without an exit.
4. A renderer that doesn't implement an effect renders the text unstyled - degradation is
   always to plain, readable content.

### Stateful widgets (host-provided vocabulary)

`:::counter`, `:::guestbook`, `:::webring`, `:::construction` - vocabulary entries whose
behavior the embedder implements and whose **state lives in the host's data layer** (a
counter's count, a guestbook's entries). This is the line between effects and widgets: if it
needs storage or services, it is the host's; if it is pure presentation, it is the language's.
The v0 cut is deliberately unfinished: the vocabulary grows from the corpus, one widget at a
time.

## Targets

One reference grammar for every target - links, media embeds, includes, oneboxes: a target is a
**URI reference** (RFC 3986), absolute or relative, with standard resolution. Not a new
mechanism - the web's own, adopted whole:

- **Relative references** (`nav`, `../shared/nav`, `/home/nav`) resolve against the containing
  document's **base URI**, which the embedder supplies: on the web, the document's URL, exactly
  as HTML; in Ringtome, the document's own `ringtome://root/...` address - so a bare `id` names
  a sibling document in the same identity, and author-context resolution is a *corollary of the
  standard*, not a bespoke rule. The known cost, accepted with eyes open: relative references
  are location-dependent (move the document, break the short links) - the web's bargain since
  1993, and the absolute form always exists.
- **Transclusion base rule:** an included document's own relative references resolve against
  *its* base, never the includer's (the iframe rule, not the SSI rule) - a shared nav renders
  the same links on every page that includes it, or convergence dies.
- **Absolute forms**: `https:` / `http:` (the regular web - Marquee is useful outside any p2p
  system; web images, videos, and links are first-class in the grammar; whether they are
  *fetched* is embedder policy), embedder-registered schemes (`ringtome://identity/id` - the
  whole shebang, required for cross-identity references), and `blob:HASH`.
- **Live vs. pinned is per-scheme**: relative references and location-addressed schemes are
  *live* (resolution yields the current version); hash-addressed schemes (`blob:`) are *pinned*
  (this exact content forever). Choose per reference.
- Grammar-side, a target is a lexable token: no unescaped whitespace or `)`; the parser decides
  where a target ends, never what it means.

## Embedder profiles

An embedder (Ringtome, a static-site generator, anything) declares:

- **Allowed schemes** per construct (e.g. links may be `https:` while embeds are `blob:` only).
- **Fetch policy for remote targets** - the "care modes" dial: fetch directly (average-user
  default; sensitive to tracking, honest about it), fetch **via the user's own node as proxy**
  (reader IP hidden, recommended default for privacy-respecting hosts), or don't fetch (render
  placeholders; Security Max / private browsing). Per-mode, user-switchable, zero grammar.
- **Widget + role vocabulary** it actually implements.
- **Include trust scope** and pin requirements.
- **Onebox default** (full card / title / bare link) and its fetch rules.

The **Ringtome profile** (maintained in the Ringtome repo, not here): a document's base URI is
its own `ringtome://root/...` address, so a bare relative `id` resolves within the authoring
identity (the id being the store layer's stable `doc_id`: the private register key for notes,
the reserved payload field for posts) and cross-identity references are fully qualified;
embeds `blob:` + `ringtome://` natively; `https:` media allowed with node-proxy fetch as default and care modes
present; includes same-identity only; the cozy widget set; oneboxes on by default for
`ringtome://` targets and title-only for the web.

## The AST (the contract)

The AST is a wire-adjacent format, not an internal data structure: it is what the vectors
serialize, what every implementation must produce identically, and what every renderer - plain
HTML, animation-capable HTML, a game engine's rich text - consumes. **One parser, many
renderers: renderers may differ in fanciness, parsers may never differ in structure.**

- **Parsing is total.** `parse(text) → document`, always. Malformed block constructs become
  `invalid_directive{reason}` nodes *in* the tree; there is no separate error channel, and an
  "error case" vector is just a vector whose AST contains invalid nodes. `reason` values are a
  **closed, spec'd enum** - diagnostics are conformance surface (two clients disagreeing about
  validity is a fail-closed disagreement), never freeform text.
- **Blocks error; inlines degrade.** Directives (block constructs) are strict → `invalid_directive`.
  Spans and delimiters (inline constructs) are total → malformed input renders as the literal
  text typed. One sentence of error philosophy for the whole language.
- **No source positions in the conformance AST.** Rust counts UTF-8 bytes, JavaScript counts
  UTF-16 units; positions in vectors would make every emoji a conformance bug. Implementations
  may carry positions out-of-band; vector comparison excludes them.
- **Input normalization at the front door:** `\r\n` and `\r` → `\n` before anything else; tabs
  never count as indentation (a tab in content is content). Text nodes preserve content
  verbatim - no unicode normalization of prose. Paragraph-internal newlines are literal `\n`
  in text nodes (no softbreak node).
- **Attrs** are string→string maps: duplicate keys are strict errors in directives, literal
  fallback in spans; vectors serialize maps with sorted keys (determinism is manual).
- **Node inventory (v0, snake_case, children arrays):** blocks - `document{version}`,
  `paragraph`, `heading{level}`, `code_block{info?}`, `blockquote`, `list{ordered}`,
  `list_item`, `thematic_break`, `directive{name, attrs}`, `invalid_directive{reason}`;
  inlines - `text`, `emphasis`, `strong`, `strikethrough`, `code_span`, `link{target}`,
  `image{target, alt}`, `onebox{target}`, `span{name, attrs}`, `hard_break`. Twenty types.
  Deliberately absent: `page`/`section` nodes (layout is directive *vocabulary*, checked by
  the validator layer on a parsed tree - the parser knows shapes, never names).
- **The renderer's shrug is contractual:** an unknown `span` renders its children as plain
  text (the words always survive); an unknown `directive` renders the inert placeholder (the
  reader learns something was there). Dropping unknown content silently is nonconforming.

## Conformance

- Two reference implementations from birth (Rust: validation/authoring-gate; TypeScript:
  rendering), kept honest by **published vectors**: `vectors/*.json`, each file a themed set
  (emphasis, spans, lists, directives, caps, ...) of `{name, marquee, ast}` triples. There is
  no separate rejection format: an error case is a vector whose AST contains
  `invalid_directive` nodes with their exact spec'd reasons. Maps serialize with sorted keys;
  both implementations run the same files, bless-pattern guarded.
- Vectors prove *parsers*. Renderer obligations (the contractual shrug, the animation
  contract) are spec text enforced by review - dignity is not byte-comparable.
- Version tag on every document; unknown *versions* are refused, unknown *vocabulary within a
  known version* renders placeholders.

## Open questions (v0)

- [ ] Video/audio as embed types: grammar is ready (targets), vocabulary + host admission
  stories are not (see Ringtome's media-type admission test).
- [ ] Tables directive design.
- [ ] The style-attribute enum's v0 cut (including whether `color` takes palette tokens only
  or tokens + hex).
- [ ] Version declaration for standalone files: Ringtome supplies the dialect version via its
  type registry, but a bare `.mq` file on the plain web needs a convention (shebang-style first
  line? assume-latest?).
- [ ] Whether `:::computed` roles beyond stream-nav make the first cut.
