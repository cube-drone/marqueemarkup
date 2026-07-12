//! Turbolink plugins, Rust spelling (a faithful port of
//! @cube-drone/marquee-turbolink). A plugin owns the *presentation* of the
//! link kinds it recognizes; the renderer owns only the plain-link floor
//! and the socket (Profile::turbolink). Two phases, deliberately split:
//! resolve() MAY touch the network and runs ahead of rendering;
//! render() is sync, pure, and deterministic given resolved data.
//!
//! Plugins are embedder-trusted code: author bytes only ever enter as the
//! `target` string - escape everything you interpolate (the renderer's
//! escape_text/escape_attr are re-exported by this crate for exactly that).

use marquee_html_renderer::{escape_attr, escape_text, TurbolinkLevel};
use marquee_parser::Node;
use regex::Regex;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::OnceLock;

pub trait TurbolinkPlugin: Sync {
    fn name(&self) -> &'static str;
    /// Cheap recognition; render()/resolve() run only when this is true.
    fn matches(&self, target: &str) -> bool;
    /// Optional gathering - the ONLY place network is allowed. Runs in the
    /// fetch-ahead pass (resolve_targets), never during render.
    fn resolve(&self, _target: &str) -> Option<Value> {
        None
    }
    /// Sync and pure. Some(html), or None to decline (the chain continues;
    /// the renderer's plain-link floor catches everything).
    fn render(&self, target: &str, level: TurbolinkLevel, data: Option<&Value>) -> Option<String>;
    /// The stylesheet for the markup render() emits - collected by
    /// turbolink_styles(). Plugins sharing rules return the same constant
    /// (aggregation dedupes by content).
    fn css(&self) -> Option<&'static str> {
        None
    }
}

/// Everything the composed chain needs styled, once: the standard card's
/// skin (render_card is the library keyhole) plus each plugin's css,
/// deduplicated by content.
pub fn turbolink_styles(plugins: &[&dyn TurbolinkPlugin]) -> String {
    let mut chunks: Vec<&str> = vec![CARD_CSS];
    for plugin in plugins {
        if let Some(css) = plugin.css() {
            if !chunks.contains(&css) {
                chunks.push(css);
            }
        }
    }
    chunks.join("\n")
}

/// The fetch-ahead pass: run every matching plugin's resolve() over a
/// target list, yielding the map the compose step consumes. Targets resolve
/// concurrently (wall-clock is the slowest fetch, not the sum); within one
/// target, plugins run in order - first resolver wins, like first renderer.
pub fn resolve_targets(
    targets: &[String],
    plugins: &[&dyn TurbolinkPlugin],
) -> HashMap<String, Value> {
    let mut unique: Vec<&str> = targets.iter().map(|s| s.as_str()).collect();
    unique.sort_unstable();
    unique.dedup();
    let mut resolved = HashMap::new();
    std::thread::scope(|scope| {
        let handles: Vec<_> = unique
            .into_iter()
            .map(|target| {
                scope.spawn(move || {
                    for plugin in plugins {
                        if !plugin.matches(target) {
                            continue;
                        }
                        if let Some(data) = plugin.resolve(target) {
                            return Some((format!("{}\n{target}", plugin.name()), data));
                        }
                    }
                    None
                })
            })
            .collect();
        for handle in handles {
            if let Some((key, data)) = handle.join().unwrap_or(None) {
                resolved.insert(key, data);
            }
        }
    });
    resolved
}

/// One composed lookup for Profile::turbolink: first plugin that matches
/// AND renders wins.
pub fn compose_turbolinks(
    plugins: &[&dyn TurbolinkPlugin],
    resolved: &HashMap<String, Value>,
    target: &str,
    level: TurbolinkLevel,
) -> Option<String> {
    for plugin in plugins {
        if !plugin.matches(target) {
            continue;
        }
        let data = resolved.get(&format!("{}\n{target}", plugin.name()));
        if let Some(html) = plugin.render(target, level, data) {
            return Some(html);
        }
    }
    None
}

