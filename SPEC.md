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
- **Comment** - `%%` at line start; consecutive `%%` lines form one comment block. **Raw
  content** (never parsed - a comment may hold broken sketch markup without spawning errors),
  which is why comments are grammar, not vocabulary: the vocabulary-blind parser cannot give
  raw treatment to a directive it does not recognize by name. `\%%` escapes a literal
  line-leading `%%` (vanishingly rare in prose).
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
  prose); links are distinguished by their immediate `(` - `[text](target)` is a link,
  `[name ...]` is a span opener. The parser accepts any well-formed span name (grammar, not
  vocabulary); effect names are vocabulary, validated by the embedder layer like directives.
- A paragraph consisting of exactly one bare target is an **Onebox** node: the client may
  render an inline summary of the referenced content; how much (full card / title only / plain
  link) is embedder + user policy. `:::onebox` exists for explicit configuration.
- Hard line break: trailing backslash.

Deliberately absent, forever or until a version bump: embedded HTML, setext headings,
reference-style links, lazy continuation, indented code blocks. Tables are deferred from v0, but the name `:::table` is **reserved** (see Reserved
vocabulary): cozy pages rarely want them, and the body model is an open fork.

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
- Style attributes are a **closed set of knobs** (`background`, `cursor`, `scheme`, `color`),
  versioned with the vocabulary - CSS-the-capability behind a counter. The one rule worth
  stating: *what* you can style is closed; `color` is the single knob whose *value* is open
  (hex or named palette), because color is the one continuous space users genuinely reach for.
  Everything else takes tokens from a list (backgrounds are named patterns or `tile:blob:HASH`;
  cursors and schemes are enums). No positioning, no freeform fonts, no per-element layout - the
  anti-CSS firewall. (The exact palette/pattern/cursor/scheme lists grow from the corpus.)

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

### Resolved directives: the renderer fills in the blank

Some directives' content is not in the document - it is obtained at render time from the
embedder (a guestbook's entries, a webcomic's "next" link). This is not a distinct mechanism:
a resolved directive and a stateful widget are one species (host-provided behavior), and the
parser is as blind to it as to every other directive name.

```
:::computed lang=ringtome-tql query="..."      (opaque: Marquee neither parses nor understands the query)
:::computed lang=sql query="SELECT ..."         (equally valid syntactically - Marquee has no opinion)
```

Marquee owns the **resolution contract**, never the query semantics (the same split as
animation and targets: contract yes, meaning no):

- The query string and its language are **opaque** - passed through to the embedder's resolver.
  Marquee defines no query language, no role vocabulary, no taxonomy shapes. Those belong to the
  embedder's own system (for Ringtome, a future taxonomy query language - out of scope here).
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
  list - a bare `![]()` is the zero-config common case, exactly as a bare link is a onebox but
  `:::onebox` configures it). The attribute *set* grows additively across versions like all
  vocabulary; each attribute is a **closed knob** (`width=small|medium|large|full`, `fit=...`),
  never freeform CSS - the same closed-knobs discipline as page styling, so "size this image"
  never becomes "author arbitrary layout." Known categories, list deferred to the corpus:
  - *Playback* (autoplay/loop - the MIDI move, kept behind a small friction): the
    autoplay-but-always-stoppable, reduced-motion-honored rule from the animation contract
    applies.
  - *Layout* (size, fit, alignment): closed tokens, capped.
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
present; includes same-identity only; the cozy widget set; oneboxes on by default for
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
  `embed{target, alt}` (media of any kind; the kind is a render-time concern, not a node type),
  `onebox{target}`, `span{name, attrs}`, `emoji{slug}`, `hard_break`, and the block
  `comment{text}`. Twenty-two types.
  Deliberately absent: `page`/`section` nodes (layout is directive *vocabulary*, checked by
  the validator layer on a parsed tree - the parser knows shapes, never names).
- **The renderer's shrug is contractual:** an unknown `span` renders its children as plain
  text (the words always survive); an unknown `directive` renders the inert placeholder (the
  reader learns something was there). Dropping unknown content silently is nonconforming.
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
- Vectors prove *parsers*. Renderer obligations (the contractual shrug, the animation
  contract) are spec text enforced by review - dignity is not byte-comparable.
- Version tag on every document; unknown *versions* are refused, unknown *vocabulary within a
  known version* renders placeholders.
- **Version declaration.** Embedders supply the dialect version out-of-band (Ringtome: the
  payload type / the `format` field - its type registry already owns this). Standalone files
  may declare in-band with a shebang-shaped first line, `#!marquee 0` - grammatically free
  (`#!` is not a heading), stripped at the front door into `document{version}`, never a node.
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
