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
3. **Targets** - one reference grammar for links, media, includes, turbolinks, with a
   live-vs-pinned duality (id-addressed targets may change; hash-addressed targets cannot).
4. **Embedder policy** - render-time capability decisions (fetch, trust, privacy), owned
   entirely by the host; zero grammar surface.

**The firewall:** a proposed feature must land as vocabulary inside one of these four, or it is
a change to the language itself and requires a version bump and a very good reason. "It's just
one more syntax" is how markup languages die.

## The prose core (v0)

Blocks, separated by blank lines:

- **Paragraph** - the default block. A paragraph ends at a blank line, at its container's end,
  or at any line that begins another block construct (a heading, a fence, a list marker, `>`,
  `%%`, `---`, `:::`) - jamming a list against your prose works, markdown-style; escape the
  leading character (`\- `) to keep such a line in prose. Block constructs are recognized at
  column 0 of their container.
- **Heading** - ATX only: 1-6 `#` + space + **inline content** (emphasis, spans, color, emoji,
  embeds - the full inline grammar; a blinking heading is fair game). No setext underlines.
  Seven-plus `#`s, or `#` without its space, is a paragraph - prose degrades, never guesses.
- **Fenced code** - backtick fences: an opening fence is three or more backticks; it closes on
  a line of at least that many backticks and nothing else (longer fences exist to quote literal
  triple-backticks - a document *about* Marquee needs them), and an unclosed fence auto-closes
  at EOF like a directive (the words survive; a diagnostic may note it). The optional **info
  string** (the `python` after the opening fence) is captured *opaquely* - the parser records
  it, never interprets it (same family as directive
  names, emoji slugs, and computed queries). A renderer MAY use it (syntax highlighting) but MUST
  fall back to plain monospace: highlighting is a renderer *enhancement*, never a language
  obligation - mandating it would force every client to embed highlight grammars for N languages,
  CSS-scale overreach Marquee declines. No indentation-based code.
- **Blockquote** - `>` prefix on *every* line (an optional single space after each `>` is
  stripped). No lazy continuation (a wrapped quote line still
  carries its `>`; an unprefixed line leaves the quote - CommonMark's lazy rule is an ambiguity
  source, deliberately cut).
