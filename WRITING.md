# Writing Marquee

Marquee is a markup language for pages, posts, notes, and messages: a little bit of markdown, a
little bit of the dumb old internet, on purpose. This guide is for *writing* it. (If you're
implementing it, you want [SPEC.md](SPEC.md); if you're wondering what a construct renders
like, `ts/html_renderer` has a preview tool — see [Previewing your work](#previewing-your-work).)

The one rule that shapes everything: **you cannot break the page.** Anything you type renders.
If you get syntax wrong, the worst outcome is that your characters show up literally.

## Paragraphs and line breaks

Text separated by blank lines forms paragraphs. Single line breaks *inside* a paragraph don't
matter — wrap your lines wherever you like, they render as flowing text:

```
This is one paragraph,
no matter how
I wrap it.

This is a second paragraph.
```

To force a line break *without* starting a new paragraph, end the line with a backslash:

```
Roses are red\
Violets are blue
```

## Headings

One to six `#` characters, then a space, then the heading:

```
# The biggest
## Slightly smaller
###### The smallest
```

Headings take the full inline grammar — emphasis, color, emoji, even effects. A blinking
heading is fair game. (Seven `#`s, or a `#` glued to the text with no space, is just a
paragraph.)

## Emphasis and friends

| you type | you get |
|---|---|
| `*emphasis*` | *emphasis* |
| `**strong**` | **strong** |
| `**both at *once***` | nesting works |
| `~~struck~~` | ~~strikethrough~~ |
| `` `code` `` | inline `code` |

Notes worth knowing:

- **Underscores are just underscores.** `snake_case_names` never italicize. Emphasis is
  asterisks only.
- Three or more asterisks in a row are literal asterisks. A `*` that doesn't pair up renders as
  a visible `*` — no guessing.
- Inline code is verbatim: nothing inside backticks is interpreted. To put a literal backtick
  *inside* code, use more backticks as the fence: ``` ``a ` inside`` ```.
- To show a special character literally, escape it with a backslash: `\*not emphasis\*`,
  `\- not a list`. A backslash before anything other than punctuation is just a backslash.

## Links

```
[the text](https://example.org/page)
[a relative link](../other-page)
```

URLs with parentheses in them (looking at you, Wikipedia) work as-is:
`[hats](https://en.wikipedia.org/wiki/Hat_(disambiguation))`. If a target needs a space or an
unmatched `)`, percent-encode it (`%20`, `%29`) — the standard URL spelling.

## Media embeds

One syntax for images, audio, and video — the file's type decides what it becomes:

```
![a description of the picture](photo.jpg)
![the demo song](song.mp3)
![trailer](https://example.org/trailer.mp4)
```

The description in the brackets matters: it's what screen readers speak and what appears when
the media can't be shown. A client that can't play a format shows a labeled link instead —
nobody gets a broken page.

## Turbolinks (rich link previews)

Paste a full URL alone in its own paragraph and it becomes a *turbolink* — a link the reader's
client may enrich into a preview card (title, description, image), like a onebox or an unfurl:

```
Look at this:

https://example.org/interesting-post
```

Only full `scheme://` URLs get this treatment — a bare word alone in a paragraph is just a
word. For a relative link or a pinned document, use the explicit form:

```
:::turbolink target=../two-floors-up level=title:::
```

`level` is `full`, `title`, or `bare`. Whether a preview is actually fetched is up to the
reader's client and privacy settings; a turbolink always degrades to a plain link.

## Emoji

```
It's :sparkles: like this :tophat:
```

A shortcode is lowercase letters, digits, `_`, `+`, `-` between two colons. Which shortcodes
resolve depends on where you're posting (standard tables, community custom emoji); an unknown
one renders as the literal `:text:`, exactly like every chat app you've used. Regular typed
emoji (🎩) are just text and need no syntax. Times like `3:30` are safe — one colon never
triggers anything.

## Spans: typography and effects

Spans are BBCode-shaped: `[name]...[/name]`, explicitly closed, nestable. This is where the
fun lives.

**Typography:**

| span | effect |
|---|---|
| `[sup]2[/sup]` | superscript |
| `[sub]2[/sub]` | subscript |
| `[small]fine print[/small]` | smaller text |
| `[color=goldenrod]shiny[/color]` | colored text — a CSS color name or hex (`#f06`, `#ff0066`) |
| `[sidenote]a witty aside[/sidenote]` | a margin note — floats beside the text on wide screens, becomes a parenthetical on narrow ones |

**Effects** (animated — readers with reduced-motion settings see calm static text, always):

| span | effect | knobs |
|---|---|---|
| `[marquee]...[/marquee]` | scrolling text, the classic | `direction=right`, `speed=2` |
| `[blink]...[/blink]` | blinks | `rate=2` |
| `[rainbow]...[/rainbow]` | color-cycles | |
| `[bounce]...[/bounce]` | bounces | |
| `[jitter]...[/jitter]` | nervous energy | |
| `[wave]...[/wave]` | gentle undulation | |
| `[typewriter]...[/typewriter]` | types itself out (on clients with scripting; otherwise appears whole) | `speed=30` |

Effects nest freely — `[marquee][blink]still open at 3am[/blink][/marquee]` is not an edge
case, it is the point. (Nesting is capped at 8 deep, which is already deeper than taste.)

An unclosed span, or a closer that doesn't match, renders as literal text — you'll see the
`[blink]` on the page and know exactly what to fix. Unknown span names render their contents
as plain text: your words always survive.

## Lists

```
- unordered
* also unordered (same thing)
+ also the same

1. ordered
2. the numbers you type don't matter —
1. the renderer counts for you
```

Nest by indenting two spaces (three or four also work — sloppy markdown habits are forgiven):

```
- outer
  - inner
    - deeper
```

To put more than one paragraph — or an image — inside an item, indent it to line up with the
item's text:

```
- first item

  still the first item, second paragraph

  ![indented, so it stays in the bullet](pic.png)

- second item
```

Anything at the start of the line (column 0) that isn't a list item ends the list. For
ordered lists that means numbering restarts — if you see `1. 2. 1.` on the page, that's the
signal you left the list by accident (usually an unindented line in the middle).

## Quotes

Every quoted line carries its `>`:

```
> The whole quote is marked,
> line by line.
```

An unmarked line is *outside* the quote — there's no markdown-style lazy continuation. Nest
with `> >`.

## Code blocks

````
```python
for hat in attic.hats():
    print(hat.vibe)
```
````

The word after the opening fence (the language) is optional and only used for syntax
highlighting where available. Everything inside a fence is raw — Marquee syntax in a code
block is just text. Need to show literal triple-backticks? Use a longer fence (four or more)
around them. An unclosed fence runs to the end of the document rather than erroring.

## Comments

```
%% notes to self — readers never see this
%% consecutive comment lines merge into one comment
```

Comments are invisible to readers but **not secret**: they travel with the document's bytes,
and view-source is real. Thirty years of leaked HTML comments are the cautionary tale — write
accordingly. (Some hosts strip comments at publication; standalone files keep them, exactly
like HTML.)

## Horizontal rule

`---` alone on a line (exactly three dashes). Four dashes, or three-plus-anything, is prose.

## Directive blocks: `:::`

Directives are Marquee's big-structure mechanism — metadata, page layout, widgets. The shape:

```
:::name key=value other="quoted value"
  ...content...
:::
```

- `:::name attrs` opens; a `:::` line closes the nearest open block.
- A close may name its block for readability: `::: section`.
- A directive with no content closes itself on one line: `:::counter theme=retro:::`
- Forgot a closer? Blocks auto-close at the end of the document — the effect may land wrong,
  but your words all render.

**Attribute rules** (the one strict corner of the language): keys are lowercase
(`key=value`, no spaces around the `=`); values with spaces need double quotes; inside quotes,
write `\"` for a quote and `\\` for a backslash. A malformed directive shows a small "invalid
markup" placeholder instead of taking effect — visible, never destructive.

### Document metadata

```
:::meta title="The Great Hat Migration" date=2031-04-01 tags="hats, migration":::
```

Self-describes a standalone document — title, date, whatever keys your tools care about.
Multiple `:::meta` blocks merge; if a key repeats, the first one wins. Renders nothing.

### Pages, sections, and layout

A plain document needs none of this — most notes and posts are just text. A *fancy* page opts
in:

```
:::page layout=two-column-nav-footer scheme=noir
:::section slot=nav
# My Cozy Corner
:::
:::section slot=main
The main content.
:::
:::section slot=right
A sidebar.
:::
:::section slot=footer
webring stuff
::: section
:::
```

**Layouts** (you pick one; you don't invent them): `basic`, `nav-footer`,
`two-column-nav-footer`, `three-column-nav-footer`.

**Slots** by layout: `nav`, `main`, `footer` everywhere; `right` in two-column; `left` and
`right` in three-column. Each slot claimed once.

**Schemes** are named looks — set one and the colors/fonts follow: `noir`, `terminal`,
`parchment`, `hotdog-stand` (the list grows). Individual knobs refine a scheme:
`:::section scheme=parchment color=#7a4a12` — style knobs are `color`, `background`, `scheme`.
A section without a slot is just a styled container, usable anywhere.

There are no font-size sliders, no pixel positioning, no CSS. Layout is picked, not authored —
that's what keeps every Marquee page readable on every client.

### Includes, widgets, and computed content

These depend on **where you're posting** — they're implemented by the host, and on a host that
doesn't know them you'll see a labeled placeholder box (your page still renders):

```
:::include doc=shared-nav:::           re-use one nav across your pages
:::counter theme=retro:::              hit counter
:::webring ring=spooky-comics:::       webring navigation
:::guestbook:::                        sign it
:::construction:::                     🚧
```

The placeholder isn't an error — it's the deal that lets new widgets appear without old
clients breaking. Check your host's documentation for its widget list.

## Coming from markdown?

Most of your habits transfer. The deliberate differences:

| markdown habit | in Marquee |
|---|---|
| `_italics_` | `*italics*` — underscores are always literal |
| `Setext` headings (`===` underlines) | `#` headings only |
| reference links `[text][1]` | inline `[text](target)` only |
| indented code blocks | fenced ``` blocks only |
| lazy quote continuation | every quoted line needs its `>` |
| raw HTML `<b>`, `<br>`, `&mdash;` | renders as the literal characters — type **bold** with `**`, break with trailing `\`, type — directly (it's all UTF-8) |
| `| tables |` | not yet — the name is reserved for a future version |
| `1)` ordered lists | `1.` only |

## Limits (you will not hit these by accident)

Lists, quotes, and inline nesting cap at 8 levels; directive nesting at 4; URLs at 2048 bytes;
attribute values at 1024 bytes. Past a cap, content degrades to visible literal text — the
same never-break rule as everywhere else.

## Previewing your work

From `ts/html_renderer/` in this repository:

```
npm run preview -- path/to/your-file.mq > preview.html
```

Open `preview.html` in a browser. Add `--bare` to see the strictest possible client instead
(placeholders and literal shortcodes on display) — worth doing once to see how gracefully your
page degrades.

## Declaring the dialect

A standalone `.mq` file may begin with `#!marquee 0` on line 1 — it declares which version of
the language you wrote. It's optional (undeclared means version 0) and never renders. Hosts
that manage documents for you handle this themselves.
