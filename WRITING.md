# Writing Marquee

Marquee is a markup language for pages, posts, notes, and messages: a little bit of markdown, a
little bit of the dumb old internet, on purpose. This guide is for *writing* it. (If you're
implementing it, you want [SPEC.md](SPEC.md); if you're wondering what a construct renders
like, `ts/marquee-html-renderer` has a preview tool — see [Previewing your work](#previewing-your-work).)

The one rule that shapes everything: **you cannot break the page.** Anything you type renders.
If you get syntax wrong, the worst outcome is that your characters show up literally.

This guide has a live twin: [WRITING.mq](WRITING.mq) demos everything described below in one
previewable document — including a deliberate mistake, so you can see what "wrong" looks like.

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

You don't need a blank line to *start* most blocks: a list, heading, quote, or fence begins
even when jammed directly against a paragraph's last line — `Here's my list:` followed
immediately by `- one` works, markdown-style. (Escape the leading character, `\- like this`,
to keep such a line inside your prose.)

## Headings

One to eight `#` characters, then a space, then the heading:

```
# The biggest
## Slightly smaller
###### Small
######## The smallest (HTML stops at six; Marquee lets you get lost in the weeds)
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

To size media, wrap embeds in a `:::media` block — its knobs apply to every embed inside it:

```
:::media width=200 height=300
![a thumbnail](photo.jpg)
:::

:::media width=full
![the demo song](song.mp3)
:::
```

`width` and `height` take exact pixels (`200`) or a size token (`small`, `medium`, `large`,
`full`). Set one dimension and the media scales to it, keeping its own aspect ratio — any
shape works. Set both and you're authoring a frame the media fills, cropped to fit, never
squashed. That's the whole sizing vocabulary — there's no unit soup and no positioning; an
invalid value just means natural size.

And because embeds are *inline*, several images sharing one paragraph flow side by side and
wrap like words — a photo gallery is just a paragraph of pictures inside one `:::media`
sizing block. No gallery element needed.

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

`level` is `full`, `title`, or `bare`. What a turbolink *becomes* is up to your host's link
expanders — an image link unfurls into the picture, an mp3 into play controls, a YouTube link
into a playable embed, and hosts add their own kinds. Whether anything is fetched is up to
the reader's client and privacy settings; a turbolink always degrades to a plain link.

## Emoji

```
It's :sparkles: like this :tophat:
```

A shortcode is lowercase letters, digits, `_`, `+`, `-` between two colons. Which shortcodes
resolve depends on where you're posting (standard tables, community custom emoji); an unknown
one renders as the literal `:text:`, exactly like every chat app you've used. A custom emoji
is a little image the host maps to a slug — it gets worn at character size, right in the
line, and degrades back to the literal `:slug:` anywhere it can't be shown. Regular typed
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
| `[big]a step up[/big]` | bigger text — small's mirror |
| `[size=6]the dial[/size]` | the classic seven-step size scale, `1`–`7` (`3` is normal) |
| `[teeny]` `[tiny]` `[huge]` `[enormous]` | named rungs of that dial (1, 2, 6, 7) — unnecessary given the numbers, and yet |
| `[font=orbitron]...[/font]` | a typeface from the closed list below (also a knob on pages and sections: `:::section font=vt323`) |
| `[color=goldenrod]shiny[/color]` | colored text — a CSS color name or hex (`#f06`, `#ff0066`) |
| `[sidenote]a witty aside[/sidenote]` | an aside: a numbered mark at the spot, the note itself set small and italic just below the paragraph. `[aside]` and `[footnote]` mean exactly the same thing — grab whichever word your fingers find |

**The font list** — a closed menu, picked not uploaded, so every page renders everywhere.
Four standard stacks: `sans`, `serif`, `mono`, `comic`. And the grab bag (freely-licensed
faces your host serves itself):

| vibe | names |
|---|---|
| clean sans | `radio-canada`, `atkinson-hyperlegible`, `lexend`, `quicksand` |
| serif & slab | `playfair-display`, `cormorant`, `zilla-slab` |
| old book & gothic | `im-fell-english`, `uncial-antiqua`, `unifraktur` |
| mono & terminal | `jetbrains-mono`, `vt323`, `major-mono`, `special-elite` |
| pixel | `press-start`, `silkscreen`, `bitcount` |
| display & neon | `orbitron`, `audiowide`, `bungee`, `monoton`, `creepster` |
| loud & weird | `kablammo`, `oi`, `henny-penny`, `rye` |
| script & hand | `lobster`, `pacifico`, `caveat`, `fredericka`, `comic-neue` |

A name not on the list (or a face that hasn't loaded) degrades to a sensible fallback —
readable always, never blank.

**Effects** (animated — readers with reduced-motion settings see calm static text, always):

| span | effect | knobs |
|---|---|---|
| `[marquee]...[/marquee]` | scrolling text, the classic | `direction=right`, `speed=2` |
| `[blink]...[/blink]` | blinks | `rate=2`, `by=letter/word` (ramp = theater chase lights, `phase=scatter` = twinkle) |
| `[rainbow]...[/rainbow]` | color-cycles | `by=letter/word`, `phase=scatter/ramp` |
| `[bounce]...[/bounce]` | bounces | `by=letter/word`, `phase=scatter/ramp` |
| `[jitter]...[/jitter]` | nervous energy | `by=letter/word`, `phase=scatter/ramp` |
| `[wave]...[/wave]` | gentle undulation | `by=letter/word`, `phase=scatter/ramp` |
| `[rubber]...[/rubber]` | squash-and-stretch, oscillating between small and big | `by=letter/word`, `phase=scatter/ramp` |
| `[typewriter]...[/typewriter]` | types itself out, letter by letter — pure CSS, no scripting needed | `speed=30` (letters per second), `by=word` (word-at-a-time), `phase=scatter` (materialize in scrambled order) |
| `[fadein]...[/fadein]` | a ghostly fade-in (whole run at once by default) | `by=letter/word` (staggered drift-in), `speed=16`, `phase=scatter` (apparition weather) |

`by=letter` gives each letter its own offset cycle — `[rainbow by=letter]` is the classic
every-letter-its-own-hue gradient, `[wave by=letter]` a true undulating ripple. `by=word`
does the same word by word. Offsets sweep smoothly by default (jitter scatters instead);
`phase=scatter` scrambles any effect and `phase=ramp` smooths any, so confetti rainbows and
rippling shudders are both on the menu. Best at headline scale: every letter becomes its own
moving part.

Effects nest freely — `[marquee][blink]still open at 3am[/blink][/marquee]` is not an edge
case, it is the point. (Nesting is capped at 16 deep, which is already deeper than taste.)

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

## Where indentation matters

Exactly one place: **lists**, as above — two spaces per nesting level, and content indented
to an item's column belongs to that item (which is also why an indented fence or image works
*inside* a bullet).

Everywhere else, indentation is just text. Block constructs — headings, `:::` lines, code
fences, `>`, `%%`, `---` — only count at the very start of the line, so don't pretty-print
directive bodies with indents: an indented `# heading` renders as the literal characters, and
an indented `:::` closes nothing. Keep directive bodies flat; when deep nesting gets hard to
read, the tool is named closers, not whitespace.

(Wrapped *prose* lines are the exception in the other direction: indent paragraph
continuations however you like — soft line breaks swallow the surrounding spaces.)

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
like HTML.) Need a paragraph line that literally starts with `%%`? Escape it: `\%%`.

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
- **A closer can name what it closes**: `::: section` (note the space — `:::name` opens,
  `::: name` closes). Two things this buys you in deeply nested pages:

  ```
  :::page layout=nav-footer
  :::section slot=main
  the content
  ::: section     ← readable: no counting fences
  ::: page
  ```

  First, readability — the closers document themselves. Second, a safety net: if a named
  closer doesn't match the innermost open block, you get a small "invalid markup" box *at
  that exact line*, instead of discovering three sections later that everything nested
  wrong. Bare `:::` closers never complain; named ones check their work.
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
`right` in three-column. Each slot claimed once; slots you don't claim simply collapse.

**Schemes** are named looks — set one and the colors/fonts follow: `noir`, `terminal`,
`parchment`, `hotdog-stand` (the list grows). Individual knobs refine a scheme:
`:::section scheme=parchment color=#7a4a12` — style knobs are `color`, `background`, `scheme`,
`font`. Styling flows down by containment: everything inside a schemed page inherits its
look, and whichever knob is set *closest* wins — that's the entire cascade. A section without
a slot is just a styled container, usable anywhere.

**Backgrounds** take a color (`background=navy`) or — the early web's crowning glory — a
**tiled image**: `background=tile:stars.gif`. Any image target works (relative, `https:`,
pinned `blob:`), subject to the same host media policy as an embed; if the host won't fetch
it, you get no wallpaper and your words carry on. Yes, this means you can tile something
truly horrifying back there. We know. That's the point.

**Alignment** is its own tiny container: wrap anything in `:::center` (yes — the `<center>`
tag, reborn) and it centers: text, headings, images, whole tables. `:::right` aligns right,
and `:::left` exists to un-align a block *inside* the other two:

```
:::center
![the logo](logo.png)

Everything in here is centered.
:::
```

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

## Tables

A table is a `:::table` block. Each paragraph inside it is a row; each `[c]...[/c]` span is a
cell. The blank line between rows is just the ordinary paragraph break:

```
:::table header=row
[c]dish[/c]                    [c]price[/c]

[c]*Spaghetti* al Limone[/c]   [c]$12[/c]

[c]Linguine alle Vongole[/c]   [c]$18[/c]
:::
```

- `header=row` makes the first row header cells; `header=column` the first cell of each row;
  `header=both` both. Headers come out bold *and* carry real header semantics for screen
  readers — that's why it's an attribute instead of "just bold the top row."
- Cells take the full inline grammar: emphasis, color, emoji, links, images, even effects.
- Spacing between cells is yours — line the source up into columns for the plaintext reader,
  or don't; it renders the same.
- There is deliberately no way to put a table inside a table.

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
| `| tables |` | `:::table` with `[c]cell[/c]` spans — see Tables (no pipe alignment, ever again) |
| `1)` ordered lists | `1.` only |

## Limits (you will not hit these by accident)

Lists, quotes, and inline nesting cap at 16 levels; directive nesting at 8; URLs at 4096 bytes;
attribute values at 2048 bytes; emoji shortcodes at 64 characters. Past a cap, content
degrades to visible literal text — the same never-break rule as everywhere else.

One renderer-side limit of the same flavor: per-letter effects (`by=letter`, `by=word`) wrap
each unit in its own element, so runs are capped — 400 units for the looping effects (each
unit animates forever; that's headline scale, on purpose), 2000 for `[typewriter]` (its
letters animate once and go quiet, and long dramatic reveals are the whole point). Past the
cap the run still renders and still animates — just as one piece instead of per-letter.
Nothing is ever hidden or lost.

## Previewing your work

From `ts/marquee-html-renderer/` in this repository:

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
