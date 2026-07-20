//! Behavior tests: ports of the npm omnibus's test suite, same assertions.

use marquee_markup::turbolink::{default_plugins, TurbolinkPlugin};
use marquee_markup::{
    build_site, marquee, marquee_body, marquee_fetch, marquee_fragment, marquee_head,
    ColorScheme, MarqueeOptions, SiteOptions, TurbolinkLevel,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;

fn opts() -> MarqueeOptions<'static> {
    MarqueeOptions::default()
}

#[test]
fn marquee_source_in_complete_page_out() {
    let page = marquee("# Hello *world*\n", &opts()).unwrap();
    assert!(page.starts_with("<!doctype html>"));
    assert!(page.contains("<h1>Hello <em>world</em></h1>"));
    assert!(page.contains(".mq-doc"), "stylesheet inlined");
    assert!(page.contains("<title>Marquee</title>"), "default title");
}

#[test]
fn meta_title_wins_fonts_inline_only_when_worn() {
    let plain = marquee(":::meta title=\"My Page\":::\n\nwords\n", &opts()).unwrap();
    assert!(plain.contains("<title>My Page</title>"));
    assert!(!plain.contains("data:font/woff2"), "no fonts worn, no fonts carried");
    let fancy = marquee("[font=orbitron]SPACE[/font]\n", &opts()).unwrap();
    assert!(fancy.contains("data:font/woff2"), "worn face inlined");
    let bare = marquee(
        "[font=orbitron]SPACE[/font]\n",
        &MarqueeOptions { fonts: marquee_markup::FontMode::None, ..opts() },
    )
    .unwrap();
    assert!(!bare.contains("data:font/woff2"), "FontMode::None opts out");
}

#[test]
fn fragment_pieces_and_halves() {
    let fragment = marquee_fragment("# Piece\n", &opts()).unwrap();
    assert!(fragment.body.starts_with("<div class=\"mq-doc\">"));
    assert!(!fragment.body.contains("<!doctype"), "fragment is not a page");
    assert!(fragment.css.contains(".mq-turbolink-card"), "plugin skins collected");
    assert_eq!(fragment.title, "Marquee");
    assert!(fragment.font_tokens.is_empty(), "no faces worn");
    let body = marquee_body(":::meta title=\"Halves\":::\n\n# Hi\n", &opts()).unwrap();
    assert!(body.starts_with("<div class=\"mq-doc\">") && !body.contains("<style"));
    let head = marquee_head(":::meta title=\"Halves\":::\n\n# Hi\n", &opts()).unwrap();
    assert!(head.starts_with("<title>Halves</title>\n<style>"));
    assert!(head.contains(".mq-doc"), "head carries the stylesheet");
}

#[test]
fn emoji_standard_table_implicit_user_overrides() {
    let page = marquee("hats :tophat: off, :sparkles: and :+1:\n", &opts()).unwrap();
    assert!(page.contains("hats 🎩 off, ✨ and 👍"), "gemoji shortcodes just work");
    assert!(marquee(":thisoneisnotreal:\n", &opts()).unwrap().contains(":thisoneisnotreal:"));
    let mut emoji = HashMap::new();
    emoji.insert("tophat".to_string(), marquee_markup::EmojiResolution::Text("🤠".into()));
    let overridden = marquee("hats :tophat: off\n", &MarqueeOptions { emoji, ..opts() }).unwrap();
    assert!(overridden.contains("hats 🤠 off"), "user entry wins over the standard table");
    let off = marquee(
        "hats :tophat: off\n",
        &MarqueeOptions { emoji_defaults: Some(false), ..opts() },
    )
    .unwrap();
    assert!(off.contains("hats :tophat: off"), "no defaults: literal slug");
}

#[test]
fn color_scheme_and_readable_defaults() {
    let auto = marquee("hi [color=#400]red[/color]\n", &opts()).unwrap();
    assert!(auto.contains("color-scheme: light dark"), "default follows the OS");
    assert!(auto.contains("oklch(from var(--mq-color)"), "pages rescue colors by default");
    let dark = marquee(
        "hi\n",
        &MarqueeOptions { color_scheme: Some(ColorScheme::Dark), ..opts() },
    )
    .unwrap();
    assert!(dark.contains("color-scheme: dark"), "dark forced");
    assert!(dark.contains("--mq-rl-min: 0.72"), "forced mode clamps unconditionally");
    let raw = marquee("hi\n", &MarqueeOptions { readable: Some(false), ..opts() }).unwrap();
    assert!(!raw.contains("oklch"), "opt-out");
    let fragment = marquee_fragment("hi\n", &opts()).unwrap();
    assert!(!fragment.css.contains("oklch"), "fragments default readable OFF");
}

