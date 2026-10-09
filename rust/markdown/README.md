# cube-drone-marquee-markdown

Lossy, two-way conversion between [Marquee](https://github.com/cube-drone/marqueemarkup) and
Markdown.

```rust
use marquee_markdown::{to_markdown, to_marquee};

// Marquee in, Markdown out. The rainbow effect has no Markdown; the word stays.
let md = to_markdown("# hello [rainbow]world[/rainbow]\n").expect("a known dialect");
assert_eq!(md, "# hello world\n");

// Markdown in, Marquee out.
let mq = to_marquee("A **bold** claim.\n");
assert!(mq.contains("**bold**"));
```

Both directions pivot on two syntax trees — Marquee's (from
[`cube-drone-marquee-parser`](https://crates.io/crates/cube-drone-marquee-parser)) and
[comrak](https://crates.io/crates/comrak)'s CommonMark AST:

```text
md -> mq:  comrak AST --map--> Marquee tree --serialize--> .mq
mq -> md:  Marquee tree --map--> comrak AST --format--> .md
```

## Neither direction is lossless — and that's the deal

Marquee can say things Markdown can't (color, animation, fonts, sizing, sidenotes, an
eight-deep heading), and Markdown has raw HTML and rich tables Marquee deliberately refuses.
So conversion *degrades* — but it follows the rule Marquee sets for itself: **degrade visibly,
never eat content.** An effect with no equivalent is unwrapped to the text it decorated; the
words always survive.

```rust
use marquee_markdown::to_markdown;

// A stack of effects flattens to its text — nothing is dropped.
let md = to_markdown("[big][color=goldenrod]LOUD[/color][/big]\n").expect("known");
assert_eq!(md, "LOUD\n");
```

## Raw HTML never passes through

Marquee exists so that hosting other people's writing is safe: no raw-HTML passthrough, ever.
Converting *into* Marquee honors that — an HTML block or inline tag becomes **inert visible
text**, its bytes preserved but never executable.

```rust
use marquee_markdown::to_marquee;

let mq = to_marquee("Hi <script>alert(1)</script> there\n");
assert!(mq.contains("alert(1)")); // the bytes survive — as literal characters, not a tag
```

## Dialects: `Strict` vs `Extended`

`Dialect` chooses how much Markdown vocabulary a conversion may use — and it's where a Marquee
**sidenote bridges to a footnote**:

```rust
use marquee_markdown::{to_markdown_with, Dialect, Options};

let mq = "a claim[sidenote]the caveat[/sidenote] stands\n";

// Extended (the default): the sidenote becomes a real Markdown footnote.
let extended = to_markdown_with(mq, &Options::default()).expect("known");
assert!(extended.contains("[^1]"));

// Strict — CommonMark core only — has no footnote, so it flattens in place.
let strict = Options { dialect: Dialect::Strict, ..Default::default() };
assert!(!to_markdown_with(mq, &strict).expect("known").contains("[^"));
```

The bridge runs both ways: a Markdown footnote comes back a Marquee sidenote. Strikethrough
(`~~`) rides the same gate — Extended keeps it, Strict flattens it to plain text.

## Recording what was lost: `OnLoss`

Orthogonal to the dialect, `OnLoss` says what to do with the record of downgrades. `Silent`
(the default) discards it; `Stderr` logs a deduplicated summary; `Comment` tucks the summary
into the document, invisible to readers, in a vehicle that fits the target — a Marquee `%%`
comment, an HTML comment in Extended Markdown, or the pure-CommonMark `[//]: #` idiom (a
never-referenced link that renders to nothing) in Strict:

```rust
use marquee_markdown::{to_markdown_with, OnLoss, Options};

let opts = Options { on_loss: OnLoss::Comment, ..Default::default() };
let md = to_markdown_with("[blink]hi[/blink]\n", &opts).expect("known");
assert!(md.contains("hi")); // the word, visible to the reader
assert!(md.contains("dropped 'blink' span")); // the note, tucked in a comment
```

## Pointing links somewhere else: `link_target`

A Marquee note that links to another note by its web address may need a different address in
the Markdown — the other file's path inside an export, say. `Options::link_target` rewrites
where links and turbolinks point (mq -> md): return `Some(address)` to send a link there, `None`
to keep it as written. The visible text stays the author's, and an embed's target is media,
not a link, so it's left alone.

```rust
use std::sync::Arc;
use marquee_markdown::{to_markdown_with, Options};

let options = Options {
    link_target: Some(Arc::new(|target: &str| {
        let id = target.strip_prefix("https://app.example/note/")?;
        Some(format!("notes/{id}.md"))
    })),
    ..Default::default()
};
let md = to_markdown_with("[see also](https://app.example/note/07)\n", &options).expect("known");
assert_eq!(md, "[see also](notes/07.md)\n");
```

The HTML renderer's `Profile::link_target` is the same hook for rendered pages.

## A note on the name

Your code reads `use marquee_markdown::`; the crate wears the `cube-drone-` prefix on
crates.io only because the registry has no scopes. It builds on `cube-drone-marquee-parser`
(using both its `parse` and `serialize` halves) and pulls in comrak for the Markdown side. The
language spec, the writing guide, and the rest of the toolbox live in
[the repo](https://github.com/cube-drone/marqueemarkup).
