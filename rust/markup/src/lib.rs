//! Marquee, batteries included (the Rust spelling of
//! @cube-drone/marquee-markup):
//!
//! ```no_run
//! use marquee_markup::{marquee, MarqueeOptions};
//! let page = marquee("# hello *world*\n", &MarqueeOptions::default());
//! ```
//!
//! One motion: parse, render, style, inline the fonts the page actually
//! wears, wrap in a page shell. The stylesheet, the font grab bag, and the
//! standard emoji table are EMBEDDED - a Rust consumer needs no npm and no
//! asset scavenger hunt; lockstep tests pin the embedded copies to the npm
//! packages' bytes, and lockstep versioning means "same number = same
//! artifacts". Everything underneath is re-exported: the same
//! parse/render/Profile machinery, the turbolink plugin system, the tables.

mod build_site;
mod css;
mod emoji;
mod fonts;
pub mod opengraph;
pub mod turbolink;

pub use build_site::{build_site, build_site_fetch, SiteOptions, SiteReport};
pub use css::MARQUEE_CSS;
pub use emoji::{standard_emoji, standard_emoji_table};
pub use fonts::{external_font_faces, font_bytes, inline_font_faces};

// The full toolbox, re-exported: growth never requires switching crates.
pub use marquee_html_renderer::{
    escape_attr, escape_text, render, render_marquee, used_font_tokens, BareWebProfile,
    EmojiResolution, MediaKind, MediaResolution, Profile, TurbolinkLevel, FONTS,
};
pub use marquee_parser::{parse, Attrs, Node, ParseError, Reason};

use opengraph::OpengraphPlugin;
use std::collections::HashMap;
use turbolink::{
    compose_turbolinks, default_plugins, resolve_targets, turbolink_styles, turbolink_targets,
    TurbolinkPlugin,
};

/// Font delivery for the page shell.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum FontMode {
    /// Carry the used faces as base64: a self-contained page (the default).
    #[default]
    Inline,
    /// Emit @font-face urls under `font_base`; ship the files yourself
    /// (`font_bytes` has them, `font_tokens` names them).
    External,
    /// No faces: every font name degrades to its fallback stack.
    None,
}

/// Options for the convenience functions. Plain struct, `Default`-able;
/// every CLI flag is a field here first.
#[derive(Default)]
pub struct MarqueeOptions<'a> {
    /// Page title; defaults to the document's `:::meta title`, then "Marquee".
    pub title: Option<String>,
    /// Font delivery (see FontMode).
    pub fonts: FontMode,
    /// Base path for FontMode::External urls (default "fonts/").
    pub font_base: Option<String>,
    /// Your emoji: slug -> resolution, layered over the standard table.
    pub emoji: HashMap<String, EmojiResolution>,
    /// The implicit standard table (default true). False: unlisted slugs
    /// stay literal `:slug:`.
    pub emoji_defaults: Option<bool>,
    /// Force the page's theme; None follows the reader's OS.
    pub color_scheme: Option<ColorScheme>,
    /// Wrap plain documents in a 650px centered readability envelope
    /// (default false; a document that IS a `:::page` is left alone).
    pub envelope: bool,
    /// Color-readability rescue (see readability_css). None = the context
    /// default: ON for whole pages, OFF for fragments.
    pub readable: Option<bool>,
    /// Turbolink expanders; None = the fetchless default set.
    pub plugins: Option<Vec<&'a dyn TurbolinkPlugin>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ColorScheme {
    Light,
    Dark,
}

impl ColorScheme {
    fn css(self) -> &'static str {
        match self {
            ColorScheme::Light => "light",
            ColorScheme::Dark => "dark",
        }
    }
}

/// The rendered pieces, for embedders.
pub struct Fragment {
    pub body: String,
    pub css: String,
    pub title: String,
    pub font_tokens: Vec<String>,
}

/// The readability envelope: omnibus convenience, not renderer contract.
pub const ENVELOPE_CSS: &str =
    ".mq-envelope { max-width: 650px; margin-inline: auto; padding-inline: 1rem; }";