/// Every turbolink target in a parsed document (bare-paragraph nodes and
/// explicit :::turbolink directives) - the fetch-ahead pass's shopping list.
pub fn turbolink_targets(node: &Node) -> Vec<String> {
    let mut targets = Vec::new();
    fn walk(n: &Node, targets: &mut Vec<String>) {
        match n {
            Node::Turbolink { target } => targets.push(target.clone()),
            Node::Directive { name, attrs, children } => {
                if name == "turbolink" {
                    if let Some(target) = attrs.get("target") {
                        targets.push(target.clone());
                    }
                }
                for child in children {
                    walk(child, targets);
                }
            }
            Node::Document { children, .. }
            | Node::Paragraph { children }
            | Node::Heading { children, .. }
            | Node::Blockquote { children }
            | Node::List { children, .. }
            | Node::ListItem { children }
            | Node::InvalidDirective { children, .. }
            | Node::Emphasis { children }
            | Node::Strong { children }
            | Node::Strikethrough { children }
            | Node::Link { children, .. }
            | Node::Span { children, .. } => {
                for child in children {
                    walk(child, targets);
                }
            }
            _ => {}
        }
    }
    walk(node, &mut targets);
    targets
}

// ---- the standard summary card: the safe keyhole ----

#[derive(Debug, Clone, Default)]
pub struct TurbolinkSummary {
    pub title: Option<String>,
    pub description: Option<String>,
    pub image: Option<String>,
    pub site: Option<String>,
}

/// The card's skin - always included by turbolink_styles(). Kept
/// byte-identical to the npm package's cardCss (lockstep test).
pub const CARD_CSS: &str = r#".mq-turbolink-card {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 0.15rem 0.75rem;
  border: 1px solid rgba(136, 136, 136, 0.33);
  border-left-width: 4px;
  border-radius: 0.375rem;
  padding: 0.5rem 0.75rem;
}
.mq-turbolink-site { font-size: 0.8em; opacity: 0.6; }
.mq-turbolink-title { font-weight: 600; text-decoration: none; }
.mq-turbolink-desc { font-size: 0.9em; opacity: 0.85; }
.mq-turbolink-thumb {
  grid-column: 2;
  grid-row: 1 / span 3;
  width: 6rem;
  height: 6rem;
  object-fit: cover;
  border-radius: 0.25rem;
}
.mq-turbolink-rich .mq-turbolink-card {
  border: none;
  padding: 0;
}"#;

fn site_of(target: &str) -> Option<&str> {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"^[A-Za-z][A-Za-z0-9+.-]*://([^/]+)").unwrap());
    re.captures(target).and_then(|c| c.get(1)).map(|m| m.as_str())
}

/// The standard summary card. Plugins that just have facts call this and
/// inherit the shared look and its escaping; plugins with richer ideas own
/// their own markup and their own escaping.
pub fn render_card(target: &str, summary: &TurbolinkSummary, level: TurbolinkLevel) -> String {
    let href = escape_attr(target);
    let mut card = String::new();
    let site = summary.site.as_deref().or_else(|| site_of(target));
    if let Some(site) = site {
        card.push_str(&format!(
            "<span class=\"mq-turbolink-site\">{}</span>",
            escape_text(site)
        ));
    }
    card.push_str(&format!(
        "<a class=\"mq-turbolink-title\" href=\"{href}\">{}</a>",
        escape_text(summary.title.as_deref().unwrap_or(target))
    ));
    if level == TurbolinkLevel::Full {
        if let Some(desc) = &summary.description {
            card.push_str(&format!(
                "<span class=\"mq-turbolink-desc\">{}</span>",
                escape_text(desc)
            ));
        }
        if let Some(image) = &summary.image {
            card.push_str(&format!(
                "<img class=\"mq-turbolink-thumb\" src=\"{}\" alt=\"\" loading=\"lazy\">",
                escape_attr(image)
            ));
        }
    }
    format!("<span class=\"mq-turbolink-card\">{card}</span>")
}

// ---- the fetchless default plugins ----