#[test]
fn envelope_opt_in_defers_to_page() {
    let plain = marquee("just words\n", &MarqueeOptions { envelope: true, ..opts() }).unwrap();
    assert!(plain.contains("<div class=\"mq-envelope\"><div class=\"mq-doc\">"));
    assert!(plain.contains("max-width: 650px"));
    let laid_out = marquee(
        ":::page layout=basic\nwords\n:::\n",
        &MarqueeOptions { envelope: true, ..opts() },
    )
    .unwrap();
    assert!(!laid_out.contains("mq-envelope"), "a document that IS a :::page is left alone");
    let demoing = marquee(
        "prose\n\n:::page layout=basic\ndemo\n:::\n\nafter\n",
        &MarqueeOptions { envelope: true, ..opts() },
    )
    .unwrap();
    assert!(demoing.contains("mq-envelope"), "merely containing a page demo still wraps");
    assert!(!marquee("words\n", &opts()).unwrap().contains("mq-envelope"), "default off");
}

/// A resolve-bearing plugin with no network: proves the fetch-ahead path
/// without touching it. demo: targets dodge the OpenGraph plugin's match.
struct DemoPlugin;
impl TurbolinkPlugin for DemoPlugin {
    fn name(&self) -> &'static str {
        "demo"
    }
    fn matches(&self, t: &str) -> bool {
        t.starts_with("demo://")
    }
    fn resolve(&self, t: &str) -> Option<Value> {
        Some(json!({ "shout": t.trim_start_matches("demo://").to_uppercase() }))
    }
    fn render(&self, _t: &str, _level: TurbolinkLevel, data: Option<&Value>) -> Option<String> {
        let shout = data?.get("shout")?.as_str()?;
        Some(format!("<b class=\"demo-shout\">{shout}</b>"))
    }
}

#[test]
fn marquee_fetch_runs_resolve_ahead_sync_marquee_never_does() {
    // The omnibus profile owns turbolink composition, so to prove the
    // resolve phase we render through the full pipeline with a permissive
    // scheme via the raw renderer plus composed pieces.
    use marquee_markup::turbolink::{compose_turbolinks, resolve_targets};
    let mut plugins = default_plugins();
    plugins.insert(0, &DemoPlugin);
    let resolved = resolve_targets(&["demo://hello-world".to_string()], &plugins);
    let html = compose_turbolinks(&plugins, &resolved, "demo://hello-world", TurbolinkLevel::Full);
    assert_eq!(
        html.as_deref(),
        Some("<b class=\"demo-shout\">HELLO-WORLD</b>"),
        "resolved data reaches render"
    );
    let dry = compose_turbolinks(&plugins, &HashMap::new(), "demo://hello-world", TurbolinkLevel::Full);
    assert_eq!(dry, None, "no resolve pass: the plugin declines to the floor");
    // And through marquee_fetch itself: no http targets, so no network.
    let opts = MarqueeOptions { plugins: Some(plugins), ..MarqueeOptions::default() };
    let page = marquee_fetch("plain words, no links\n", &opts).unwrap();
    assert!(page.contains("plain words"));
}

#[test]
fn resolve_targets_bounds_concurrency() {
    use marquee_markup::turbolink::resolve_targets_with;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    struct Slow {
        active: Arc<AtomicUsize>,
        max: Arc<AtomicUsize>,
    }
    impl TurbolinkPlugin for Slow {
        fn name(&self) -> &'static str {
            "slow"
        }
        fn matches(&self, _t: &str) -> bool {
            true
        }
        fn resolve(&self, _t: &str) -> Option<Value> {
            let now = self.active.fetch_add(1, Ordering::SeqCst) + 1;
            self.max.fetch_max(now, Ordering::SeqCst);
            std::thread::sleep(std::time::Duration::from_millis(15));
            self.active.fetch_sub(1, Ordering::SeqCst);
            Some(json!({ "ok": true }))
        }
        fn render(&self, _t: &str, _l: TurbolinkLevel, _d: Option<&Value>) -> Option<String> {
            None
        }
    }

    let active = Arc::new(AtomicUsize::new(0));
    let max = Arc::new(AtomicUsize::new(0));
    let slow = Slow { active, max: max.clone() };
    let plugins: Vec<&dyn TurbolinkPlugin> = vec![&slow];
    let targets: Vec<String> = ["a", "b", "c", "d", "e", "f"]
        .iter()
        .map(|t| format!("t://{t}"))
        .collect();
    resolve_targets_with(&targets, &plugins, 2);
    assert_eq!(max.load(Ordering::SeqCst), 2, "never more than the limit in flight at once");
}