/// The `readable` option's stylesheet - a straight port of the npm
/// package's readabilityCss (see its docs for the full design: lightness
/// clamps via CSS relative color syntax; painted containers reset the
/// clamp bounds for their subtree; unsupporting browsers see raw colors).
pub fn readability_css(color_scheme: Option<ColorScheme>) -> String {
    let dark = ".mq-doc { --mq-rl-min: 0.72; --mq-rl-max: 1; }";
    let light = ".mq-doc { --mq-rl-min: 0; --mq-rl-max: 0.55; }";
    let mode = match color_scheme {
        Some(ColorScheme::Dark) => dark.to_string(),
        Some(ColorScheme::Light) => light.to_string(),
        None => format!(
            "@media (prefers-color-scheme: dark) {{ {dark} }}\n@media (prefers-color-scheme: light) {{ {light} }}"
        ),
    };
    format!(
        r#"{mode}
.mq-doc [style*="--mq-color"] {{ color: oklch(from var(--mq-color) clamp(var(--mq-rl-min, 0), l, var(--mq-rl-max, 1)) c h); }}
.mq-doc [style*="--mq-bg"]:not([style*="--mq-color"]) {{ color: oklch(from var(--mq-bg) calc(1 - clamp(0, (l - 0.5) * 999, 1)) 0 h); }}
.mq-doc [class*="mq-scheme-"], .mq-doc [style*="--mq-bg"] {{ --mq-rl-min: 0; --mq-rl-max: 1; }}"#
    )
}

/// The document's own `:::meta title`, if it declares one.
pub fn meta_title(doc: &Node) -> Option<String> {
    if let Node::Document { children, .. } = doc {
        for child in children {
            if let Node::Directive { name, attrs, .. } = child {
                if name == "meta" {
                    if let Some(title) = attrs.get("title") {
                        return Some(title.clone());
                    }
                }
            }
        }
    }
    None
}

/// Does the document take layout into its own hands? Only when it IS a
/// page: every top-level block (ignoring `:::meta` and comments) is a
/// `:::page` directive.
pub fn doc_is_page(doc: &Node) -> bool {
    let Node::Document { children, .. } = doc else {
        return false;
    };
    let blocks: Vec<&Node> = children
        .iter()
        .filter(|c| {
            !matches!(c, Node::Comment { .. })
                && !matches!(c, Node::Directive { name, .. } if name == "meta")
        })
        .collect();
    !blocks.is_empty()
        && blocks
            .iter()
            .all(|c| matches!(c, Node::Directive { name, .. } if name == "page"))
}

/// The omnibus profile: bare-web defaults + the emoji table + the composed
/// turbolink chain. `pub(crate)` because build_site layers on top of it.
pub(crate) struct OmnibusProfile<'a> {
    pub emoji: HashMap<String, EmojiResolution>,
    pub plugins: &'a [&'a dyn TurbolinkPlugin],
    pub resolved: &'a HashMap<String, serde_json::Value>,
}

impl Profile for OmnibusProfile<'_> {
    fn emoji(&self, slug: &str) -> Option<EmojiResolution> {
        self.emoji.get(slug).cloned()
    }
    fn turbolink(&self, target: &str, level: TurbolinkLevel) -> Option<String> {
        compose_turbolinks(self.plugins, self.resolved, target, level)
    }
}

pub(crate) fn emoji_table(opts: &MarqueeOptions) -> HashMap<String, EmojiResolution> {
    let mut table: HashMap<String, EmojiResolution> = HashMap::new();
    if opts.emoji_defaults != Some(false) {
        for (slug, ch) in standard_emoji_table() {
            table.insert((*slug).to_string(), EmojiResolution::Text((*ch).to_string()));
        }
    }
    for (slug, resolution) in &opts.emoji {
        table.insert(slug.clone(), resolution.clone());
    }
    table
}

fn fragment_core(
    doc: &Node,
    opts: &MarqueeOptions,
    plugins: &[&dyn TurbolinkPlugin],
    resolved: &HashMap<String, serde_json::Value>,
    readable_default: bool,
) -> Fragment {
    let profile = OmnibusProfile { emoji: emoji_table(opts), plugins, resolved };
    let mut body = render(doc, &profile);
    let enveloped = opts.envelope && !doc_is_page(doc);
    if enveloped {
        body = format!("<div class=\"mq-envelope\">{body}</div>");
    }
    let font_tokens = used_font_tokens(&body);
    let mut css = format!("{MARQUEE_CSS}\n{}", turbolink_styles(plugins));
    if enveloped {
        css.push_str(&format!("\n{ENVELOPE_CSS}"));
    }
    if opts.readable.unwrap_or(readable_default) {
        css.push_str(&format!("\n{}", readability_css(opts.color_scheme)));
    }
    let base = opts.font_base.as_deref().unwrap_or("fonts/");
    let faces = match opts.fonts {
        FontMode::Inline => inline_font_faces(&font_tokens),
        FontMode::External => external_font_faces(&font_tokens, base),
        FontMode::None => String::new(),
    };
    if !faces.is_empty() {
        css.push_str(&format!("\n{faces}"));
    }
    let title = opts
        .title
        .clone()
        .or_else(|| meta_title(doc))
        .unwrap_or_else(|| "Marquee".to_string());
    Fragment { body, css, title, font_tokens }
}

