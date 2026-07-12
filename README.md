# Marquee (Markup)

[![ci](https://github.com/cube-drone/marqueemarkup/actions/workflows/ci.yml/badge.svg)](https://github.com/cube-drone/marqueemarkup/actions/workflows/ci.yml)

Marquee is a markup language! 

It's designed to a mash-up of Markdown, BBCode, RST, and the old web. 

## Why Wouldn't I Just Use Markdown?

Sheer vibes. Stubborn nostalgia. And, secretly? _Draconian control_.

Marquee is much more regular and deterministic than Markdown.

Do you want a format that's safe to send from user to user in an untrusted
system, while still being weird and loud and colorful? 

Marquee does not allow inline HTML to pass through: you get what you get.
The AST is sealed up, tight as a drum.

That's what Marquee is designed for: the intersection between safety and 
hot piles of clown nonsense.

Safe. Clown. Nonsense.

Markdown is still more widely used (for NOW).

But Marquee is for building Geocities.

## Why Wouldn't I Just Use HTML?

The security problem with Markdown is partially that it _can include HTML_.

HTML is _guaranteed to include HTML_, and proving that HTML is safe is hard.


## Writing Marquee

A more in-depth "writing" document is available [here](./WRITING.md), but 
this will get you started:


```
# Header 1
## Header 2
### Header 3

*italics*
**strong**

* list
* list
  * list in a list
    * list in a list in a list

1. list
2. list
3. list

%% comment (you can't see this)

  %% a lot of Marquee's tags can't survive 
  %% any space between them and the beginning 
  %% of the line, this comment is invalid (and visible)

[link](https://example.org)
![image](https://example.org/fart.gif)
![zounds, it's sounds](https://example.org/fart.mp3)

standalone links expand into content: 

https://www.youtube.com/watch?v=kiTpHaShznE

Text can be sized: 

* [miniscule]miniscule[/miniscule]
* [tiny]tiny[/tiny]
* [small]small[/small]
* [big]big[/big]
* [huge]huge[/huge]
* [enormous]ENORMOUS[/enormous].

Superscripted or subscripted: 

* E = mc[sup]2[/sup], 
* H[sub]2[/sub]O, 

Colored: 

* [color=goldenrod]color by name[/color]
* [color=#f06]color by hex[/color]

Footnote-style asides[sidenote]like this one [/sidenote] that never interrupt
the sentence, they just show up later.

[font=press-start]Fonts, but they come from a pre-defined list?[/font].

* [blink]blink[/blink]
* [rainbow]rainbow[/rainbow]
* [bounce]bounce[/bounce]
* [jitter]jitter[/jitter]
* [wave]wave[/wave]
* [typewriter speed=30]typewriter[/typewriter]

Nested animations: [marquee][blink][rainbow]still open at 3am[/rainbow][/blink][/marquee]

* [rainbow by=letter]EVERY LETTER ITS OWN HUE[/rainbow] ·
* [wave by=letter]a true undulating wave[/wave] ·
* [bounce by=word]each word takes its turn[/bounce] ·
* [jitter by=letter]scattered nerves[/jitter]

Code:

````
```
for hat in attic.hats():
    print(hat.vibe, hat.dampness)
```
````

You can also `inline code` like `this`. 

Quotes:

> Every line of the quote is marked,
> line by line — you need to include
> the `>` symbol on every line.

```


## Getting Started

There are a lot of ways to use Marquee, but the most obvious one is this:

Get it from npm. (Have npm installed, obviously.)

```
npm install @cube-drone/marquee-markup
```

Write a script to convert .mq into html:

```ts
import { marquee } from "@cube-drone/marquee-markup";
import { readFileSync, writeFileSync } from "node:fs";

writeFileSync("hello.html", marquee(readFileSync("hello.mq", "utf8")));
```

`marquee(source)` parses, renders, styles, inlines exactly the
fonts the page wears, and hands back a self-contained HTML page. Or use the CLI:

```
npx marquee hello.mq > hello.html     one self-contained page
```

More docs live [here](./ts/marquee-markup/README.md).


## Repository layout

This is a monorepo: the spec, the conformance vectors, and every reference implementation
version together, because they are one conformance unit. The implementations publish
piecemeal as public infrastructure — npm: `@cube-drone/marquee-parser`,
`@cube-drone/marquee-html-renderer`, `@cube-drone/marquee-turbolink`; crates.io:
`cube-drone-marquee-parser` and `cube-drone-marquee-html-renderer` (crates.io has no scopes, so
the registry names wear the cube-drone prefix while the code stays `use marquee_parser`) — and
downstream embedders consume them through the public registries like
anybody else. The TypeScript side is an npm workspace: `npm install` once at the root,
`npm test` runs every package.

- `WRITING.md` — **start here to write Marquee**: the authoring guide, every tag with examples
  (`WRITING.mq` is its live twin — preview it to see everything running)
- `SPEC.md` — the language specification (grammar, AST contract, conformance rules)
- `examples/` — hand-written `.mq` documents; the ergonomics testbed and vector seed corpus
  (`examples/borsalino/` is a complete little website with shared nav/footer, built via
  `npm run marquee -- examples/borsalino /tmp/borsalino`)
- `vectors/` — published conformance vectors (`*.json`, input → exact AST); see `vectors/README.md`
- `rust/parser/` — reference parser, Rust (`cargo test` runs the vectors; `cargo run --bin bless` grows them)
- `rust/html_renderer/` — reference static HTML renderer, Rust: same class contract and Profile
  socket as the TypeScript renderer, its own behavioral suite and self-goldens
  (`cargo run --bin bless` re-blesses)
- `rust/markup/` — **the batteries-included omnibus, Rust spelling**: `marquee()` → a complete
  page, `build_site()` → a website, the `marquee` CLI (same flags as npm's), turbolink plugins,
  with the stylesheet/fonts/emoji table *embedded* — lockstep tests pin the embedded copies to
  the npm packages byte-for-byte
- `ts/parser/` — reference parser, TypeScript (`npm test` runs the same vectors; `npm run check` typechecks)
- `ts/html_renderer/` — reference static HTML renderer (fragment out, embedder policy via `Profile`;
  behavioral suite encodes the spec's renderer obligations, self-goldens catch regressions)
- `ts/marquee-turbolink/` — pluggable turbolink rendering: link expanders as plugins (YouTube, Spotify, media,
  OpenGraph-fetch-ahead), composed by the embedder into `Profile.turbolink`; each plugin declares the
  CSS for the markup it emits, and `turbolinkStyles()` collects the composed chain's skins into one artifact
- `ts/marquee-turbolink-example-plugin/` — the worked example for plugin authors, paired with the
  "Writing a plugin" guide in `ts/marquee-turbolink/README.md`
- `ts/marquee-css/` — the reference stylesheet as a package: the `mq-*` class contract renderers
  target, effects under `prefers-reduced-motion`, layouts, schemes (file + string export)
- `ts/marquee-fonts/` — the 31-face grab bag as an *optional* package: `externalFontFaces()` for
  hosted files, `inlineFontFaces()` for self-contained base64 pages; without it every font name
  degrades to its fallback stack
- `ts/marquee-emoji/` — gemoji's standard shortcode table repackaged (`:sparkles:` → ✨);
  dependency-free, loaded implicitly by the omnibus
- `ts/marquee-markup/` — **the batteries-included omnibus and the place to start**:
  `marquee(source)` → a complete page, `buildSite(dir, out)` → a website, the `marquee` CLI,
  everything underneath re-exported
- `editors/vscode-marquee/` — VS Code syntax highlighting: the TextMate grammar (the canonical
  machine-readable "what Marquee looks like", reusable by Shiki and friends), held to a
  scope-assertion test suite that runs with the workspace tests
- `editors/vim-marquee/` — vim/neovim syntax file (line-level exact, inline approximate)
- differential fuzzer — `cargo run --release --bin diff_fuzz` (in `rust/parser/`, needs `node` on PATH):
  seeded generated documents through both parsers, identical ASTs demanded; found its first real bug
  within 40k documents

Renderers land beside the parsers as they come (`rust/html_renderer`, `ts/html_renderer`,
`ts/preact_interactive_renderer`, ...): one parser per language, many renderers, per the
"parsers may never differ, renderers may" contract in the spec.
