//! build_site(): render a folder of .mq files into a static website - the
//! Rust spelling of the npm omnibus's buildSite, implementing the same
//! embedder duties (see ts/marquee-markup/src/build-site.ts for the design
//! commentary): _*.mq partials via :::include (includes may not include),
//! doc-id links resolved to built pages, relative media copied and
//! re-pointed, turbolinks via the plugin chain, per-site font subsetting,
//! real cacheable stylesheet files.

use crate::opengraph::OpengraphPlugin;
use crate::turbolink::{
    compose_turbolinks, default_plugins, resolve_targets, turbolink_styles, turbolink_targets,
    TurbolinkPlugin,
};
use crate::{
    emoji_table, external_font_faces, font_bytes, meta_title, readability_css, ColorScheme,
    MarqueeOptions, ENVELOPE_CSS, MARQUEE_CSS,
};
use marquee_html_renderer::{
    escape_text, render, used_font_tokens, BareWebProfile, EmojiResolution, MediaResolution,
    Profile, TurbolinkLevel,
};
use marquee_parser::{parse, Attrs, Node};
use std::cell::RefCell;
use std::collections::{BTreeSet, HashMap};
use std::fs;
use std::path::{Path, PathBuf};

/// Options for a site build; the page-level knobs mirror MarqueeOptions.
#[derive(Default)]
pub struct SiteOptions<'a> {
    pub emoji: HashMap<String, EmojiResolution>,
    pub emoji_defaults: Option<bool>,
    pub color_scheme: Option<ColorScheme>,
    pub envelope: bool,
    /// Defaults ON for sites (the shell declares the color-scheme).
    pub readable: Option<bool>,
    pub plugins: Option<Vec<&'a dyn TurbolinkPlugin>>,
}

pub struct SiteReport {
    pub pages: Vec<String>,
    pub media_files: usize,
    pub font_faces: Vec<String>,
    pub out_dir: PathBuf,
}

struct SiteProfile<'a> {
    site_dir: &'a Path,
    out_dir: &'a Path,
    depth: u32,
    emoji: HashMap<String, EmojiResolution>,
    plugins: &'a [&'a dyn TurbolinkPlugin],
    resolved: &'a HashMap<String, serde_json::Value>,
    /// source path -> copied basename (interior mutability: Profile methods
    /// take &self, and media copying is per-site memoized state).
    copied: &'a RefCell<HashMap<PathBuf, String>>,
}

fn has_scheme(target: &str) -> bool {
    let bytes = target.as_bytes();
    if !bytes.first().is_some_and(|b| b.is_ascii_alphabetic()) {
        return false;
    }
    let end = bytes
        .iter()
        .take_while(|b| b.is_ascii_alphanumeric() || matches!(b, b'+' | b'.' | b'-'))
        .count();
    bytes.get(end) == Some(&b':')
}

impl SiteProfile<'_> {
    fn site_media_url(&self, path: &Path) -> String {
        let mut copied = self.copied.borrow_mut();
        if let Some(name) = copied.get(path) {
            return format!("media/{}", urlencode(name));
        }
        let base = path.file_name().unwrap_or_default().to_string_lossy().to_string();
        let mut name = base.clone();
        let mut n = 2;
        while copied.values().any(|v| *v == name) {
            name = match base.rfind('.') {
                Some(dot) if dot > 0 => format!("{}-{n}{}", &base[..dot], &base[dot..]),
                _ => format!("{base}-{n}"),
            };
            n += 1;
        }
        let media_dir = self.out_dir.join("media");
        let _ = fs::create_dir_all(&media_dir);
        let _ = fs::copy(path, media_dir.join(&name));
        copied.insert(path.to_path_buf(), name.clone());
        format!("media/{}", urlencode(&name))
    }
}

fn urlencode(name: &str) -> String {
    let mut out = String::new();
    for b in name.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

impl Profile for SiteProfile<'_> {
    fn media(&self, target: &str) -> Option<MediaResolution> {
        if !has_scheme(target) {
            let clean = target.split(['?', '#']).next().unwrap_or("");
            let path = self.site_dir.join(clean);
            if path.exists() {
                // Kind-by-extension via the default profile (dummy https
                // host - only the extension matters to it).
                let name = path.file_name()?.to_string_lossy().to_string();
                let base = BareWebProfile.media(&format!("https://local/{name}"))?;
                return Some(MediaResolution {
                    kind: base.kind,
                    url: self.site_media_url(&path),
                });
            }
            return None;
        }
        BareWebProfile.media(target)
    }
    fn emoji(&self, slug: &str) -> Option<EmojiResolution> {
        self.emoji.get(slug).cloned()
    }
    fn turbolink(&self, target: &str, level: TurbolinkLevel) -> Option<String> {
        compose_turbolinks(self.plugins, self.resolved, target, level)
    }
    fn directive(&self, name: &str, attrs: &Attrs, _children_html: &str) -> Option<String> {
        if name != "include" || self.depth > 0 {
            return None; // deep include -> unknown vocabulary -> placeholder
        }
        let doc_id = attrs.get("doc")?;
        if !doc_id.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'.' | b'-')) {
            return None;
        }
        let path = self.site_dir.join(format!("{doc_id}.mq"));
        let source = fs::read_to_string(path).ok()?;
        let doc = parse(&source).ok()?;
        let Node::Document { children, .. } = &doc else {
            return None;
        };
        let inner = SiteProfile {
            site_dir: self.site_dir,
            out_dir: self.out_dir,
            depth: self.depth + 1,
            emoji: self.emoji.clone(),
            plugins: self.plugins,
            resolved: self.resolved,
            copied: self.copied,
        };
        Some(children.iter().map(|c| render(c, &inner)).collect())
    }
}

