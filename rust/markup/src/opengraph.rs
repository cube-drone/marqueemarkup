//! The OpenGraph fallback: the one default plugin that touches the network,
//! and only ever in its resolve() phase - never during render. Composed
//! LAST so the shaped plugins (YouTube, media) win their own kinds; joins
//! the chain automatically in fetch mode.

use crate::turbolink::{render_card, TurbolinkPlugin, TurbolinkSummary};
use marquee_html_renderer::TurbolinkLevel;
use regex::Regex;
use serde_json::{json, Value};
use std::io::Read;
use std::sync::OnceLock;
use std::time::Duration;

const UA: &str =
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const MAX_OG_BYTES: u64 = 128 * 1024;

/// Resolve a possibly-relative URL against a base, keeping only http(s). An
/// og:image is relative to the page it came from, not our output; and a
/// javascript:/data: image src should never reach a reader's card.
fn absolute_http(image: &str, base: &str) -> Option<String> {
    let joined = url::Url::parse(base).ok()?.join(image).ok()?;
    match joined.scheme() {
        "http" | "https" => Some(joined.to_string()),
        _ => None,
    }
}

/// The named entities a meta tag is realistically written with. Not the
/// full HTML5 table (2,000+ names); an unknown name is left as-is rather
/// than guessed. Mirror of the npm package's NAMED_ENTITIES.
const NAMED_ENTITIES: &[(&str, &str)] = &[
    ("lt", "<"),
    ("gt", ">"),
    ("quot", "\""),
    ("apos", "'"),
    ("amp", "&"),
    ("nbsp", "\u{a0}"),
    ("ndash", "\u{2013}"),
    ("mdash", "\u{2014}"),
    ("lsquo", "\u{2018}"),
    ("rsquo", "\u{2019}"),
    ("ldquo", "\u{201c}"),
    ("rdquo", "\u{201d}"),
    ("hellip", "\u{2026}"),
    ("copy", "\u{a9}"),
    ("reg", "\u{ae}"),
    ("trade", "\u{2122}"),
    ("laquo", "\u{ab}"),
    ("raquo", "\u{bb}"),
    ("bull", "\u{2022}"),
    ("middot", "\u{b7}"),
];

/// Decode the character references a meta content= can carry: decimal
/// (&#39;), hex (&#x27; - what React/Helmet-rendered heads like CBC's
/// emit), and the common named set. One pass, so `&amp;#x27;` decodes to
/// the literal text `&#x27;` rather than an apostrophe.
fn decode_entities(s: &str) -> String {
    static ENTITY: OnceLock<Regex> = OnceLock::new();
    let re = ENTITY
        .get_or_init(|| Regex::new(r"&(#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z][a-zA-Z0-9]{1,31});").unwrap());
    re.replace_all(s, |caps: &regex::Captures| {
        let body = &caps[1];
        let decoded = if let Some(hex) = body.strip_prefix('#').and_then(|b| {
            b.strip_prefix('x').or_else(|| b.strip_prefix('X'))
        }) {
            u32::from_str_radix(hex, 16).ok().and_then(decode_codepoint)
        } else if let Some(dec) = body.strip_prefix('#') {
            dec.parse::<u32>().ok().and_then(decode_codepoint)
        } else {
            NAMED_ENTITIES
                .iter()
                .find(|(name, _)| *name == body)
                .map(|(_, text)| text.to_string())
        };
        // Unknown or unrepresentable: keep the source text untouched.
        decoded.unwrap_or_else(|| caps[0].to_string())
    })
    .into_owned()
}

/// A numeric reference to NUL, a surrogate, or beyond U+10FFFF has no
/// character to become; leave it alone.
fn decode_codepoint(n: u32) -> Option<String> {
    if n == 0 {
        return None;
    }
    char::from_u32(n).map(|c| c.to_string())
}