- **List** - `- `, `* `, or `+ ` unordered (pure synonyms: markdown muscle memory is the UX
  budget, and a list that silently isn't a list is worse than any extra grammar line); `1. `
  ordered (renderer numbers; author's digits not significant). **Marker choice never carries
  meaning** - adjacent items with different markers are one list; there is no
  CommonMark-style split-on-marker-switch. (Ordered and unordered are different *kinds*, not
  marker spellings: a `1. ` line at the same column ends a bullet list and starts an ordered
  one.) Canonical AST records the list, not the spelling.
  Nesting by exactly two spaces per level, capped depth. Item text that wraps, and any block
  content *inside* an item (an image, a paragraph), must be indented to the item's content column
  (no lazy continuation, as blockquotes). A column-0 block ends the list - cosmetically invisible
  between unordered bullets, but it **restarts numbering** in an ordered list, so the failure is
  visible-and-fixable (you see `1. 2. 1.`), never silent. To keep an image in a bullet, indent it.
  Off-grid indentation **floors to the nearest valid column at or below it** (valid columns:
  0, 2, 4, ... to one level deeper than the innermost open item, within the depth cap) -
  markdown's 3- and 4-space nesting habits still nest, and the rule is one subtraction, not a
  scan. Inside a fenced code block in an item, up to the item's content column of leading
  spaces is stripped per line; anything deeper is the code's own.
- **Thematic break** - `---` alone on a line (exactly three; trailing whitespace tolerated;
  `----` is prose).
- **Comment** - `%%` at line start; consecutive `%%` lines form one comment block. **Raw
  content** (never parsed - a comment may hold broken sketch markup without spawning errors),
  which is why comments are grammar, not vocabulary: the vocabulary-blind parser cannot give
  raw treatment to a directive it does not recognize by name. `\%%` escapes a literal
  line-leading `%%` (vanishingly rare in prose).
- **Directive block** - see below.

Inlines:

- `\` escapes the next **ASCII punctuation** character (renders it literal); `\` before
  anything else is a literal backslash, and `\` at end of line is the hard break (Line breaks).
- `` `code` `` spans - a run of N backticks opens, the nearest later run of exactly N closes,
  content verbatim (N > 1 quotes literal backticks, markdown's own trick); an unclosed run is
  literal text. `*emphasis*`; `**strong**`. **The whole emphasis rule:** asterisk runs of
  length 1 (emphasis) or 2 (strong) are delimiters; runs of 3+ are literal asterisks (bold
  italic nests: `**bold and *italic* too**`). An opener is followed by non-whitespace, a closer
  preceded by non-whitespace; pairs match nearest-first without crossing; unmatched delimiters
  render literal. **`_` is always literal text** - snake_case_names never italicize. (This
  paragraph replaces CommonMark's seventeen emphasis rules, its flanking taxonomy, its Rule of
  Three, and its second delimiter character. Confusing input degrades to visible literal
  asterisks - total prose - never to a clever surprise.) `~~strikethrough~~` rides the same
  rule verbatim: tilde runs of length 2 are delimiters, any other length is literal.
- `[text](target)` links; `![alt](target)` media embeds (image/audio/video/MIDI - kind resolved
  at render, see Media).
- `:slug:` is an **emoji** node (two colons hugging word-chars: `[a-z0-9_+-]+`). Parser is
  slug-blind - emits `emoji{slug}`, resolved downstream (see Emoji); a non-matching run or an
  unknown slug renders as literal `:slug:` text. Prose-safe: `3:30` and `https://` don't match
  (one colon or none). Natural UTF-8 emoji need no syntax - they are just text.
- **Spans** - BBCode-shaped, explicitly closed, arbitrarily nestable - one inline mechanism
  carrying both *animated* vocabulary (effects) and *typographic* vocabulary (`[sup]`, `[sub]`):
  `[marquee][blink]still open at 3am[/blink][/marquee]`, `[color=red]hp low[/color]`,
  `[typewriter speed=30]...[/typewriter]`. Explicit closers make nesting unambiguous (no
  emphasis-style matching rules); an opener without its closer renders as literal text (total
  prose), and a closer must name the **innermost** open span - mismatched or orphan closers
  are literal text too; links are distinguished by their immediate `(` - `[text](target)` is a link,
  `[name ...]` is a span opener. The parser accepts any well-formed span name (grammar, not
  vocabulary); effect names are vocabulary, validated by the embedder layer like directives.
- A paragraph consisting of exactly one bare **authority-form absolute URI** - `scheme://`
  plus at least one more character, the scheme an ASCII letter then letters/digits/`+`/`-`/`.`
  - is a **turbolink** node (a hyperlink, but more - a link the renderer MAY enrich into a rich
  preview; Discourse calls its version a "onebox," Slack an "unfurl"). The authority form is
  required because *every bare word is a valid relative URI reference* - without it, each
  one-word paragraph turbolinks to a sibling document. So the sugar takes full-fat URLs only;
  everything else - a relative path, a root path, a pinned `blob:` - uses the explicit form,
  the **`:::turbolink` leaf directive**: `:::turbolink target=../two_floors_up.png
  level=title:::` - any target, plus the level knob (`full` / `title` / `bare`). The bare
  paragraph is zero-config sugar over it, exactly the media pattern (`![]()` vs `:::media`);
  parser-side, `:::turbolink` is ordinary vocabulary (a `directive` node, like `:::meta`), and
  the `turbolink{target}` core node comes only from the sugar. Marquee owns only the node;
  **where the summary comes from is entirely render/embedder-side** - OpenGraph/meta tags
  fetched from a web URL, native metadata (title, etc.) for a `ringtome://` target - and
  because enriching a web link means *fetching* it, that obeys the fetch-policy/care-modes dial
  (a privacy-max reader gets a plain link, not a fetched preview). Degrades to a plain link
  always.
- Line breaks: a single newline inside a paragraph is **soft** - it and any surrounding
  horizontal whitespace collapse to one space, so hard-wrapping a paragraph at any column is
  render-invariant (the source breaks vanish). A **hard** break is a trailing backslash; a blank
  line (two newlines) is a paragraph separator.

Deliberately absent, forever or until a version bump: embedded HTML, setext headings,
reference-style links, lazy continuation, indented code blocks. Tables are deferred from v0, but the name `:::table` is **reserved** (see Reserved
vocabulary): cozy pages rarely want them, and the body model is an open fork.

**Caps are spec, not implementation** - an implementation-defined depth limit is a manufactured
parser differential (input parses on one client, blows the stack on another), so the limits are
conformance rules with vectors: list nesting ≤ 8, blockquote nesting ≤ 8, directive nesting ≤ 4, inline nesting
(spans, delimiters, and link text - one shared depth) ≤ 8, targets ≤ 2048 bytes, attribute
values ≤ 1024 bytes, emoji slugs ≤ 64 bytes (an over-cap slug is a non-match: literal text; a
ninth-deep span opener or link falls back to literal the same way). Document size is deliberately the embedder's, not the
language's. Behavior at a cap follows the prose/construct split: over-deep list indentation
stays inside the deepest item as literal text (prose degrades), and a ninth `>` is likewise
literal text inside the deepest quote; over-deep directives are
`invalid_directive` nodes (constructs error, visibly for authors, fail-closed for strangers).

### The inline algorithm

Two implementations degrading *identically* on confusing input is the whole point, so the
inline pass is an algorithm, not a vibe. It runs once, left to right, per **container** (a
paragraph's or heading's content, and, recursively, the body of each span and the text of each
link). Whichever construct starts first wins its characters; at the same position the order is:
escape, code span, bracket construct, emoji, delimiter run.

- **Escapes** are consumed first and never reconsidered.
- **Code spans** bind next: from an opening backtick run, content is verbatim (no escapes, no
  nesting) to the closer; no closer, and the run is literal text.
- **Brackets**: at `[` (or `![`), find the matching `]`. If `(` follows immediately, it is a
  link/embed and the target lexes per Targets (balanced parens); otherwise, if the bracket's
  interior parses as a span name + attributes it opens a span, and `[/name]` closes the
  innermost open span; otherwise the characters are literal. A span's body is parsed as its own
  container.
- **Delimiter runs** (`*` of length 1 or 2, `~~`; runs of any other length are literal): a run
  *can close* if preceded by non-whitespace, *can open* if followed by non-whitespace. If it
  can close and the **innermost** unmatched opener in this container is the same kind, it
  closes it; otherwise, if it can open, it opens; otherwise it is literal. At container end,
  still-open openers revert to literal text. Matching never crosses a container boundary, a
  code span, or a bracket construct.

Worked example: `*a **b* c**` - the middle `*` can close (preceded by `b`) but the innermost
opener is `**` (wrong kind), and it cannot open (followed by a space), so it is literal; the
final `**` closes strong; the opening `*` reverts to literal at end. Result: literal `*a `,
then strong containing `b* c`. Visible asterisks, identically everywhere.

## Document metadata

A document can carry its own metadata - title, date, author, tags - and it needs to: Marquee is
standalone, so a `.mq` file on a plain web server or in a git repo has no external record to lean
on, and a self-describing document is a complete one (portable, archivable, mailable). The
ubiquity of markdown front matter is the proof this is needed; Marquee provides it without the
two things that make front matter a wart.

**A `:::meta` leaf directive carries metadata as attributes:**

```
:::meta title="House of Leaves" date=2025-01-27 tags="king in yellow, house of leaves":::
```

- **No embedded second language.** Front matter stuffs YAML/TOML - a whole cursed grammar - into
  the top of the file. Marquee's attribute grammar *already is* a key-value format, so metadata
  costs **zero new parsing**: `:::meta` is an ordinary leaf directive, and the parser stays
  vocabulary-blind (`directive{name:"meta"}`).
- **The place, not the schema.** The spec blesses the `meta` name and the rule "its attributes
  are document metadata"; the *keys* (title, date, tags, ...) are consumer-defined, opaque to
  Marquee like every attribute. Marquee carries metadata; it does not dictate a metadata model.
- **Renders nothing by default;** a consumer MAY use it (a renderer showing the title as a
  heading, a feed showing the date). Conventionally near the top, but **position-free** - the
  parser does not enforce it.
- **Multiple `:::meta` are allowed and their keys *union*** (declare metadata in one block or
  scattered). A **duplicate key resolves first-writer-wins** - the first occurrence in document
  order is authoritative, later duplicates are ignored. Deterministic (no differential), and no
  per-key merge rules (title-concatenates, tags-union would force Marquee to *know what each key
  means* - the schema it deliberately does not own). No-spooky-action: a value, once declared, is
  fixed; a later line cannot silently reach back and change it.
- **Reconciliation with external records is host policy.** A standalone file self-describes via
  `:::meta`. A host with its own record (Ringtome's post fields) decides precedence - the sane
  default is *import-time seeding*: `:::meta` populates the record on ingest, then the record is
  authoritative (a host-native document may carry no `:::meta` at all, its record being the
  metadata). Marquee guarantees only that the document *can* carry its own description when
  nothing external will.

## Directive blocks

```
:::name key=value key="quoted value"
  ...content blocks...
:::
```

- **Scope is containment, never siblings.** A directive *wraps* the blocks it applies to; its
  scope is that subtree (`directive{name, attrs, children}`), exactly as an inline span wraps its
  children. A directive never affects its siblings or "everything after it" - there is no flat
  marker that sets state for the rest of the level. (Flat state makes scope position-dependent
  and re-derived at render, a differential hazard; containment makes it an explicit,
  deterministic subtree.)
- **Delimiting:** `:::name attrs` opens; a `:::` line closes the nearest open directive (LIFO,
  depth-capped). A close may name its directive (`::: section`) for readable nesting and *local*
  error-catching - a named close that doesn't match the nearest open is flagged at that line
  (`invalid_directive`), not mysteriously later.
- **Fence mistakes never eat content - the effect is lost, never the words.** Directives still
  open at EOF auto-close at the document boundary (a valid close point), so trailing closers are
  optional and a forgotten one is no catastrophe. A misplaced or missing *inner* closer
  mis-arranges the layout (content lands in the wrong slot) but every word still renders -
  visibly wrong and fixable, never a placeholder where your essay was. Fence-balancing is also an
  authoring-client job: you no longer hand-count `:::` any more than `}` in an editor, and most
  documents (notes, messages, plain posts - no opt-in page wrapper) have no fences at all.
- **Leaf directives** (a counter, a media player, a computed slot - no body) self-close on the
  open line: `:::counter theme=retro:::` (the trailing `:::` is a token *after* the attributes;
  quoted values containing colons are safe).
- **A directive body is parsed** as blocks - unlike comments and code, which are raw. That is
  why a body can carry markup and nested directives.
- Attribute grammar is strict; directive *names* and attribute *values* are vocabulary resolved
  downstream: the parser accepts any well-formed name and emits the node, and the
  validator/embedder decides which names and values are real.
- **Unknown directive names render as an inert placeholder** ("this page uses a widget your
  client doesn't know") - the additive-evolution mechanism: new vocabulary degrades gracefully on
  old renderers, and the document version tag says which dialect to expect.

### The attribute grammar

Names and attributes are the strict half of the language, so the grammar is spelled out:

- **Names** (directive names, span names, attribute keys): `[a-z][a-z0-9_-]*` - lowercase
  ASCII starting with a letter. No case-folding anywhere (case insensitivity is a differential
  factory).
- **Open line shape:** `:::name`, then attributes separated by runs of spaces/tabs. If the
  line's last non-whitespace token is `:::`, the directive is a **leaf**: that closer is
  recognized and stripped *before* attribute parsing - which is why a quoted value may contain
  `:::` safely, and why a bare value cannot end a leaf line (quote it).
- **Attributes** are `key=value`, no whitespace around `=`. A **bare value** is one or more
  characters with no whitespace and no `"`. A **quoted value** is `"..."` with exactly two
  escapes, `\"` and `\\`; any other use of `\` inside quotes is malformed. Empty values must
  be quoted (`key=""`).
- Any deviation - a bad name, whitespace around `=`, an unterminated quote, trailing garbage
  after a leaf's closer - makes the whole directive an `invalid_directive` (strictness as
  promised); a value over 1024 bytes likewise (`attribute_too_long`). Duplicate keys are
  *well-formed* and resolve first-writer-wins (see The AST).

Spans reuse this grammar verbatim for `[name key=value]` openers, but their failure mode is
the inline one: a span opener that doesn't parse falls back to literal text - it never becomes
an `invalid_directive` (blocks get nodes, inlines get their characters back). One idiom on
top: a span name immediately followed by `=value` records that pair under its own name -
`[color=red]` is span `color` with attrs `{color: red}` - BBCode's default-parameter idiom,
zero extra grammar.

### Layout: pages, sections, slots

Page layout is *picked, not authored* - the Geocities move, and the anti-CSS firewall. The page
wrapper is **opt-in**: a plain document (a note, a message, most posts) is just a flow of blocks -
single column, default theme, no ceremony. A fancy page opts in by wrapping sections, and because
scope is containment (above), the wrapping is explicit:

```
:::page layout=two-column-nav-footer background=tile:blob:HASH
:::section slot=nav
Welcome to my page!
:::
:::section slot=main
...content blocks...
:::
:::section slot=footer
webring stuff
:::
:::
```

- `layout` is an enum; each layout defines its named slots. v0 set: `basic`,
  `nav-footer`, `two-column-nav-footer`, `three-column-nav-footer`.
- A `:::section` is a general block container; `slot` is optional, meaningful only inside a
  slotted layout (elsewhere - e.g. a themed group with a `scheme` - a slotless section is just a
  container, and children inherit its style). Duplicate slot claims are a strict error; unclaimed
  slots collapse.
- Style attributes (`background`, `scheme`, `color`, `cursor`, ...) attach here and to sections
  and spans; the full model is one section down (Styling).

### Styling

Style is where the spec says "no" most, so here is the positive model, in one place.

- **Closed knobs declared on a node - no selectors.** `:::page`, `:::section`, and style-bearing
  spans carry style attributes; the style applies to the node it is written on. You never write
  a rule that matches other nodes from afar ("all paragraphs red"). Killing selectors kills
  specificity, cascade-precedence, `!important`, and action-at-a-distance in one stroke - most
  of CSS's size, gone by omission.
- **Containment inheritance - the one thing taken from CSS.** A node's effective style is its
  own knobs layered over its parent's effective style; walk the shallow (depth ≤ 4) tree, layer.
  `:::page scheme=hotdog-stand` themes the page; an inner `:::section` inherits and may override
  a knob. That is the entire cascade - tree containment, deterministic, nothing else.
- **Schemes are named knob-bundles; individual knobs refine them.** A scheme sets many knobs at
  once (pick-a-theme); a knob written alongside overrides that scheme's value. Scheme *names*
  are spec vocabulary (closed, additive) so a scheme looks the same everywhere; an unknown
  scheme degrades to unstyled.
- **Tiny closed knob set; only `color`'s value is open.** Color (text/background/link - hex or a
  palette token; inline via `[color=red]`, block via a knob), background (color / named pattern
  / `tile:blob:HASH`), scheme, cursor, and **`font` - a named family enum in two tiers**: four
  standard stacks (`sans`, `serif`, `mono`, `comic`) and a curated grab bag of SIL-OFL faces
  (~two dozen; the canonical name list ships with the reference stylesheet). Inline via
  `[font=orbitron]`, block via the knob on pages/sections. An embedder serves the faces
  *itself*, never from a third-party CDN - font fetches are a tracking vector, and care-modes
  apply; an unknown or unloaded name degrades to its fallback stack, readable always. Exact
  lists grow from the corpus. Layout knobs (slots, columns) live on layout directives, not here.
- **Knobs are data mapped into the renderer's own styling, never CSS handed to a renderer.** The
  renderer applies "text = #00ff00" however it draws - the data/code boundary again. The *model*
  is convergent (every renderer computes the same effective knobs); the *rendering* varies by
  capability (a client that can't tile a background shrugs). Everything degrades to readable.
- **Not this** (so the boundary is legible, not mysterious): selectors, specificity,
  `!important`, positioning (absolute/flex/grid), per-element dimensions beyond closed tokens,
  media queries, freeform fonts, raw CSS. It is themes-and-local-overrides - Geocities meets the
  Windows control panel - bounded on purpose.

### Includes: shared nav, footers, mix-ins

```
:::include doc=NAV_ID:::                        (relative: a sibling in the same context)
:::include doc=ringtome://identity/NAV_ID:::    (absolute: someone else's, where permitted)
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

### Resolved directives: the renderer fills in the blank

Some directives' content is not in the document - it is obtained at render time from the
embedder (a guestbook's entries, a webcomic's "next" link). This is not a distinct mechanism:
a resolved directive and a stateful widget are one species (host-provided behavior), and the
parser is as blind to it as to every other directive name.

```
:::computed lang=ringtome-tql query="...":::      (opaque: Marquee neither parses nor understands the query)
:::computed lang=sql query="SELECT ...":::         (equally valid syntactically - Marquee has no opinion)
```

Marquee owns the **resolution contract**, never the query semantics (the same split as
animation and targets: contract yes, meaning no):

- The query string and its language are **opaque** - passed through to the embedder's resolver.
  Marquee defines no query language, no role vocabulary, no taxonomy shapes. Those belong to the
  embedder's own system (for Ringtome, a future taxonomy query language - out of scope here).
- **`:::computed` is the mechanism, not the author surface - it is verbose on purpose.** An
  embedder should offer friendly named directives (`:::next-in stream=my-comic:::`) as ordinary
  vocabulary over it; the raw form is plumbing a hand-author rarely writes, the way nobody writes
  raw SQL in a template when a helper exists.
- **Resolved content is content, never authority** (derived-not-signed): it is not in the
  document's signed bytes, it may change between renders, it cannot smuggle privilege, and it is
  subject to the same rendering rules as any content.
- **What may be queried, and against what, is embedder policy** (mechanism 4) - the resolver is
  where capability and its limits live. Marquee carrying `SELECT *` is not Marquee permitting
  it.
- **Resolution is read-only and side-effect-free.** A resolver answers questions; it never
  mutates state. This is the line that keeps a resolved directive from being `<script>`: the
  danger of embedded script is *viewed content taking actions in the reader's context*, and a
  resolver that can only *retrieve* cannot take actions. (Combined with inert results above: a
  maximally-powerful read-only resolver returning private data merely shows you your own data on
  your own screen - inert content has no network to exfiltrate through.)
- **The query should retrieve, not compute - a discipline, not a mechanism.** Marquee cannot
  enforce this: the query is opaque, so the parser cannot see (let alone evaluate) whether a
  query language is Turing-complete. The guard is a decision the resolver author makes, exactly
  as HTML's safety from scripting was never HTML's parser refusing script - it was the choice of
  whether to build and wire in an interpreter at all. So the rule is stated as what it is: *do
  not grow the query language into a programming language.* Real scripting is a separate,
  explicitly-sandboxed capability (no network, no ambient UI, budgeted, capabilities-only - the
  deferred "user scripting" rung), built as itself if ever, never smuggled through a resolver.
  A well-behaved resolved directive is data→resolver→inert content, full stop.
- Renderers handle loading / empty / failure uniformly; a renderer with no resolver for a
  directive renders the inert placeholder, like any unknown vocabulary.

### Text effects (language-defined) and the animation contract

Effects are **pure presentation semantics with no state and no host services** - kin to
`*emphasis*`, not to `:::guestbook` - so the language defines them completely: meaning,
parameters, composition, degradation. They apply inline (effect spans, above) and to blocks
(`:::marquee` as a directive wraps its blocks). Draft v0 vocabulary, grown from use like all
vocabulary: animated - `marquee` (direction, speed), `blink` (rate), `rainbow` (by),
`bounce` (by), `jitter` (by), `wave` (by), `typewriter` (speed); typographic - `sup`, `sub`,
`small`, `big`, `size` (the font-element seven-step dial, `1`-`7` with `3` normal - a closed
enum, deliberately not a unit-bearing number), and the named rungs `miniscule` (1), `tiny`
(2), `huge` (6), `enormous` (7) - unnecessary given the dial, and yet; `color` (hex or
palette token - the color model is settled in Styling); `font` (a name from the closed family
enum - see Styling).
**`by=letter` / `by=word`** animates the run unit by unit with phase-offset cycles -
sequential offsets for `rainbow`/`wave`/`bounce` (the gradient / ripple look),
deterministically scattered for `jitter`; the default animates the run as one piece. The
**`phase`** knob overrides each effect's natural order: `phase=scatter` scrambles any of them
(deterministically), `phase=ramp` sweeps any of them smoothly. Exact
offset values are renderer latitude; that they are *deterministic* is not (a document renders
the same twice). Effects nest freely - marquee and blink at
the same time is not an edge case, it is the point.

**Sidenotes are first-class** (`text[sidenote]the witty aside[/sidenote] continues`): the
Pratchett/Adams/Tufte margin aside, which every markdown ecosystem reinvents as a plugin, is
blessed vocabulary here. The span's body is the aside (rich inline content); it attaches at its
position in the flow; a capable renderer floats it in the margin (or hover/tap-to-expand on
narrow screens), and it degrades - never hidden - to an inline parenthetical or a footnote. No
grammar change: it is a `span{name: "sidenote"}` like any other, just one the spec defines rather
than the embedder. (Godot's RichTextLabel speaks BBCode with
effect tags natively; a game-engine Marquee renderer for RPG dialogue is an intended
out-of-Ringtome embedder, and the effect set is chosen with it in mind.) The vocabulary is meant
to *grow* - the early web's charm was people experimenting with a widening typographic palette,
and additive vocabulary + version bumps are that path. The discipline that keeps it convergent
rather than tag-soup: growth adds **closed, named constructs** (a future `[spiral]`, `:::columns`,
a vertical-text mode), never arbitrary positioning. So the wild typography of a book like *House
of Leaves* becomes progressively more *approximable* over time, while never becoming a free-form
canvas - the "yet" is real, the CSS swamp stays drained.

**The animation contract** - renderer obligations at the same level as "never innerHTML":

1. **Animate on visibility** - effects start when the text enters view, not at page load.
2. **The user can always skip** - one interaction completes a typewriter, stills motion, shows
   the whole text plainly. Animated text is a performance, never a hostage situation.
3. **Reduced-motion is honored** - under an OS/user reduced-motion signal, every effect
   degrades to its static text (color effects may keep their color). The old web's mistake was
   never marquee; it was marquee without an exit.
4. A renderer that doesn't implement an effect renders the text unstyled - degradation is
   always to plain, readable content.

### Media: one embed, kind resolved at render

`![alt](target)` embeds any media - image, audio, video, MIDI. There is **no per-kind syntax
and no codec fallback list**: the author writes one embed pointing at one file, and the *kind*
is resolved at render time from the content's type (the parser stays type-blind, emitting a
generic `embed` node, so the AST is identical across implementations). HTML's stacked
`<source>` ladders exist only because HTML cannot mandate a codec baseline across vendors;
Marquee's conformance model can, so it does not need them:

- **Allowed formats are a closed set** (embedder policy - Ringtome's media-type admission test
  decides what may enter as a blob at all). One known-good file, never a fallback ladder.
- **Renderers decode what they can and degrade to a link/placeholder otherwise** - the
  contractual shrug applied to media: a text-only client renders `[video: trailer.mp4]` as a
  link, a capable one plays it, nobody is nonconforming.
- **Configuration lives on `:::media`, an open, growing attribute vocabulary** (not a closed
  list - a bare `![]()` is the zero-config common case, exactly as a bare link is a turbolink but
  `:::turbolink` configures it). `:::media` is a **container**: it wraps blocks, and its knobs
  apply to every embed in that subtree - scope is containment, exactly as with sections and
  style knobs, so one wrapper can size a whole gallery. The attribute *set* grows additively across versions like all
  vocabulary; each attribute is a **closed knob** (`width=small|medium|large|full`, `fit=...`),
  never freeform CSS - the same closed-knobs discipline as page styling, so "size this image"
  never becomes "author arbitrary layout." Known categories, list deferred to the corpus:
  - *Playback* (autoplay/loop - the MIDI move, kept behind a small friction): the
    autoplay-but-always-stoppable, reduced-motion-honored rule from the animation contract
    applies.
  - *Layout* (size, fit, alignment): v0 defines `width` and `height`, whose values are a size
    token (`small` | `medium` | `large` | `full`) or a capped integer of pixels (1-4096). The
    integer is a closed value grammar like a hex color, not a step toward author CSS: it sizes
    a media box, it cannot position anything. One dimension scales the media
    (aspect ratio preserved); both dimensions author a frame the media fills (cover-cropped,
    never distorted). Invalid values degrade to natural sizing.
    `fit` and alignment wait on the corpus.
  - *Render-time processing* (dither, grayscale, scanlines - the crunch-filter aesthetic as an
    opt-in): spec-blessed like effects, degrading via the shrug (a renderer that cannot dither
    shows the plain image). Distinct from *author-time* processing, where the author bakes the
    effect into the blob before embedding and Marquee neither knows nor cares.
  - Video/audio knobs not yet imagined - the vocabulary is meant to grow here.

### Emoji resolution

The grammar gives one thing: the `emoji{slug}` node. What a slug *becomes* is layered and
entirely downstream - Marquee owns none of it:

- **Standard shortcodes** (`:smile:` → 😀) resolve against a **referenced standard table**
  (CLDR / gemoji), not a list Marquee invents and maintains - a contested 3,000-entry table is
  not the language's to own.
- **Custom emoji** resolve against a **slug → image-blob map** - which is the document slug
  register (Ringtome, Addressing) with image blobs as values instead of doc ids. Custom emoji
  is named indirection over an inline image; the indirection is existing machinery.
- **Whose map** is the same anti-global-namespace answer as every naming question here: a
  published artifact scoped to an identity or community, resolved like any other slug (a
  message's `:blobcat:` resolves against the *sender's* map - expression travels with identity;
  no global emoji namespace, no squatting). Unknown slug → literal text, so a client without the
  map shrugs exactly as chat apps already do.

### Stateful widgets (host-provided vocabulary)

`:::counter`, `:::guestbook`, `:::webring`, `:::construction` - vocabulary entries whose
behavior the embedder implements and whose **state lives in the host's data layer** (a
counter's count, a guestbook's entries). This is the line between effects and widgets: if it
needs storage or services, it is the host's; if it is pure presentation, it is the language's.
The v0 cut is deliberately unfinished: the vocabulary grows from the corpus, one widget at a
time.

## Targets

One reference grammar for every target - links, media embeds, includes, turbolinks: a target is a
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
- Grammar-side, a target is a lexable token: no whitespace, ever. In the `[text](target)` form,
  parentheses inside the target must be **balanced** -
  `[wiki](https://en.wikipedia.org/wiki/Hat_(disambiguation))` lexes whole - and an unbalanced
  `)` ends the target (one integer counter, vectored). There are no backslash escapes inside
  targets: the URI's own percent-encoding (`%29`, `%20`) is the spelling for awkward bytes. The
  parser decides where a target ends, never what it means.

## Embedder profiles

An embedder (Ringtome, a static-site generator, anything) declares:

- **Allowed schemes** per construct (e.g. links may be `https:` while embeds are `blob:` only).
- **Fetch policy for remote targets** - the "care modes" dial: fetch directly (average-user
  default; sensitive to tracking, honest about it), fetch **via the user's own node as proxy**
  (reader IP hidden, recommended default for privacy-respecting hosts), or don't fetch (render
  placeholders; Security Max / private browsing). Per-mode, user-switchable, zero grammar.
- **Widget + role vocabulary** it actually implements.
- **Include trust scope** and pin requirements.
- **Turbolink default** (full / title / bare link) and its fetch rules (summaries are fetched
  render-side per care-modes: OpenGraph for web, native metadata for own schemes).

**Messaging is Marquee under a restrictive profile**, not a separate format: a message is a
short document (one renderer for pages, posts, notes, *and* messages - the old-internet norm
where posting and chatting shared markup). The profile permits inline formatting, embeds, and
emoji while forbidding page layout, includes, and resolved directives (no `:::page` in a text
bubble). It is also the first *inter-identity* Marquee - content crossing between people - which
is where the private "tell them" disclosure lane grows into direct messages.

The **Ringtome profile** (maintained in the Ringtome repo, not here): a document's base URI is
its own `ringtome://root/...` address, so a bare relative `id` resolves within the authoring
identity (the id being the store layer's stable `doc_id`: the private register key for notes,
the reserved payload field for posts) and cross-identity references are fully qualified;
embeds `blob:` + `ringtome://` natively; `https:` media allowed with node-proxy fetch as default and care modes
present; includes same-identity only; the cozy widget set; turbolinks on by default for
`ringtome://` targets and title-only for the web.

## Reserved vocabulary

A **reserved name** is a directive name claimed for a future spec-blessed meaning, so embedders
do not repurpose it and documents port. Reservation is a promise to implementers, **not a
parser feature**: until implemented, a reserved directive is unknown vocabulary and renders the
inert placeholder like any other. Reserving a name pre-decides *what it means*, never *how it is
built*.

Discipline (so this never becomes a graveyard of ghost names): reserve only names that are
near-certain to be wanted, where a collision would misrender real documents, and whose meaning
is unambiguous. Today that is exactly one:

- **`table`** - tabular data. Body model deliberately undecided, and the fork matters:
  structured children (`:::row` / `:::cell`) would be pure vocabulary; a pipe body (`| a | b |`)
  is *raw content*, which - like comments - a vocabulary-blind parser cannot grant to a name it
  does not recognize, so pipe-tables would be a small future *grammar* addition, not just
  vocabulary. Reserving `table` commits to neither; it does not reopen the closed grammar.

## The AST (the contract)

The AST is a wire-adjacent format, not an internal data structure: it is what the vectors
serialize, what every implementation must produce identically, and what every renderer - plain
HTML, animation-capable HTML, a game engine's rich text - consumes. **One parser, many
renderers: renderers may differ in fanciness, parsers may never differ in structure.**

- **Parse is total, so every document renders - there is no invalid *document*.** Recovery is
  always deterministic and readable: duplicate keys resolve first-writer-wins, fences auto-close
  at EOF, unknown vocabulary shrugs, unmatched inline delimiters fall to literal text. Genuinely
  malformed *syntax* (a mismatched close, an unparseable attribute) becomes an `invalid_directive`
  node that still renders inertly (content preserved / placeholder); its `reason` is a **closed,
  spec'd enum** so that *parsers agree on what is malformed* - it is conformance surface for the
  vectors, not an author-facing error screen. An editor may lint off that reason; that is an
  editor being helpful, not a concept the language formalizes. "Error"/"strict"/"invalid" in this
  spec name that malformed-construct case, never a render failure.
- **The `reason` enum (closed, v0):** `bad_name` (a `:::` line with a missing or ill-formed
  name), `bad_attribute` (attribute text that doesn't parse, including trailing garbage after
  a leaf's closer), `attribute_too_long` (a value over the 1024-byte cap), `depth_exceeded`
  (a directive opened past depth 4), `mismatched_close` (a named close that doesn't name the
  nearest open directive), `stray_close` (a close line with nothing open). Six values; growing
  the list is a spec change with vectors, exactly like node types.
- **Blocks vs inlines - the whole malformed-syntax split.** A malformed *block* becomes an
  `invalid_directive` (its effect dropped, children still rendered as plain blocks; a
  stranger-render drops the effect too, which is the fail-closed safety). A malformed *inline*
  (unmatched delimiter, unclosed span) falls to the literal text typed. Blocks get a node,
  inlines get their characters back; both preserve every authored word.
- **Diagnostics are advisory `diagnostic` nodes, carried in the AST and routed - not content.**
  A parser MAY attach a `diagnostic{severity, reason}` node where something was off (a duplicate
  key ignored, unknown vocabulary shrugged, a fence auto-closed) - reader-invisible like a
  `comment`, but where `comment` is the author's deliberate note, a `diagnostic` is the parser's
  observation. Renderers **route** them to the platform's error surface (browser console, Godot's
  error log, a CLI lint panel or stderr), never into the reader's view. They are **non-normative**:
  a parser need not emit any and a richer one emits more, so they are *not* in the conformance
  vectors - content converges bit-for-bit, author-help varies by tool. In-AST (not just stderr)
  makes them durable and portable: a consumer sees a document's diagnostics without re-parsing.
- **No source positions in the conformance AST.** Rust counts UTF-8 bytes, JavaScript counts
  UTF-16 units; positions in vectors would make every emoji a conformance bug. Implementations
  may carry positions out-of-band; vector comparison excludes them.
- **Input normalization at the front door:** `\r\n` and `\r` → `\n` before anything else; tabs
  never count as indentation (a tab in content is content). **Whitespace, wherever this grammar
  says it, means ASCII space, tab, or newline** - exotic Unicode spaces are content, not
  structure (Rust's and JavaScript's Unicode-whitespace tables disagree at the fringes, and a
  flanking rule that consults them is a parser differential wearing a NBSP). Text nodes preserve content
  verbatim - no unicode normalization of prose. Paragraph-internal newlines stay literal `\n`
  in text nodes (no softbreak node); the renderer presents a lone `\n` as a soft space/wrap and
  a trailing-`\` hard break as a line break (see Line breaks).
- **Attrs** are string→string maps; a duplicate key resolves **first-writer-wins** (document
  order), the same rule everywhere it can occur. Vectors serialize maps with sorted keys
  (determinism is manual).
- **Node inventory (v0, snake_case, children arrays):** blocks - `document{version}`,
  `paragraph`, `heading{level}`, `code_block{info?, text}`, `blockquote`, `list{ordered}`,
  `list_item`, `thematic_break`, `directive{name, attrs}`, `invalid_directive{reason}`;
  inlines - `text`, `emphasis`, `strong`, `strikethrough`, `code_span{text}`, `link{target}`,
  `embed{target, alt}` (media of any kind; the kind is a render-time concern, not a node type),
  `turbolink{target}`, `span{name, attrs}`, `emoji{slug}`, `hard_break`, and the block
  `comment{text}`. Twenty-two types. Plus one **advisory** node - `diagnostic{severity, reason}`
  (above) - not counted here: it is not content and not vectored.
  Deliberately absent: `page`/`section` nodes (layout is directive *vocabulary*, checked by
  the validator layer on a parsed tree - the parser knows shapes, never names).
- **The renderer's shrug is contractual, and never hides content:** an unknown `span` renders
  its children as plain text; an unknown *container* directive renders its children as plain
  content (with an affordance that an unknown directive wrapped them); a *leaf* directive with no
  body shows the inert placeholder. Dropping authored content behind a placeholder is
  nonconforming - a directive may fail to *do* its thing, never *eat* your thing.
- **`comment` is the anti-shrug** - the one core node whose correct rendering is *absence*: it
  MUST render nothing, in every renderer. It stays in the AST (authoring tools show and edit
  your notes-to-self), never in the reader's view. **Comments are invisible to readers, never
  secret from them:** the bytes travel, view-source is real, and thirty years of leaked HTML
  comments are the fable. The Ringtome profile therefore *strips comments at the publication
  act* (free - publication already re-encodes, copy-don't-flip); standalone bare-web files ship
  their comments in the file, exactly like HTML, and the spec says so plainly.

## Conformance

- Two reference implementations from birth (Rust: validation/authoring-gate; TypeScript:
  rendering), kept honest by **published vectors**: `vectors/*.json`, each file a themed set
  (emphasis, spans, lists, directives, caps, ...) of `{name, marquee, ast}` triples. There is
  no separate rejection format: an error case is a vector whose AST contains
  `invalid_directive` nodes with their exact spec'd reasons. Maps serialize with sorted keys;
  both implementations run the same files, bless-pattern guarded.
- **Vector serialization, concretely:** a vector file is a JSON array of `{name, marquee, ast}`
  objects; `marquee` is the input after front-door normalization (`\n` line endings). An AST
  node is a JSON object with a `type` field plus that node's fields from the inventory;
  container nodes always carry `children` (possibly `[]`); `text` nodes are `{type, value}`;
  `attrs` is a JSON object. Optional fields (`code_block`'s `info`) are omitted when absent,
  never `null`. Keys sort lexicographically at every level; comparison is structural equality,
  but sorted keys keep diffs and blessing deterministic. Text is canonical: adjacent literals
  merge into one `text` node and empty text nodes do not exist - the vectors' text segmentation
  is normative structure, not an implementation accident.
- Vectors prove *parsers*. Renderer obligations (the contractual shrug, the animation
  contract) are spec text enforced by review - dignity is not byte-comparable.
- **Error recovery is conformance, not latitude - the HTML lesson, learned both ways.** Every
  recovery (auto-close at EOF innermost-first, unmatched delimiter → literal, mismatched close →
  `invalid_directive`) is specified and vectored, so all implementations recover *identically*.
  HTML proved both halves of this: forgiving recovery is right (never punish content), and
  *unspecified* recovery is the parser-differential disease - two decades of "works in one
  browser," then a tree-construction algorithm so complex few can reimplement it. Marquee keeps
  the forgiveness and pays neither cost, because the grammar is bracket-LIFO and vocabulary-blind:
  there are no per-element implicit-close rules (HTML's entire source of complexity), so recovery
  is trivial to specify and trivial to match. The sin was never that HTML recovered - it is that
  everyone recovered differently.
- Version tag on every document; unknown *versions* are refused, unknown *vocabulary within a
  known version* renders placeholders.
- **Version declaration.** Embedders supply the dialect version out-of-band (Ringtome: the
  payload type / the `format` field - its type registry already owns this). Standalone files
  may declare in-band with a shebang-shaped first line, `#!marquee 0` - exactly `#!marquee`,
  one space, a decimal integer, recognized on line 1 only; grammatically free (`#!` is not a
  heading, and any other `#!` line is prose), stripped at the front door into
  `document{version}`, never a node.
  **Precedence: embedder-supplied over in-band over the default - and the default is version 0,
  forever.** An undeclared document means what it meant the day the language shipped, in any
  year (assume-latest is meaning drift, the disease versioning exists to cure); an author using
  new features without declaring gets v0's total-prose parse of their text - degraded, visible,
  fixable.

## Open questions (v0)

The grammar is closed. What remains is **vocabulary cuts** - the exact contents of closed lists,
which grow from the plaintext-era corpus, not from a priori design - plus one item that belongs
to a different system entirely:

- [ ] Exact vocabulary lists: the style knobs' values (palettes, patterns, cursors, schemes),
  the effect set, the widget set, the audio/video attribute lists (blocked on media blobs
  existing to test against). Shapes are settled; contents wait on use.
- [ ] Tables (`:::table` name reserved, see Reserved vocabulary): if the corpus asks, decide the
  body-model fork - structured children (vocabulary) vs. pipe body (a raw-content grammar addition).
- [ ] **Not Marquee's** (named so nobody hunts for them here): the taxonomy query language
  resolved directives carry; the custom-emoji map artifact and the messaging vocabulary profile.
  All belong to the embedder (Ringtome). Marquee owns the `emoji`/`directive`/`embed` grammar
  and treats their contents as opaque.
