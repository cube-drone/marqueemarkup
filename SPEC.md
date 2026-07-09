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
- `` `code` `` spans; `*emphasis*`; `**strong**`.
- `[text](target)` links; `![alt](target)` media embeds.
- A paragraph consisting of exactly one bare target is an **Onebox** node: the client may
  render an inline summary of the referenced content; how much (full card / title only / plain
  link) is embedder + user policy. `:::onebox` exists for explicit configuration.
- Hard line break: trailing backslash.

Deliberately absent, forever or until a version bump: embedded HTML, setext headings,
reference-style links, lazy continuation, indented code blocks. Tables arrive later as a
directive, not syntax.

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

### Widgets (host-provided vocabulary)

`:::marquee`, `:::blink`, `:::counter`, `:::guestbook`, `:::webring`, `:::construction` - each
a vocabulary entry whose behavior the embedder implements and whose state (a counter's count, a
guestbook's entries) lives in the host's data layer. The v0 cut is deliberately unfinished:
the vocabulary grows from the corpus, one widget at a time.

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

## Conformance

- Two reference implementations from birth (Rust: validation/authoring-gate; JS: rendering),
  kept honest by **published vectors**: input → exact AST, in `vectors/`.
- The parse is total for prose, strict for constructs; vectors include rejection cases with
  exact error identities.
- Version tag on every document; unknown *versions* are refused, unknown *vocabulary within a
  known version* renders placeholders.

## Open questions (v0)

- [ ] Exact emphasis-delimiter rules (the one place markdown familiarity fights precision -
  simplify aggressively; vectors decide).
- [ ] List nesting depth cap and exact indentation rule.
- [ ] Video/audio as embed types: grammar is ready (targets), vocabulary + host admission
  stories are not (see Ringtome's media-type admission test).
- [ ] Tables directive design.
- [ ] The style-attribute enum's v0 cut.
- [ ] Whether `:::computed` roles beyond stream-nav make the first cut.
