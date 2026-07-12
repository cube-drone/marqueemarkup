<img src="https://raw.githubusercontent.com/cube-drone/marqueemarkup/main/marquee-logo.png" alt="Marquee Markup" width="96" align="right">

# cube-drone-marquee-markup

The [Marquee](https://github.com/cube-drone/marqueemarkup) Markup Language. 
Marquee source in, complete styled HTML out.

```toml
[dependencies]
marquee-markup = { package = "cube-drone-marquee-markup", version = "0.2" }
```

```rust
use marquee_markup::{marquee, MarqueeOptions};

let page = marquee("# hello *world*\n", &MarqueeOptions::default())?;
```

The registry name wears the `cube-drone-` prefix (crates.io has no scopes); the dependency
rename above keeps code reading `use marquee_markup::`. To learn the *language*, read
[WRITING.md](https://github.com/cube-drone/marqueemarkup/blob/main/WRITING.md) or see it live
at [marquee.cube-drone.com](https://marquee.cube-drone.com). 

This document is the contract for the *tools*; full rustdoc lives on
[docs.rs](https://docs.rs/cube-drone-marquee-markup).

## The CLI

```
cargo install cube-drone-marquee-markup    # installs the `marquee` binary
marquee hello.mq > hello.html
marquee hello.mq -o hello.html
marquee site/ dist/                        # a whole website
```

| flag | effect |
|---|---|
| `--nofetch` | skip the network fetch-ahead pass. Default is ON: bare web links become real OpenGraph preview cards, fetched once at build time. With `--nofetch`, the build touches no network |
| `--envelope` | wrap plain documents in a 650px centered readability column. Documents whose top-level content is `:::page` directives are left alone |
| `--darkmode` | force `color-scheme: dark`. Default: pages follow the reader's OS theme |
| `--noreadable` | disable the color-readability rescue (see `readable` below). Default is ON for pages |

Flag-for-flag identical to the npm CLI. Every flag is a library option first.

## Functions

Marquee's grammar is total prose: **any input renders; nothing errors on content.** 

Well, _almost nothing_: The one
`Err` in the page-rendering API is an unknown dialect version declaration (`#!marquee 99`),
returned as `ParseError` — refusing to guess a future dialect's meaning is the contract.
`build_site` additionally returns `std::io::Error` for filesystem failures, as filesystem
functions do.

### `marquee(source: &str, opts: &MarqueeOptions) -> Result<String, ParseError>`

One motion, synchronous, zero network: parse → render → inline the stylesheet → inline
exactly the font faces the page uses (as base64, by default) → wrap in a complete page
shell. The returned string is self-contained: no files to host beside it, no scripts.
Turbolinks render through the fetchless plugin chain (YouTube/Spotify embeds, media by
extension); unrecognized links stay plain links.

### `marquee_fetch(source: &str, opts: &MarqueeOptions) -> Result<String, ParseError>`

`marquee()` plus the network: runs every composed plugin's `resolve()` over the document's
link targets before rendering — concurrently across targets (scoped threads, no async
runtime), with the OpenGraph plugin joining the chain automatically (`ureq`, 10-second
timeout per fetch). Failed fetches degrade to plain links.

**Trust contract:** this function *executes plugin fetch code*; if you pass `plugins`, you
are vouching for them. **Blocking:** in an async runtime, wrap it —
`tokio::task::spawn_blocking(move || marquee_fetch(...))` — or use the sans-io keyhole:

### `marquee_resolved(source, opts, resolved: &HashMap<String, serde_json::Value>) -> Result<String, ParseError>`

`marquee_fetch()` with the gathering done by *you*: performs no I/O, renders with data you
collected however your environment likes (reqwest under tokio, a cache, a queue). Keys are
`"{plugin_name}\n{target}"`, exactly what `resolve_targets()` builds;
`turbolink_targets(&parse(source)?)` is the shopping list. Missing entries degrade to plain
links.

### `marquee_fragment(source, opts) -> Result<Fragment, ParseError>`

The pieces, for embedders. `Fragment { body, css, title, font_tokens }`:

- `body` — one `<div class="mq-doc">…</div>` fragment
- `css` — everything the body needs: stylesheet, plugin skins, font faces per `opts.fonts`
- `title` — `opts.title`, else the document's `:::meta title`, else `"Marquee"`
- `font_tokens` — which faces the body wears (pair with `font_bytes()` to ship files)

### `marquee_body(...)` / `marquee_head(...) -> Result<String, ParseError>`

The fragment pre-split: just the body, or `<title>…</title>\n<style>…</style>` paste-ready
for a `<head>`.

### `build_site(site_dir: &Path, out_dir: &Path, opts: &SiteOptions) -> io::Result<SiteReport>`

A folder of `.mq` in, a static website out. The contract:

- Every `<id>.mq` becomes `<id>.html`, except `_*.mq` **partials** — includable via
  `:::include doc=_nav:::` but not rendered as pages. Includes resolve beside the including
  file; included documents may not include (cycles unrepresentable); a missing include is a
  visible placeholder, never an error.
- Relative doc-id links resolve to built pages: `[Menu](menu)` → `href="menu.html"`.
- Relative media is copied to `<out>/media/` (deduplicated, collision-safe) and re-pointed;
  remote media is left for readers to fetch.
- Only the font faces the site actually uses ship, as real files in `<out>/fonts/` with a
  generated `css/fonts.css`; `css/marquee.css` and `css/turbolink.css` are written as files
  and linked from every page shell.
- Titles come from `:::meta title`, falling back to the file id.
- Returns `SiteReport { pages, media_files, font_faces, out_dir }`.

### `build_site_fetch(...) -> io::Result<SiteReport>`

`build_site()` with one fetch-ahead pass over every `.mq` file's turbolink targets
(partials included). Same trust and blocking notes as `marquee_fetch`.

## Options

`MarqueeOptions` — a plain struct, `Default`-able, so `..Default::default()` is the idiom:

| field | type | default | contract |
|---|---|---|---|
| `title` | `Option<String>` | document's `:::meta title`, else `"Marquee"` | the page `<title>` |
| `fonts` | `FontMode` | `Inline` | `Inline`: used faces embedded as base64. `External`: `@font-face` urls under `font_base` — ship the files yourself (`font_tokens` names them, `font_bytes()` has the bytes). `None`: font names degrade to fallback stacks |
| `font_base` | `Option<String>` | `"fonts/"` | URL prefix for `FontMode::External` |
| `emoji` | `HashMap<String, EmojiResolution>` | empty | your table, layered over the defaults; yours win. `EmojiResolution::Text` replaces with text; `::Image { url, alt }` renders a character-sized inline `<img>` (embedder-trusted, like every hook) |
| `emoji_defaults` | `Option<bool>` | `true` | the standard gemoji table loads implicitly; `Some(false)` leaves unlisted shortcodes literal |
| `color_scheme` | `Option<ColorScheme>` | follow the reader's OS | force `Light` or `Dark` on the page shell |
| `envelope` | `bool` | `false` | 650px centered readability column; defers to documents that *are* a `:::page` |
| `readable` | `Option<bool>` | ON for pages, OFF for fragments | the color-readability rescue: author colors' lightness clamps toward the canvas's opposite (CSS relative color syntax); painted containers are left alone; unsupporting browsers see raw colors |
| `plugins` | `Option<Vec<&dyn TurbolinkPlugin>>` | the fetchless default set | the turbolink chain, priority-ordered; fetch mode appends `OpengraphPlugin` unless present |

`SiteOptions` carries the same fields (minus `title`/`fonts` — sites always use font files),
applied per-page.

There is deliberately no `Partial<Profile>` equivalent: overriding embedder policy in Rust
means implementing the `Profile` trait (re-exported here; its default methods *are* the
bare-web policy) and calling the re-exported `render()` directly — the reach-deeper path.

## Plugins

`marquee_markup::turbolink::TurbolinkPlugin` is a trait:

```rust
pub trait TurbolinkPlugin: Sync {
    fn name(&self) -> &'static str;
    fn matches(&self, target: &str) -> bool;                    // cheap recognition
    fn resolve(&self, target: &str) -> Option<serde_json::Value> { None } // the ONLY place I/O is allowed
    fn render(&self, target: &str, level: TurbolinkLevel, data: Option<&Value>) -> Option<String>;
    fn css(&self) -> Option<&'static str> { None }              // the skin for your markup
}
```

`render()` must be pure; return `None` to decline (the chain continues; the renderer's
plain-link floor catches everything, and whatever you render, the wrapper appends the
original link — enrichment augments, never replaces). Author bytes only ever reach you as
the `target` string: escape everything you interpolate (`escape_text` / `escape_attr` are
re-exported), or hand facts to `render_card()` and let the standard card do it.

## Safety, stated plainly

- Author bytes never reach output except through escaping; targets only through the
  profile's scheme allowlist; unknown vocabulary degrades visibly and never eats content.
- Rendered pages contain **zero JavaScript**; effects are CSS, honor
  `prefers-reduced-motion`, and reveals cannot hide text where animations don't run.
- The embedded stylesheet, fonts, and emoji table are pinned byte-for-byte to the npm
  packages by lockstep tests: same version number = same artifacts, across both ecosystems.
- The only I/O surfaces are the `_fetch` functions' resolve phase and `build_site`'s
  filesystem writes.

License: MPL-2.0. The font faces are SIL OFL (licenses embedded alongside); the emoji table
derives from gemoji (MIT; `GEMOJI-LICENSE`).