fn shell(title: &str, body: &str, opts: &SiteOptions) -> String {
    let scheme = opts.color_scheme.map_or("light dark", ColorScheme::css);
    let envelope = if opts.envelope { format!("\n{ENVELOPE_CSS}") } else { String::new() };
    let readable = if opts.readable != Some(false) {
        format!("\n{}", readability_css(opts.color_scheme))
    } else {
        String::new()
    };
    format!(
        r#"<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{}</title>
<link rel="stylesheet" href="css/marquee.css">
<link rel="stylesheet" href="css/fonts.css">
<link rel="stylesheet" href="css/turbolink.css">
<style>/* the embedder's page, the embedder's reset (see the npm buildSite) */
:root {{ color-scheme: {scheme}; }}
body {{ margin: 0; }}{envelope}{readable}</style>
</head>
<body>
{body}
</body>
</html>
"#,
        escape_text(title),
    )
}

fn page_options<'a>(opts: &'a SiteOptions<'a>) -> MarqueeOptions<'a> {
    MarqueeOptions {
        emoji: opts.emoji.clone(),
        emoji_defaults: opts.emoji_defaults,
        ..MarqueeOptions::default()
    }
}

/// Synchronous, fetchless site build - turbolinks with nothing gathered
/// degrade to plain links.
pub fn build_site(
    site_dir: &Path,
    out_dir: &Path,
    opts: &SiteOptions,
) -> std::io::Result<SiteReport> {
    let plugins = match &opts.plugins {
        Some(p) => p.clone(),
        None => default_plugins(),
    };
    build_site_core(site_dir, out_dir, opts, &plugins, &HashMap::new())
}

/// build_site(), plus the network: gathers every page's turbolink targets,
/// runs the composed plugins' resolve() phase once (OpenGraph joins the
/// chain automatically - and this executes plugin fetch code, so trust
/// your chain), then builds with the gathered data.
pub fn build_site_fetch(
    site_dir: &Path,
    out_dir: &Path,
    opts: &SiteOptions,
) -> std::io::Result<SiteReport> {
    let mut plugins = match &opts.plugins {
        Some(p) => p.clone(),
        None => default_plugins(),
    };
    if !plugins.iter().any(|p| p.name() == "opengraph") {
        plugins.push(&OpengraphPlugin);
    }
    let mut targets = Vec::new();
    for entry in fs::read_dir(site_dir)? {
        let path = entry?.path();
        if path.extension().is_some_and(|e| e == "mq") {
            if let Ok(doc) = parse(&fs::read_to_string(&path)?) {
                targets.extend(turbolink_targets(&doc));
            }
        }
    }
    let resolved = resolve_targets(&targets, &plugins);
    build_site_core(site_dir, out_dir, opts, &plugins, &resolved)
}

fn build_site_core(
    site_dir: &Path,
    out_dir: &Path,
    opts: &SiteOptions,
    plugins: &[&dyn TurbolinkPlugin],
    resolved: &HashMap<String, serde_json::Value>,
) -> std::io::Result<SiteReport> {
    let mut mq_files: Vec<String> = fs::read_dir(site_dir)?
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().to_string())
        .filter(|f| f.ends_with(".mq"))
        .collect();
    mq_files.sort();
    let page_ids: Vec<String> = mq_files
        .iter()
        .filter(|f| !f.starts_with('_'))
        .map(|f| f.trim_end_matches(".mq").to_string())
        .collect();

    fs::create_dir_all(out_dir.join("css"))?;
    fs::write(out_dir.join("css/marquee.css"), MARQUEE_CSS)?;
    fs::write(out_dir.join("css/turbolink.css"), turbolink_styles(plugins))?;

    let copied = RefCell::new(HashMap::new());
    let page_opts = page_options(opts);
    let profile = SiteProfile {
        site_dir,
        out_dir,
        depth: 0,
        emoji: emoji_table(&page_opts),
        plugins,
        resolved,
        copied: &copied,
    };

    let mut used_fonts: BTreeSet<String> = BTreeSet::new();
    for id in &page_ids {
        let source = fs::read_to_string(site_dir.join(format!("{id}.mq")))?;
        let Ok(doc) = parse(&source) else {
            continue; // unknown dialect version: skip, like the npm builder errors
        };
        let mut body = render(&doc, &profile);
        // Doc-id links become page links: the base-URI duty, at build time.
        for target in &page_ids {
            body = body.replace(
                &format!("href=\"{target}\""),
                &format!("href=\"{target}.html\""),
            );
        }
        for token in used_font_tokens(&body) {
            used_fonts.insert(token);
        }
        // The envelope defers to a document that IS a page.
        if opts.envelope && !crate::doc_is_page(&doc) {
            body = format!("<div class=\"mq-envelope\">{body}</div>");
        }
        let title = meta_title(&doc).unwrap_or_else(|| id.clone());
        fs::write(out_dir.join(format!("{id}.html")), shell(&title, &body, opts))?;
    }

    // Fonts: only the faces this site actually uses, as real cacheable files.
    fs::create_dir_all(out_dir.join("fonts"))?;
    let mut shipped: Vec<String> = Vec::new();
    for token in &used_fonts {
        if let Some(bytes) = font_bytes(token) {
            fs::write(out_dir.join("fonts").join(format!("{token}.woff2")), bytes)?;
            shipped.push(token.clone());
        }
    }
    fs::write(
        out_dir.join("css/fonts.css"),
        format!(
            "/* fonts.css - generated per site: only the faces these pages use. */\n\n{}\n",
            external_font_faces(&shipped, "../fonts/")
        ),
    )?;

    let media_files = copied.borrow().len();
    Ok(SiteReport {
        pages: page_ids,
        media_files,
        font_faces: shipped,
        out_dir: out_dir.to_path_buf(),
    })
}
