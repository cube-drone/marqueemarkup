# cube-drone-marquee-html-import

Best-guess conversion from untrusted HTML — an RSS item, a scraped article, a pasted
fragment — to [Marquee](https://github.com/cube-drone/marqueemarkup).

```rust
use marquee_html_import::{to_marquee_with, Options};

let html = r#"<p>Read <a href="/next">the <b>next</b> post</a>.</p>
              <img src="/cat.jpg" alt="a cat"><script>steal()</script>"#;
let options = Options { base_url: Some("https://blog.example/2026/post".into()), ..Default::default() };

assert_eq!(
    to_marquee_with(html, &options),
    "Read [the **next** post](https://blog.example/next).\n\n![a cat](https://blog.example/cat.jpg)\n",
);
```

One direction only. Marquee-to-HTML is the renderer's job
([`cube-drone-marquee-html-renderer`](https://crates.io/crates/cube-drone-marquee-html-renderer));
this crate exists so that HTML you don't trust can be shown through it.

## Where the safety comes from

This is **not an HTML sanitizer**, and it doesn't need to be one. Its output is Marquee
source, and Marquee can't express anything executable: no raw HTML, no attributes, no CSS.
That source is rendered like any other Marquee document, and the embedder profile decides
which URL schemes resolve. So the renderer is the security boundary, and this crate only
has to emit valid Marquee.

The crate still takes a conservative line of its own:

- **Allowlist mapping.** Only known elements become Marquee nodes, and only `href`, `src`,
  `alt` (plus a few lazy-loading source attributes) are ever read. Classes, styles and event
  handlers are never looked at, except to spot a code block's language and hidden elements.
- **Unknown elements unwrap.** Their formatting goes and their text stays: degrade
  visibly, never eat content.
- **Non-prose is dropped with its content:** `<script>`, `<style>`, `<svg>`, form controls,
  `<object>`, hidden elements.
- **Web schemes only:** links may be `http:`, `https:` or `mailto:`; media `http:` or `https:`.
  Anything else (`javascript:`, `data:`, …) unwraps to its text. Relative references resolve
  against `base_url`, or stay relative without one.

```rust
use marquee_html_import::to_marquee;

let out = to_marquee(r#"<a href="javascript:alert(1)" onclick="x">click</a><img src="javascript:x" onerror=alert(1)>"#);
assert_eq!(out, "click\n");
```

The test suite renders the output of a hostile tag-soup fuzzer through the reference
renderer and checks the HTML that comes out: no script-ish elements, no event handlers, no
`javascript:`/`data:` URLs.

## What it maps

| HTML | Marquee |
|---|---|
| `p`, `div`, `section`, `article`, … | paragraph flow; loose text becomes paragraphs |
| `<br><br>` / `<br>` | paragraph break / hard break |
| `h1`–`h6`, `blockquote`, `ul`/`ol`/`li`, `hr` | the matching prose block |
| `pre` (with `class="language-x"`) | fenced code block with info string |
| `em`/`i`, `strong`/`b`, `s`/`del`, `code` | `*…*`, `**…**`, `~~…~~`, `` `…` `` |
| `sup`, `sub` | `[sup]…[/sup]`, `[sub]…[/sub]` |
| `a href` | link (fragment-only `#…` links unwrap) |
| `img`, `video`, `audio` | `![alt](src)` embed |
| `iframe` | turbolink (YouTube/Vimeo players point back at their watch page) |
| data `table` | `:::table` with `[c]` cells and `header=` detected from `<th>` |
| layout `table` (one column, or cells holding block structure) | its content, unwrapped |

Feed-shaped cleanups: tracking pixels (≤ 1px) are dropped, lazy-loaded images find their
real source (`data-src`, `srcset`), and emoji images (`wp-smiley`) become their character.

## Formatting Marquee can't spell

HTML can describe formatting Marquee's grammar can't write down. `<b>a</b><b>b</b>` side by
side would spell `**a****b**`, and `<em><strong>x</strong></em>` would spell `***x***`.
Both of those read as literal asterisks. The converter merges or drops the inner formatting
in these cases. As a backstop, every top-level block is serialized and parsed back, and a
block that doesn't come back identical has its emphasis flattened. The final output is
always in canonical form (`serialize(parse(out)) == out`).

## Recording what was lost

`OnLoss` works as in `cube-drone-marquee-markdown`: `Silent` (the default), `Stderr`,
`Comment` (a `%%` comment in the document) or `Both`. [`convert`] returns the deduplicated
summary whatever `OnLoss` says, so a server can log it:

```rust
use marquee_html_import::{convert, Options};

let c = convert("<p>hi</p><script></script><script></script>", &Options::default());
assert_eq!(c.marquee, "hi\n");
assert_eq!(c.losses, vec!["2× dropped <script>"]);
```

## Limits

Nesting deeper than 200 DOM levels is flattened to its text, which keeps the stack and the
work bounded. The HTML parser (html5ever) is itself quadratic in nesting depth:
50,000 nested `<div>`s take seconds to parse. So cap the size of the input you accept,
as you would for any parser fed by strangers.