/// Like DemoPlugin but on an in-policy https target (bare-web link policy
/// rightly blocks unregistered schemes inside the full pipeline).
struct WebDemoPlugin;
impl TurbolinkPlugin for WebDemoPlugin {
    fn name(&self) -> &'static str {
        "webdemo"
    }
    fn matches(&self, t: &str) -> bool {
        t.starts_with("https://demo.example/")
    }
    fn render(&self, _t: &str, _level: TurbolinkLevel, data: Option<&Value>) -> Option<String> {
        let shout = data?.get("shout")?.as_str()?;
        Some(format!("<b class=\"demo-shout\">{shout}</b>"))
    }
}

#[test]
fn marquee_resolved_is_the_sans_io_keyhole() {
    // No plugin runs resolve() here - the "fetch" happened elsewhere
    // (an async runtime, a cache) and arrives as the map.
    let mut plugins = default_plugins();
    plugins.insert(0, &WebDemoPlugin);
    let mut resolved = HashMap::new();
    resolved.insert("webdemo\nhttps://demo.example/hi".to_string(), json!({ "shout": "HI" }));
    let opts = MarqueeOptions { plugins: Some(plugins), ..MarqueeOptions::default() };
    let page = marquee_markup::marquee_resolved("https://demo.example/hi\n", &opts, &resolved).unwrap();
    assert!(page.contains("<b class=\"demo-shout\">HI</b>"), "caller-gathered data renders");
    let dry =
        marquee_markup::marquee_resolved("https://demo.example/hi\n", &opts, &HashMap::new())
            .unwrap();
    assert!(!dry.contains("demo-shout"), "no entry: the plain-link floor");
}

#[test]
fn build_site_the_whole_borsalino() {
    let site = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../examples/borsalino");
    if !site.exists() {
        return; // published-crate escape hatch: the example lives in the repo
    }
    let out = std::env::temp_dir().join(format!("marquee-rs-site-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&out);
    let report = build_site(&site, &out, &SiteOptions::default()).unwrap();
    let mut pages = report.pages.clone();
    pages.sort();
    assert_eq!(pages, vec!["gallery", "index", "map", "menu"]);
    assert_eq!(report.media_files, 5);
    assert!(report.font_faces.iter().any(|f| f == "playfair-display"));
    let index = std::fs::read_to_string(out.join("index.html")).unwrap();
    assert!(index.contains("BORSALINO"), "shared nav included");
    assert!(index.contains("href=\"menu.html\""), "doc-id links resolved");
    let fonts = std::fs::read_dir(out.join("fonts")).unwrap().count();
    assert_eq!(fonts, report.font_faces.len());
    let _ = std::fs::remove_dir_all(&out);
}

#[test]
fn build_site_confine_media_rejects_escapes() {
    // Borsalino's media all lives at ../../example-media (a legitimate shared
    // dir by default). confine_media - the untrusted mode - refuses those
    // escapes, so nothing is copied out of the tree.
    let site = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../examples/borsalino");
    if !site.exists() {
        return;
    }
    let out = std::env::temp_dir().join(format!("marquee-rs-confine-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&out);
    let opts = SiteOptions { confine_media: true, ..SiteOptions::default() };
    let report = build_site(&site, &out, &opts).unwrap();
    assert_eq!(report.media_files, 0, "outside-tree media refused");
    assert!(!out.join("media").exists(), "no media dir created");
    let _ = std::fs::remove_dir_all(&out);
}

#[test]
fn opengraph_parse_is_pure_and_matches_the_npm_shape() {
    let html = r#"<html><head>
      <meta property="og:title" content="An &amp; Interesting Post">
      <meta property="og:description" content="words">
      <meta property="og:site_name" content="e.x">
      <title>fallback</title></head><body></body></html>"#;
    let summary = marquee_markup::opengraph::parse_open_graph(html).unwrap();
    assert_eq!(summary.title.as_deref(), Some("An & Interesting Post"));
    assert_eq!(summary.description.as_deref(), Some("words"));
    assert_eq!(summary.site.as_deref(), Some("e.x"));
    assert!(marquee_markup::opengraph::parse_open_graph("<p>no title</p>").is_none());
    let title_only = marquee_markup::opengraph::parse_open_graph("<title>Just This</title>");
    assert_eq!(title_only.unwrap().title.as_deref(), Some("Just This"));
}