const FRAME_CSS: &str = r#".mq-turbolink-frame {
  display: block;
  border: 0;
  width: 100%;
  max-width: 32rem;
  border-radius: 0.375rem;
}
.mq-frame-video { aspect-ratio: 16 / 9; }"#;

const MEDIA_CSS: &str = r#".mq-turbolink-image {
  display: block;
  max-width: 20rem;
  max-height: 20rem;
  border-radius: 0.375rem;
}
.mq-turbolink-audio,
.mq-turbolink-video {
  display: block;
  width: 100%;
  max-width: 32rem;
}
.mq-turbolink-video { border-radius: 0.375rem; }"#;

fn extension(target: &str) -> String {
    let path = target.split(['?', '#']).next().unwrap_or("");
    match path.rfind('.') {
        Some(dot) => path[dot + 1..].to_ascii_lowercase(),
        None => String::new(),
    }
}

pub struct ImagePlugin;
impl TurbolinkPlugin for ImagePlugin {
    fn name(&self) -> &'static str {
        "image"
    }
    fn matches(&self, t: &str) -> bool {
        matches!(extension(t).as_str(), "png" | "jpg" | "jpeg" | "gif" | "webp" | "avif" | "svg")
    }
    fn render(&self, target: &str, level: TurbolinkLevel, _data: Option<&Value>) -> Option<String> {
        if level != TurbolinkLevel::Full {
            return None;
        }
        let href = escape_attr(target);
        Some(format!(
            "<a class=\"mq-turbolink-media\" href=\"{href}\"><img class=\"mq-turbolink-image\" src=\"{href}\" alt=\"\" loading=\"lazy\"></a>"
        ))
    }
    fn css(&self) -> Option<&'static str> {
        Some(MEDIA_CSS)
    }
}

pub struct AudioPlugin;
impl TurbolinkPlugin for AudioPlugin {
    fn name(&self) -> &'static str {
        "audio"
    }
    fn matches(&self, t: &str) -> bool {
        matches!(extension(t).as_str(), "mp3" | "ogg" | "wav" | "flac" | "m4a")
    }
    fn render(&self, target: &str, level: TurbolinkLevel, _data: Option<&Value>) -> Option<String> {
        if level != TurbolinkLevel::Full {
            return None;
        }
        Some(format!(
            "<audio class=\"mq-turbolink-audio\" controls src=\"{}\"></audio>",
            escape_attr(target)
        ))
    }
    fn css(&self) -> Option<&'static str> {
        Some(MEDIA_CSS)
    }
}

pub struct VideoPlugin;
impl TurbolinkPlugin for VideoPlugin {
    fn name(&self) -> &'static str {
        "video"
    }
    fn matches(&self, t: &str) -> bool {
        matches!(extension(t).as_str(), "mp4" | "webm")
    }
    fn render(&self, target: &str, level: TurbolinkLevel, _data: Option<&Value>) -> Option<String> {
        if level != TurbolinkLevel::Full {
            return None;
        }
        Some(format!(
            "<video class=\"mq-turbolink-video\" controls src=\"{}\"></video>",
            escape_attr(target)
        ))
    }
    fn css(&self) -> Option<&'static str> {
        Some(MEDIA_CSS)
    }
}

fn youtube_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?:youtube\.com/watch\?(?:[^#\s]*&)?v=|youtu\.be/)([A-Za-z0-9_-]{5,20})")
            .unwrap()
    })
}

pub struct YoutubePlugin;
impl TurbolinkPlugin for YoutubePlugin {
    fn name(&self) -> &'static str {
        "youtube"
    }
    fn matches(&self, t: &str) -> bool {
        youtube_re().is_match(t)
    }
    fn render(&self, target: &str, level: TurbolinkLevel, _data: Option<&Value>) -> Option<String> {
        if level != TurbolinkLevel::Full {
            return None;
        }
        let id = youtube_re().captures(target)?.get(1)?.as_str().to_string();
        // nocookie domain + referrerpolicy: see the npm plugin's notes
        // (YouTube error 153 needs a Referer since late 2025).
        Some(format!(
            "<iframe class=\"mq-turbolink-frame mq-frame-video\" src=\"https://www.youtube-nocookie.com/embed/{}\" title=\"YouTube video\" loading=\"lazy\" allowfullscreen referrerpolicy=\"strict-origin-when-cross-origin\"></iframe>",
            escape_attr(&id)
        ))
    }
    fn css(&self) -> Option<&'static str> {
        Some(FRAME_CSS)
    }
}