fn meta(head: &str, prop: &str) -> Option<String> {
    let tag_re = Regex::new(&format!(
        r#"(?i)<meta[^>]+(?:property|name)=["']{}["'][^>]*>"#,
        regex::escape(prop)
    ))
    .ok()?;
    let tag = tag_re.find(head)?.as_str();
    static CONTENT: OnceLock<Regex> = OnceLock::new();
    let content_re =
        CONTENT.get_or_init(|| Regex::new(r#"(?i)content=["']([^"']*)["']"#).unwrap());
    let content = content_re.captures(tag)?.get(1)?.as_str();
    if content.is_empty() {
        None
    } else {
        Some(decode_entities(content))
    }
}

/// Pure and separately testable: html text in, summary out. Mirrors the
/// npm package's parseOpenGraph.
pub fn parse_open_graph(html: &str) -> Option<TurbolinkSummary> {
    // Metadata lives up top; stay bounded (on a char boundary).
    let mut end = html.len().min(65536);
    while !html.is_char_boundary(end) {
        end -= 1;
    }
    let head = &html[..end];
    static TITLE: OnceLock<Regex> = OnceLock::new();
    let title_re = TITLE.get_or_init(|| Regex::new(r"(?i)<title[^>]*>([^<]*)</title>").unwrap());
    let title = meta(head, "og:title").or_else(|| {
        title_re
            .captures(head)
            .and_then(|c| c.get(1))
            .map(|m| decode_entities(m.as_str().trim()))
            .filter(|t| !t.is_empty())
    })?;
    Some(TurbolinkSummary {
        title: Some(title),
        description: meta(head, "og:description").or_else(|| meta(head, "description")),
        image: meta(head, "og:image"),
        site: meta(head, "og:site_name"),
    })
}

fn summary_to_value(s: &TurbolinkSummary) -> Value {
    json!({
        "title": s.title,
        "description": s.description,
        "image": s.image,
        "site": s.site,
    })
}

fn value_to_summary(v: &Value) -> TurbolinkSummary {
    let field = |k: &str| v.get(k).and_then(Value::as_str).map(str::to_string);
    TurbolinkSummary {
        title: field("title"),
        description: field("description"),
        image: field("image"),
        site: field("site"),
    }
}

pub struct OpengraphPlugin;

impl TurbolinkPlugin for OpengraphPlugin {
    fn name(&self) -> &'static str {
        "opengraph"
    }
    fn matches(&self, target: &str) -> bool {
        target.starts_with("http://") || target.starts_with("https://")
    }
    fn resolve(&self, target: &str) -> Option<Value> {
        // Generous but finite: a hung server costs ten seconds, never a
        // hung build. A failed fetch is a plain link, not a failed render.
        let agent = ureq::AgentBuilder::new()
            .timeout(Duration::from_secs(10))
            .user_agent(UA)
            .build();
        let resp = agent.get(target).call().ok()?;
        // A linked image/PDF/zip has no OpenGraph - don't stream a binary body
        // to parse nothing. (Empty/absent type: allow, let the parse decide.)
        let ct = resp.content_type().to_string();
        if !ct.is_empty() && !ct.contains("html") && !ct.contains("text/plain") {
            return None;
        }
        // get_url() is the post-redirect URL: the right base for a relative image.
        let final_url = resp.get_url().to_string();
        // Bound the DOWNLOAD, not just the parse: cap the body so a hostile or
        // merely huge page can't blow up the build's memory before parse_open_graph
        // caps the parse.
        let mut buf = Vec::new();
        resp.into_reader().take(MAX_OG_BYTES).read_to_end(&mut buf).ok()?;
        let body = String::from_utf8_lossy(&buf);
        let mut summary = parse_open_graph(&body)?;
        summary.image = summary.image.take().and_then(|img| absolute_http(&img, &final_url));
        Some(summary_to_value(&summary))
    }
    fn render(&self, target: &str, level: TurbolinkLevel, data: Option<&Value>) -> Option<String> {
        let data = data?;
        Some(render_card(target, &value_to_summary(data), level))
    }
}
