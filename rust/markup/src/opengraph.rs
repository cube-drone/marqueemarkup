//! The OpenGraph fallback: the one default plugin that touches the network,
//! and only ever in its resolve() phase - never during render. Composed
//! LAST so the shaped plugins (YouTube, media) win their own kinds; joins
//! the chain automatically in fetch mode.

use crate::turbolink::{render_card, TurbolinkPlugin, TurbolinkSummary};
use marquee_html_renderer::TurbolinkLevel;
use regex::Regex;
use serde_json::{json, Value};
use std::sync::OnceLock;
use std::time::Duration;

const UA: &str =
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

fn decode_entities(s: &str) -> String {
    s.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&amp;", "&")
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
        let body = agent.get(target).call().ok()?.into_string().ok()?;
        parse_open_graph(&body).map(|s| summary_to_value(&s))
    }
    fn render(&self, target: &str, level: TurbolinkLevel, data: Option<&Value>) -> Option<String> {
        let data = data?;
        Some(render_card(target, &value_to_summary(data), level))
    }
}