fn plugins_of<'a>(opts: &'a MarqueeOptions<'a>) -> Vec<&'a dyn TurbolinkPlugin> {
    match &opts.plugins {
        Some(p) => p.clone(),
        None => default_plugins(),
    }
}

/// The fetch-mode chain: yours (or the defaults) with the OpenGraph
/// expander appended, unless you already composed one in.
fn fetch_chain<'a>(opts: &'a MarqueeOptions<'a>) -> Vec<&'a dyn TurbolinkPlugin> {
    let mut plugins = plugins_of(opts);
    if !plugins.iter().any(|p| p.name() == "opengraph") {
        plugins.push(&OpengraphPlugin);
    }
    plugins
}

/// Parse and render to embeddable pieces. Fragments default `readable`
/// OFF (a host theming by class rather than OS preference would get the
/// clamp backwards); whole pages default it ON.
pub fn marquee_fragment(source: &str, opts: &MarqueeOptions) -> Result<Fragment, ParseError> {
    let doc = parse(source)?;
    Ok(fragment_core(&doc, opts, &plugins_of(opts), &HashMap::new(), false))
}

/// Just the stuff that goes inside `<body>`.
pub fn marquee_body(source: &str, opts: &MarqueeOptions) -> Result<String, ParseError> {
    Ok(marquee_fragment(source, opts)?.body)
}

/// Just the stuff that goes inside `<head>`: title + one `<style>` block.
pub fn marquee_head(source: &str, opts: &MarqueeOptions) -> Result<String, ParseError> {
    let fragment = marquee_fragment(source, opts)?;
    Ok(format!(
        "<title>{}</title>\n<style>\n{}\n</style>",
        escape_text(&fragment.title),
        fragment.css
    ))
}

fn page_shell(fragment: &Fragment, color_scheme: Option<ColorScheme>) -> String {
    let scheme = color_scheme.map_or("light dark", ColorScheme::css);
    format!(
        r#"<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{}</title>
<style>
/* The page is ours, so it follows the reader's OS theme unless the caller
   forced one. marquee.css never declares color-scheme itself - embedded
   fragments defer to their host. */
:root {{ color-scheme: {scheme}; }}
body {{ margin: 0; }}
{}
</style>
</head>
<body>
{}
</body>
</html>
"#,
        escape_text(&fragment.title),
        fragment.css,
        fragment.body
    )
}

/// The one smooth motion: Marquee source in, a complete self-contained
/// HTML page out. Synchronous and fetchless - turbolinks with nothing
/// gathered degrade to plain links. Errors only on an unknown dialect
/// version, exactly as the parser does.
pub fn marquee(source: &str, opts: &MarqueeOptions) -> Result<String, ParseError> {
    let doc = parse(source)?;
    let fragment = fragment_core(&doc, opts, &plugins_of(opts), &HashMap::new(), true);
    Ok(page_shell(&fragment, opts.color_scheme))
}

/// marquee(), plus the network: runs the composed plugins' resolve() phase
/// ahead of the render - OpenGraph summaries for bare web links (the
/// OpengraphPlugin joins the chain automatically), plus whatever gathering
/// your own plugins declare. That means this function EXECUTES plugin fetch
/// code: compose the chain from plugins you trust. Rendering itself stays
/// pure; a failed fetch degrades to the plain link.
pub fn marquee_fetch(source: &str, opts: &MarqueeOptions) -> Result<String, ParseError> {
    let plugins = fetch_chain(opts);
    let doc = parse(source)?;
    let resolved = resolve_targets(&turbolink_targets(&doc), &plugins);
    let fragment = fragment_core(&doc, opts, &plugins, &resolved, true);
    Ok(page_shell(&fragment, opts.color_scheme))
}

/// The sans-io keyhole: marquee_fetch() with the gathering done by YOU.
/// This function performs no I/O - fetch however your environment likes
/// (reqwest under tokio, a cache, a queue) and hand the results in. Keys
/// are `"{plugin_name}\n{target}"`, exactly what resolve_targets() builds;
/// `turbolink_targets(&parse(source)?)` is the shopping list. Targets with
/// no entry degrade to the plain link, same as everywhere.
///
/// (In an async runtime you can also just wrap the blocking pair in
/// `spawn_blocking` - this exists for embedders who want native async
/// fetching or their own gathering policy.)
pub fn marquee_resolved(
    source: &str,
    opts: &MarqueeOptions,
    resolved: &HashMap<String, serde_json::Value>,
) -> Result<String, ParseError> {
    let plugins = fetch_chain(opts);
    let doc = parse(source)?;
    let fragment = fragment_core(&doc, opts, &plugins, resolved, true);
    Ok(page_shell(&fragment, opts.color_scheme))
}