fn spotify_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"open\.spotify\.com/(track|album|playlist|episode|show)/([A-Za-z0-9]+)")
            .unwrap()
    })
}

pub struct SpotifyPlugin;
impl TurbolinkPlugin for SpotifyPlugin {
    fn name(&self) -> &'static str {
        "spotify"
    }
    fn matches(&self, t: &str) -> bool {
        spotify_re().is_match(t)
    }
    fn render(&self, target: &str, level: TurbolinkLevel, _data: Option<&Value>) -> Option<String> {
        if level != TurbolinkLevel::Full {
            return None;
        }
        let caps = spotify_re().captures(target)?;
        let kind = caps.get(1)?.as_str();
        let id = caps.get(2)?.as_str();
        let height = if kind == "track" || kind == "episode" { 152 } else { 352 };
        Some(format!(
            "<iframe class=\"mq-turbolink-frame\" src=\"https://open.spotify.com/embed/{kind}/{}\" height=\"{height}\" title=\"Spotify player\" loading=\"lazy\"></iframe>",
            escape_attr(id)
        ))
    }
    fn css(&self) -> Option<&'static str> {
        Some(FRAME_CSS)
    }
}

fn gmaps_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"google\.[a-z.]+/maps/\S*@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(\d+(?:\.\d+)?)z")
            .unwrap()
    })
}

/// Google Maps links that carry coordinates render the same spot as an
/// OpenStreetMap embed (Google retired its keyless endpoint, and OSM is
/// cozier anyway). Links without coordinates decline to the floor.
pub struct MapsPlugin;
impl TurbolinkPlugin for MapsPlugin {
    fn name(&self) -> &'static str {
        "maps"
    }
    fn matches(&self, t: &str) -> bool {
        gmaps_re().is_match(t)
    }
    fn render(&self, target: &str, level: TurbolinkLevel, _data: Option<&Value>) -> Option<String> {
        if level != TurbolinkLevel::Full {
            return None;
        }
        let caps = gmaps_re().captures(target)?;
        let lat: f64 = caps.get(1)?.as_str().parse().ok()?;
        let lon: f64 = caps.get(2)?.as_str().parse().ok()?;
        let zoom: f64 = caps.get(3)?.as_str().parse::<f64>().ok()?.clamp(1.0, 19.0);
        let d_lon = 360.0 / 2f64.powf(zoom);
        let d_lat = d_lon * 0.4;
        let bbox = [lon - d_lon, lat - d_lat, lon + d_lon, lat + d_lat]
            .map(|n| format!("{n:.5}"))
            .join("%2C");
        let marker = format!("{lat:.5}%2C{lon:.5}");
        Some(format!(
            "<iframe class=\"mq-turbolink-frame mq-frame-map\" src=\"https://www.openstreetmap.org/export/embed.html?bbox={bbox}&amp;layer=mapnik&amp;marker={marker}\" height=\"320\" title=\"Map\" loading=\"lazy\"></iframe>"
        ))
    }
    fn css(&self) -> Option<&'static str> {
        Some(FRAME_CSS)
    }
}

/// The fetchless defaults - safe for any build. OpenGraph (which fetches)
/// lives in the opengraph module and joins the chain in fetch mode.
pub fn default_plugins() -> Vec<&'static dyn TurbolinkPlugin> {
    vec![
        &YoutubePlugin,
        &SpotifyPlugin,
        &MapsPlugin,
        &ImagePlugin,
        &AudioPlugin,
        &VideoPlugin,
    ]
}
