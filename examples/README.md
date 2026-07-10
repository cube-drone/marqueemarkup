# Marquee examples

Hand-written `.mq` files exploring real use cases, faithful to [SPEC.md](../SPEC.md) (v0). They
come *before* the parser on purpose: writing real documents is the cheapest way to stress-test
the grammar's **ergonomics** (does it feel good to write?) and to surface spec gaps before code
locks them in. They will also seed the conformance vectors — each becomes an input→AST case once
the parser exists.

Conventions: `#!marquee 0` on line one is the standalone version declaration. Blob hashes are
shortened to readable placeholders (`blob:aria-portrait`); real targets are BLAKE3 hashes.

| file | exercises |
|---|---|
| `blog-entry.mq` | headings, prose, lists, fenced code, a bare-URL turbolink, a `%%` comment, inline color, strikethrough |
| `friendly-message.mq` | the messaging profile — casual, flat, emoji, an embed, strikethrough; **no** page layout (messages forbid it) |
| `website-frontpage.mq` | the dumb-old-internet showcase — slotted page layout, tiled background + scheme, a shared-nav include, marquee/blink, hit counter, webring |
| `webcomic.mq` | a comic page with client-computed prev/next navigation over a stream |
| `real-blog-house-of-leaves.mq` | a **real** 2025 blog post translated from Hugo markdown — first-class sidenotes, `[color=blue]` semantic text, linked images, a YouTube turbolink, the `_`→`*` and entity fixups |
| `rpg-conversation.mq` | animated dialogue via an embedder `:::say` directive — speaker/portrait as attrs, utterance as body, nested effect spans, custom emoji; Marquee as a game-engine text format |

## Findings

Writing these *is* a spec test. What came up (all now fixed in SPEC.md):

- **Leaf directives must self-close.** The include/computed examples in the spec were written
  `:::include doc=nav` with no closer, which the leaf rule forbids — a bodyless directive must be
  `:::include doc=nav:::` or it opens a container that swallows following blocks. Fixed the spec
  examples; the `.mq` files here use the correct form.
- **Inline nesting had no depth cap.** `rpg-conversation.mq` legitimately nests
  `[typewriter]` → `[color]` → `[jitter]`; nothing bounded it, so a hostile document could nest
  spans to a stack overflow. Added an inline-nesting cap (≤ 8) alongside the existing list/
  directive caps.
- **Single-newline rendering was unspecified.** In the RPG file, a portrait embed and its
  dialogue line on adjacent lines would collapse into one space-joined paragraph — I had never
  said what a lone intra-paragraph newline *does*. Specified it as markdown's rule (soft = space/
  wrap; hard break = trailing `\`), and the examples use blank lines to separate blocks cleanly.
- **`:::section` outside a layout needed a ruling.** The RPG uses `:::section scheme=parchment`
  with no slot and no page. Clarified: a section is a general block container; `slot` is optional
  and meaningful only inside a slotted layout.
- **The raw `:::computed` form is verbose** (`webcomic.mq`'s prev/next). That is correct — it is
  the *mechanism*, not the author surface — but the spec now says embedders should offer friendly
  named vocabulary (`:::next-in stream=...`) over it, the way nobody hand-writes raw SQL when a
  helper exists.
- **The full House of Leaves post drew a real boundary: Marquee is a semantic document language,
  not a typographic canvas.** The post's whole thesis is meaning-through-form (the word "house"
  always blue, per-narrator typefaces, contorting/spiraling/mirrored text, the book "bigger on
  the inside"). Marquee does exactly one of those natively — meaningful *color* (a closed,
  semantic knob) — and structurally cannot do the rest, because arbitrary text *arrangement* is
  what the anti-CSS firewall forbids. The post translates only because it already renders the
  radical typography as **images**, Marquee's expected escape hatch. You can render a post
  *about* House of Leaves; you cannot author House of Leaves. Correct limitation for a cozy
  network, and worth stating: color is in scope, arrangement is not.
- **Images interspersed in lists split the list** (the Structure section's `![](./impossible.png)`
  between bullets). Under no-lazy-continuation, a column-0 block leaves the list — cosmetically
  invisible for unordered bullets, but it *restarts numbering* for ordered lists. Keep block
  content in an item by indenting it to the content column.
- **Headings take full inline content** — the post colors "house" inside `##` headings. The spec
  said only "text," which was ambiguous; clarified to the full inline grammar (blinking headings
  and all).
