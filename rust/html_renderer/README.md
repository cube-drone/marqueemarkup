# cube-drone-marquee-html-renderer

The reference Rust static HTML renderer for
[Marquee](https://github.com/cube-drone/marqueemarkup). It takes Marquee — either source text
or an already-parsed tree — and produces an HTML **fragment**: a `<div class="mq-doc">…</div>`
you drop into a page. It doesn't build whole pages or inline stylesheets; that's
[`cube-drone-marquee-markup`](https://crates.io/crates/cube-drone-marquee-markup), which wraps
this crate with the CSS, fonts, and a CLI.

## Rendering

```rust
use marquee_html_renderer::{render_marquee, BareWebProfile};

let html = render_marquee("[go](https://example.org)\n", &BareWebProfile)
    .expect("a known dialect");
assert_eq!(html, r#"<div class="mq-doc"><p><a href="https://example.org">go</a></p></div>"#);
```

The output is a fragment, not a document — it carries no `<style>` and no `<html>` shell. It's
styled entirely by the shared `mq-*` class contract, so it needs `marquee.css` on the page
(ships with the `marquee-markup` crate, or as `@cube-drone/marquee-css` on npm). Animations
are best-effort CSS and honor `prefers-reduced-motion`; there is no JavaScript in the output.

## Rendering from a tree

Already have an AST — from the parser, or one you built yourself? Render it directly with
`render`, skipping the reparse. (This is the infallible half: a tree is already valid, so
there's no `Result`.)

```rust
use marquee_parser::parse;
use marquee_html_renderer::{render, BareWebProfile};

let doc = parse("*hi* :sparkles:\n").expect("a known dialect");
let html = render(&doc, &BareWebProfile);
assert!(html.contains("<em>hi</em>"));
```

The parser makes trees; this crate turns them into HTML. `render_marquee` is just `parse` then
`render` for the common case where you start from source.

## XHTML, for an ePub

The default output is HTML5, for a web page. A page that must be well-formed XML — an ePub
chapter, any XHTML document — asks for `Output::Xhtml`: void elements close themselves
(`<br/>`, `<img …/>`), boolean attributes carry values (`controls="controls"`), the only
entities are XML's own five, and characters XML forbids outright (most C0 controls) become
U+FFFD. Same elements, same classes, same words.

```rust
use marquee_html_renderer::{render_marquee_with, BareWebProfile, Output};

let page = render_marquee_with("one\\\ntwo\n", &BareWebProfile, Output::Xhtml)
    .expect("a known dialect");
assert_eq!(page, r#"<div class="mq-doc"><p>one<br/>two</p></div>"#);
```

`render_with(&doc, profile, output)` is the tree form. The renderer places what your profile's
`directive`, `span`, and `turbolink` return as given, so a profile used with `Output::Xhtml`
must return XHTML too.

## Profiles: you define the policy

The second argument is a `Profile` — your rules for the fuzzy, embedder-specific decisions:
which URL schemes may link, how a media target becomes an image vs. audio vs. video, what
emoji shortcodes resolve to, how bare links expand, and whether any custom directives or spans
render. Every method on the trait has a default, and those defaults *are* the "bare web"
policy — which is all `BareWebProfile` is (`impl Profile for BareWebProfile {}`, nothing
overridden). To change one thing, override one method:

```rust
use marquee_html_renderer::{render_marquee, Profile};

// Allow only https links; everything else degrades to plain text.
struct HttpsOnly;
impl Profile for HttpsOnly {
    fn link_allowed(&self, target: &str) -> bool {
        target.starts_with("https://")
    }
}

let html = render_marquee("[safe](https://ok.example)\n", &HttpsOnly)
    .expect("a known dialect");
assert!(html.contains(r#"href="https://ok.example""#));
```

`link_allowed` decides *whether* a target links; `link_target` decides *where* it points. Return
`Some(address)` to send an allowed link somewhere else — another note's chapter inside an ePub,
a file inside an export — and `None` to keep the target as written. It's asked for every anchor
the renderer draws from an author target (links, turbolinks, an embed's fallback link), only
after `link_allowed` says yes, and the visible text stays what the author wrote:

```rust
use marquee_html_renderer::{render_marquee, Profile};

struct Book;
impl Profile for Book {
    fn link_target(&self, target: &str) -> Option<String> {
        let id = target.strip_prefix("https://app.example/note/")?;
        Some(format!("chapter-{id}.xhtml"))
    }
}

let html = render_marquee("[see also](https://app.example/note/07)\n", &Book)
    .expect("a known dialect");
assert!(html.contains(r#"<a href="chapter-07.xhtml">see also</a>"#));
```

Custom vocabulary goes through `directive()` and `span()` — the span is the inline twin of the
directive (`[user id=x]Name[/user]` beside `:::user id=x:::`). They are called by more than
this renderer (an editor's live preview probes them to decide what to draw whole), so they
carry a contract, spelled out on the trait and in the spec: claim on name and attrs alone
(a probe with empty children must answer the same), stay pure and fetchless, and always place
the rendered children in the output.

## What the renderer guarantees

- **Safety is structural, not vigilance.** Author bytes reach the output only through escaping,
  link targets only through the profile's scheme allowlist, and unknown vocabulary shrugs
  visibly rather than erroring. Content is never eaten — an effect may fail to *do* its thing,
  but it never swallows your words. These obligations come from the spec, not from vibes.
- **No JavaScript, ever.** Effects are CSS, they respect `prefers-reduced-motion`, and reveals
  can't hide text on readers where animations don't run.
- **Renderers may differ in fanciness; parsers may never differ in structure.** This is a
  faithful port of `ts/marquee-html-renderer` — the shared surface is the `mq-*` class
  vocabulary and the spec's renderer obligations, *not* byte-identical output. It carries its
  own behavioral suite and self-goldens against the same conformance corpus as the TypeScript
  renderer.

## A note on the name

Your code reads `use marquee_html_renderer::`; the crate wears the `cube-drone-` prefix on
crates.io only because the registry has no scopes. Most people want
`cube-drone-marquee-markup` instead — this crate plus the stylesheet, fonts, emoji table,
turbolinks, and the `marquee` CLI, batteries included. The spec and conformance vectors (CC0)
live in [the repo](https://github.com/cube-drone/marqueemarkup).