- **Sidenote density is a renderer problem, not a language one.** 28 sidenotes, several a full
  paragraph: the language captures them cleanly, but a renderer floating that many margin notes
  needs a real placement strategy (stack / number / collapse-on-narrow). "First-class" means
  in-the-spec, not trivial-to-render-well.
- **The post would want Ringtome content labels** (it discusses suicide and child abuse) — not a
  Marquee concern (the language doesn't moderate), but the first real-data demonstration of the
  reserved `labels` consent field's need rather than a hypothesized one.
- **Real data (`real-blog-house-of-leaves.mq`) validated the language against writing I did not
  design for it, and paid off several ways.** The Hugo→Marquee mapping was clean and mostly
  1:1 — the notable results:
  - **Sidenotes became first-class.** Curtis reaches for Pratchett/Adams asides constantly and
    has to plugin them into every markdown setup; the post uses 28. They fit the existing span
    grammar exactly (`text[sidenote]aside[/sidenote]`, body = the aside, attaches at position),
    so they cost zero grammar — added as blessed vocabulary the spec defines, floated in the
    margin by capable renderers, degrading to an inline parenthetical / footnote otherwise.
  - **`{{<blue>}}house{{</blue>}}` (used 104×) is just `[color=blue]house[/color]`** — the post's
    whole conceit ("meaningfully colored text," house always blue, mirroring the book) is native
    Marquee. The 104 repetitions are a real ergonomic note, but a *reusable inline macro* is the
    template-language trap; the answer is an authoring-client snippet/abbreviation, not a language
    feature.
  - **`{{<youtube ID>}}` → a bare YouTube URL (a turbolink).** External rich embeds ride the
    turbolink (rich-link-preview) mechanism; the renderer fetches a summary (OpenGraph) per
    care-modes and shows a player/preview if allowed, else a plain link.
  - **`_italic_` → `*italic*`.** `_` is literal in Marquee (snake_case safety), so existing
    markdown with underscore-emphasis needs a mechanical `_`→`*` pass. The cost of that decision,
    seen on real prose — and still the right call.
  - **`&mdash;` → literal `—`; `<small>` → `[small]`; `<!--more-->` → dropped** (the summary break
    is embedder excerpt/description metadata, and a Marquee comment can't carry it - comments are
    inert by design). No HTML entities (UTF-8 is the charset), no raw HTML.
  - **Front matter → a `:::meta` directive: I was wrong that metadata is purely the embedder's.**
    The Hugo TOML front matter (title/date/tags/description) became a `:::meta` leaf directive.
    Marquee is *standalone*, so a document must be able to self-describe (a `.mq` on a plain
    server has no post record) - and the attribute grammar already *is* a key-value format, so
    document metadata costs zero new parsing (no embedded YAML). Marquee carries it; keys stay
    consumer-defined; a Ringtome import seeds the post record from `:::meta`. The author's
    self-declared `tags` here *seed* the external taxonomy system (NOTES_APP) at import -
    self-description feeding the queryable/curatable structure, not competing with it.
- **Speaker names are metadata, not content — and the "demo from primitives" conceit broke.**
  The first draft put the speaker inside the typewriter span, so the name typewrote letter by
  letter (obviously wrong: a nameplate is instant chrome). The fix is the embedder `:::say`
  directive — speaker/portrait as attrs, utterance as body — and the honest finding is that this
  is *not* mere sugar over an equally-good primitive: only the attr/body split models the data
  correctly (skip-without-losing-the-name, screen-reader order, separate nameplate theming). The
  screenplay primitive (`**Aria:** [typewriter]…`) keeps the name out of the animation but still
  files it as content, so it cannot be styled or reordered as a label. Some structure genuinely
  wants a directive, not a text convention.
