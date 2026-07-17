//! AST -> HTML string. The safety contract: author bytes reach the output
//! only through escape_text/escape_attr, targets only through the profile's
//! allowlist, and attribute *names* are never author-controlled. Unknown
//! vocabulary shrugs (children survive, effect doesn't); comments render
//! nothing; invalid constructs render inert placeholders.

use crate::escape::{escape_attr, escape_text};
use crate::profile::{EmojiResolution, MediaKind, Profile, TurbolinkLevel};
use marquee_parser::{Attrs, Node};
use unicode_segmentation::UnicodeSegmentation;

/// The font vocabulary (closed, two tiers). Kept in lockstep with the
/// TypeScript renderer's FONTS map - it is the same spec vocabulary.
pub const FONTS: &[(&str, &str)] = &[
    // standard stacks
    ("sans", "sans-serif"),
    ("serif", "serif"),
    ("mono", "monospace"),
    ("comic", "Comic Sans MS"),
    // the grab bag
    ("radio-canada", "Radio Canada"),
    ("atkinson-hyperlegible", "Atkinson Hyperlegible"),
    ("lexend", "Lexend"),
    ("zilla-slab", "Zilla Slab"),
    ("playfair-display", "Playfair Display"),
    ("cormorant", "Cormorant"),
    ("im-fell-english", "IM Fell English"),
    ("uncial-antiqua", "Uncial Antiqua"),
    ("unifraktur", "UnifrakturMaguntia"),
    ("jetbrains-mono", "JetBrains Mono"),
    ("vt323", "VT323"),
    ("press-start", "Press Start 2P"),
    ("silkscreen", "Silkscreen"),
    ("major-mono", "Major Mono Display"),
    ("orbitron", "Orbitron"),
    ("bungee", "Bungee"),
    ("monoton", "Monoton"),
    ("creepster", "Creepster"),
    ("special-elite", "Special Elite"),
    ("fredericka", "Fredericka the Great"),
    ("lobster", "Lobster"),
    ("pacifico", "Pacifico"),
    ("caveat", "Caveat"),
    ("comic-neue", "Comic Neue"),
    ("audiowide", "Audiowide"),
    ("kablammo", "Kablammo"),
    ("henny-penny", "Henny Penny"),
    ("oi", "Oi"),
    ("rye", "Rye"),
    ("bitcount", "Bitcount"),
    ("quicksand", "Quicksand"),
];

fn font_face(token: &str) -> Option<&'static str> {
    FONTS.iter().find(|(t, _)| *t == token).map(|(_, f)| *f)
}

/// Which grab-bag faces does this rendered HTML actually wear? Pure string
/// scan of the mq-font-* class contract.
pub fn used_font_tokens(html: &str) -> Vec<String> {
    let mut used = std::collections::BTreeSet::new();
    let mut rest = html;
    while let Some(at) = rest.find("mq-font-") {
        let after = &rest[at + "mq-font-".len()..];
        let end = after
            .bytes()
            .take_while(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'-')
            .count();
        if end > 0 {
            used.insert(after[..end].to_string());
        }
        rest = &after[end..];
    }
    used.into_iter().collect()
}

/// Render state: the profile, plus the one piece of cross-block
/// coordination the renderer owns - aside numbering (sequential through the
/// document) and the pending notes that flush after the triggering block.
struct Ctx<'a> {
    profile: &'a dyn Profile,
    note_n: u32,
    pending: Vec<String>,
}

pub fn render(node: &Node, profile: &dyn Profile) -> String {
    let mut ctx = Ctx { profile, note_n: 0, pending: Vec::new() };
    render_node(node, &mut ctx)
}

/// Asides render just below the paragraph (or heading) that triggered
/// them - part of regular flow, no floats, no popups.
fn flush_notes(ctx: &mut Ctx, html: String) -> String {
    if ctx.pending.is_empty() {
        return html;
    }
    let notes: String = ctx
        .pending
        .drain(..)
        .map(|n| format!("<p class=\"mq-note\">{n}</p>"))
        .collect();
    format!("{html}<aside class=\"mq-notes\">{notes}</aside>")
}

fn render_node(node: &Node, ctx: &mut Ctx) -> String {
    match node {
        Node::Document { children: c, .. } => {
            format!("<div class=\"mq-doc\">{}</div>", children(c, ctx))
        }
        Node::Paragraph { children: c } => {
            let html = format!("<p>{}</p>", children(c, ctx));
            flush_notes(ctx, html)
        }
        Node::Heading { level, children: c } => {
            // HTML's ladder stops at h6; levels 7-8 (the grammar allows 1-8)
            // keep real heading semantics via ARIA on a styled block.
            let inner = children(c, ctx);
            let html = if *level <= 6 {
                format!("<h{level}>{inner}</h{level}>")
            } else {
                format!("<p class=\"mq-h{level}\" role=\"heading\" aria-level=\"{level}\">{inner}</p>")
            };
            flush_notes(ctx, html)
        }
        Node::CodeBlock { info, text } => {
            let cls = match info.as_deref().and_then(info_token) {
                Some(lang) => format!(" class=\"language-{}\"", escape_attr(lang)),
                None => String::new(),
            };
            let body = if text.is_empty() {
                String::new()
            } else {
                format!("{}\n", escape_text(text))
            };
            format!("<pre class=\"mq-code\"><code{cls}>{body}</code></pre>")
        }
        Node::Blockquote { children: c } => {
            format!("<blockquote>{}</blockquote>", children(c, ctx))
        }
        Node::List { ordered, children: c } => {
            let tag = if *ordered { "ol" } else { "ul" };
            format!("<{tag}>{}</{tag}>", children(c, ctx))
        }
        Node::ListItem { children: c } => format!("<li>{}</li>", children(c, ctx)),
        Node::ThematicBreak => "<hr>".to_string(),
        Node::Directive { name, attrs, children: c } => directive(name, attrs, c, ctx),
        Node::InvalidDirective { reason, .. } => {
            let reason = serde_reason(reason);
            format!("<div class=\"mq-invalid\" data-reason=\"{reason}\"></div>")
        }
        Node::Comment { .. } => String::new(), // the anti-shrug: absence
        Node::Text { value } => escape_text(value),
        Node::Emphasis { children: c } => format!("<em>{}</em>", children(c, ctx)),
        Node::Strong { children: c } => format!("<strong>{}</strong>", children(c, ctx)),
        Node::Strikethrough { children: c } => format!("<del>{}</del>", children(c, ctx)),
        Node::CodeSpan { text } => format!("<code>{}</code>", escape_text(text)),
        Node::Link { target, children: c } => {
            let inner = children(c, ctx);
            if ctx.profile.link_allowed(target) {
                format!("<a href=\"{}\">{inner}</a>", escape_attr(target))
            } else {
                format!("<span class=\"mq-blocked\">{inner}</span>")
            }
        }
        Node::Embed { target, alt } => embed(target, alt, ctx.profile),
        Node::Turbolink { target } => turbolink(target, None, ctx.profile),
        Node::Span { name, attrs, children: c } => span(name, attrs, c, ctx),
        Node::Emoji { slug } => match ctx.profile.emoji(slug) {
            Some(EmojiResolution::Image { url, alt }) => {
                let alt = alt.unwrap_or_else(|| format!(":{slug}:"));
                format!(
                    "<img class=\"mq-emoji\" src=\"{}\" alt=\"{}\" loading=\"lazy\">",
                    escape_attr(&url),
                    escape_attr(&alt)
                )
            }
            Some(EmojiResolution::Text(text)) => escape_text(&text),
            None => escape_text(&format!(":{slug}:")),
        },
        Node::HardBreak => "<br>".to_string(),
    }
}

/// The reason's snake_case wire name (matching its vector serialization).
fn serde_reason(reason: &marquee_parser::Reason) -> &'static str {
    use marquee_parser::Reason::*;
    match reason {
        BadName => "bad_name",
        BadAttribute => "bad_attribute",
        AttributeTooLong => "attribute_too_long",
        DepthExceeded => "depth_exceeded",
        MismatchedClose => "mismatched_close",
        StrayClose => "stray_close",
    }
}

fn children(nodes: &[Node], ctx: &mut Ctx) -> String {
    nodes.iter().map(|n| render_node(n, ctx)).collect()
}

// -- validation gates (closed value grammars; failures degrade, never emit)

fn is_hex_color(v: &str) -> bool {
    let b = v.as_bytes();
    (b.len() == 4 || b.len() == 7)
        && b[0] == b'#'
        && b[1..].iter().all(|c| c.is_ascii_hexdigit())
}

fn is_token(v: &str) -> bool {
    let b = v.as_bytes();
    !b.is_empty()
        && b.len() <= 32
        && b[0].is_ascii_lowercase()
        && b.iter().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'-')
}

fn is_color_value(v: &str) -> bool {
    is_hex_color(v) || is_token(v)
}

fn is_count(v: &str) -> bool {
    !v.is_empty() && v.len() <= 4 && v.bytes().all(|b| b.is_ascii_digit())
}

fn info_token(info: &str) -> Option<&str> {
    let first = info.split([' ', '\t']).next().unwrap_or("");
    let ok = !first.is_empty()
        && first.len() <= 64
        && first
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'+' | b'.' | b'#' | b'-'));
    ok.then_some(first)
}

// -- constructs

fn embed(target: &str, alt: &str, profile: &dyn Profile) -> String {
    if let Some(media) = profile.media(target) {
        let url = escape_attr(&media.url);
        let alt_attr = escape_attr(alt);
        return match media.kind {
            MediaKind::Image => {
                format!("<img class=\"mq-embed\" src=\"{url}\" alt=\"{alt_attr}\" loading=\"lazy\">")
            }
            MediaKind::Audio => format!(
                "<audio class=\"mq-embed\" controls src=\"{url}\" aria-label=\"{alt_attr}\"></audio>"
            ),
            MediaKind::Video => format!(
                "<video class=\"mq-embed\" controls src=\"{url}\" aria-label=\"{alt_attr}\"></video>"
            ),
        };
    }
    // The contractual shrug applied to media: degrade to a labeled link, or
    // to inert text when the scheme is out of policy.
    let label = escape_text(&format!("[{}]", if alt.is_empty() { target } else { alt }));
    if profile.link_allowed(target) {
        format!("<a class=\"mq-embed-fallback\" href=\"{}\">{label}</a>", escape_attr(target))
    } else {
        format!("<span class=\"mq-embed-fallback\">{label}</span>")
    }
}

fn turbolink(target: &str, level_attr: Option<&str>, profile: &dyn Profile) -> String {
    if !profile.link_allowed(target) {
        return format!("<p class=\"mq-turbolink\">{}</p>", escape_text(target));
    }
    let level = match level_attr {
        Some("full") => TurbolinkLevel::Full,
        Some("title") => TurbolinkLevel::Title,
        Some("bare") => TurbolinkLevel::Bare,
        _ => profile.turbolink_level(target),
    };
    if level != TurbolinkLevel::Bare {
        if let Some(rich) = profile.turbolink(target, level) {
            // Enrichment augments, never replaces: the wrapper itself
            // carries the original link.
            return format!(
                "<div class=\"mq-turbolink mq-turbolink-rich\">{rich}<a class=\"mq-turbolink-source\" href=\"{}\">{}</a></div>",
                escape_attr(target),
                escape_text(target)
            );
        }
    }
    // The contractual floor: a plain link, always reachable.
    format!(
        "<p class=\"mq-turbolink\"><a href=\"{}\">{}</a></p>",
        escape_attr(target),
        escape_text(target)
    )
}

/// A resolved URL made safe for a CSS url("...") token: percent-encode
/// whitespace, controls, backslashes, quotes, and parens, so the value can
/// never terminate the url() or the declaration - author bytes must not
/// write CSS, even inside their own style attribute.
fn css_url(url: &str) -> String {
    let mut out = String::with_capacity(url.len());
    for b in url.bytes() {
        match b {
            b'"' | b'\'' | b'(' | b')' | b'\\' | b'<' | b'>' | b'`' | b'{' | b'}' | b'|'
            | b'^' | 0x00..=0x20 | 0x7f.. => {
                out.push_str(&format!("%{b:02X}"));
            }
            _ => out.push(b as char),
        }
    }
    out
}

/// Style knobs on a block node: validated values into --mq-* slots; the
/// stylesheet owns which CSS property each slot feeds. `background` takes a
/// color, or `tile:<target>` - a tiled background image, resolved through
/// the embedder's media policy exactly as an embed (a background fetch is a
/// fetch): out-of-policy or non-image targets degrade to no background.
fn style_vars(attrs: &Attrs, profile: &dyn Profile) -> String {
    let mut vars: Vec<String> = Vec::new();
    if let Some(v) = attrs.get("color").filter(|v| is_color_value(v)) {
        vars.push(format!("--mq-color:{v}"));
    }
    match attrs.get("background") {
        Some(v) if is_color_value(v) => vars.push(format!("--mq-bg:{v}")),
        Some(v) => {
            if let Some(target) = v.strip_prefix("tile:") {
                if let Some(media) = profile.media(target) {
                    if media.kind == MediaKind::Image {
                        // Single-quoted url token: the style attribute itself
                        // is double-quoted; css_url percent-encodes quotes.
                        vars.push(format!("--mq-bg-tile:url('{}')", css_url(&media.url)));
                    }
                }
            }
        }
        None => {}
    }
    if vars.is_empty() {
        String::new()
    } else {
        format!(" style=\"{}\"", vars.join(";"))
    }
}

fn scheme_class(attrs: &Attrs) -> String {
    match attrs.get("scheme").filter(|v| is_token(v)) {
        Some(v) => format!(" mq-scheme-{v}"),
        None => String::new(),
    }
}

fn font_class(attrs: &Attrs) -> String {
    match attrs.get("font").filter(|v| font_face(v).is_some()) {
        Some(v) => format!(" mq-font-{v}"),
        None => String::new(),
    }
}

fn media_size(v: &str) -> Option<String> {
    match v {
        "small" => return Some("10rem".to_string()),
        "medium" => return Some("20rem".to_string()),
        "large" => return Some("32rem".to_string()),
        "full" => return Some("100%".to_string()),
        _ => {}
    }
    if is_count(v) {
        let n: u32 = v.parse().ok()?;
        if (1..=4096).contains(&n) {
            return Some(format!("{n}px"));
        }
    }
    None
}

fn directive(name: &str, attrs: &Attrs, nodes: &[Node], ctx: &mut Ctx) -> String {
    let inner = children(nodes, ctx);
    if let Some(custom) = ctx.profile.directive(name, attrs, &inner) {
        return custom;
    }
    match name {
        // Carries metadata, renders nothing by default - but never eats an
        // (unconventional) body.
        "meta" => inner,
        "page" => {
            let layout = match attrs.get("layout").filter(|v| is_token(v)) {
                Some(v) => format!(" mq-layout-{v}"),
                None => String::new(),
            };
            format!(
                "<div class=\"mq-page{layout}{}{}\"{}>{inner}</div>",
                scheme_class(attrs),
                font_class(attrs),
                style_vars(attrs, ctx.profile)
            )
        }
        "section" => {
            let slot = match attrs.get("slot").filter(|v| is_token(v)) {
                Some(v) => format!(" data-slot=\"{v}\""),
                None => String::new(),
            };
            format!(
                "<section class=\"mq-section{}{}\"{slot}{}>{inner}</section>",
                scheme_class(attrs),
                font_class(attrs),
                style_vars(attrs, ctx.profile)
            )
        }
        "turbolink" if attrs.contains_key("target") => {
            turbolink(attrs.get("target").unwrap(), attrs.get("level").map(|s| s.as_str()), ctx.profile)
        }
        "media" => {
            let mut vars: Vec<String> = Vec::new();
            if let Some(w) = attrs.get("width").and_then(|v| media_size(v)) {
                vars.push(format!("--mq-media-w:{w}"));
            }
            if let Some(h) = attrs.get("height").and_then(|v| media_size(v)) {
                vars.push(format!("--mq-media-h:{h}"));
            }
            let style = if vars.is_empty() {
                String::new()
            } else {
                format!(" style=\"{}\"", vars.join(";"))
            };
            format!("<div class=\"mq-media\"{style}>{inner}</div>")
        }
        "table" => render_table(attrs, nodes, ctx),
        // The <center> tag, back from the dead in directive clothing - plus
        // right for symmetry and left as the un-aligner. Physical
        // directions, deliberately: predictable beats logical.
        "center" | "right" | "left" => format!("<div class=\"mq-{name}\">{inner}</div>"),
        // Block form of the [spoiler] span: hide a whole region (image,
        // paragraph) behind the same blur; the mq-spoiler CSS is
        // element-agnostic.
        "spoiler" => {
            format!("<div class=\"mq-spoiler mq-spoiler-block\" tabindex=\"0\">{inner}</div>")
        }
        // Versioned-document conflict: a container of :::variant alternatives,
        // synthesized by an embedder at read time. The unknown-container shrug
        // keeps it lossless on a renderer that predates it (variants' words
        // survive, stacked); this rendering is presentation over that.
        "conflict" => format!("<div class=\"mq-conflict\">{inner}</div>"),
        // One alternative. label/when are advisory display text, shown VERBATIM
        // (reformatting a timestamp would make renderers disagree); role=base
        // marks the common ancestor.
        "variant" => {
            let mut head: Vec<String> = Vec::new();
            if let Some(label) = attrs.get("label") {
                head.push(format!("<span class=\"mq-variant-label\">{}</span>", escape_text(label)));
            }
            if let Some(when) = attrs.get("when") {
                head.push(format!("<span class=\"mq-variant-when\">{}</span>", escape_text(when)));
            }
            let cls = if attrs.get("role").map(String::as_str) == Some("base") {
                "mq-variant mq-variant-base"
            } else {
                "mq-variant"
            };
            let head_html = if head.is_empty() {
                String::new()
            } else {
                format!("<div class=\"mq-variant-head\">{}</div>", head.join(" "))
            };
            format!("<div class=\"{cls}\">{head_html}{inner}</div>")
        }
        // Unknown vocabulary: a container renders its children with an
        // affordance that something wrapped them; a leaf renders the inert
        // placeholder. Never eat authored content.
        _ if !nodes.is_empty() => format!(
            "<div class=\"mq-unknown\" data-directive=\"{}\">{inner}</div>",
            escape_attr(name)
        ),
        _ => format!(
            "<div class=\"mq-placeholder\" data-directive=\"{}\"></div>",
            escape_attr(name)
        ),
    }
}

/// :::table (SPEC.md, "Tables"): each paragraph child is a row; a row's
/// cells are its top-level `[c]` spans, and loose inline content between
/// cells coalesces into implicit cells (never eaten). A non-paragraph block
/// child is a full-width single-cell row. `header=row|column|both` promotes
/// the first row / first column to <th> with scope - header association is
/// the accessibility half of tables, hoisted onto the one attr.
fn render_table(attrs: &Attrs, nodes: &[Node], ctx: &mut Ctx) -> String {
    let header = attrs.get("header").map(|s| s.as_str());
    let head_row = matches!(header, Some("row") | Some("both"));
    let head_col = matches!(header, Some("column") | Some("both"));
    let mut rows: Vec<String> = Vec::new();
    for node in nodes {
        let mut cells: Vec<String> = Vec::new();
        if let Node::Paragraph { children: kids } = node {
            let mut loose: Vec<&Node> = Vec::new();
            let flush_loose = |loose: &mut Vec<&Node>, cells: &mut Vec<String>, ctx: &mut Ctx| {
                let has_content = loose.iter().any(|n| match n {
                    Node::Text { value } => !value.trim().is_empty(),
                    _ => true,
                });
                if has_content {
                    cells.push(loose.iter().map(|n| render_node(n, ctx)).collect());
                }
                loose.clear();
            };
            for child in kids {
                match child {
                    Node::Span { name, children: c, .. } if name == "c" => {
                        flush_loose(&mut loose, &mut cells, ctx);
                        cells.push(children(c, ctx));
                    }
                    other => loose.push(other),
                }
            }
            flush_loose(&mut loose, &mut cells, ctx);
        } else {
            cells.push(render_node(node, ctx));
        }
        let is_head_row = head_row && rows.is_empty();
        let cells_html: String = cells
            .iter()
            .enumerate()
            .map(|(i, cell)| {
                if is_head_row || (head_col && i == 0) {
                    let scope = if is_head_row { "col" } else { "row" };
                    format!("<th scope=\"{scope}\">{cell}</th>")
                } else {
                    format!("<td>{cell}</td>")
                }
            })
            .collect();
        rows.push(format!("<tr>{cells_html}</tr>"));
    }
    // Cell sidenotes land just below the table, like a paragraph's would.
    flush_notes(ctx, format!("<table class=\"mq-table\">{}</table>", rows.concat()))
}

/// One rung of the font-element seven-step dial: presentational floor
/// (works with no stylesheet, under any CSP), stylesheet class as ceiling.
fn size_rung(value: &str, inner: &str) -> String {
    format!("<font class=\"mq-size-{value}\" size=\"{value}\">{inner}</font>")
}

fn span(name: &str, attrs: &Attrs, nodes: &[Node], ctx: &mut Ctx) -> String {
    let inner = children(nodes, ctx);
    if let Some(custom) = ctx.profile.span(name, attrs, &inner) {
        return custom;
    }
    match name {
        "sup" => format!("<sup>{inner}</sup>"),
        "sub" => format!("<sub>{inner}</sub>"),
        "small" => format!("<small>{inner}</small>"),
        "big" => format!("<big>{inner}</big>"), // obsolete and eternal
        // Content present, never eaten - blurred, revealed on hover/focus
        // (no JS to gate a click here); an interactive renderer makes the
        // same class click-to-reveal. Degrades to a visible spoiler.
        "spoiler" => format!("<span class=\"mq-spoiler\" tabindex=\"0\">{inner}</span>"),
        "size" => match attrs.get("size").map(|s| s.as_str()) {
            Some(v @ ("1" | "2" | "3" | "4" | "5" | "6" | "7")) => size_rung(v, &inner),
            _ => inner, // off the dial: the effect degrades, the words survive
        },
        "teeny" => size_rung("1", &inner),
        "tiny" => size_rung("2", &inner),
        "huge" => size_rung("6", &inner),
        "enormous" => size_rung("7", &inner),
        "color" => match attrs.get("color").filter(|v| is_color_value(v)) {
            // Presentational floor + custom-property ceiling, one element.
            Some(v) => format!(
                "<font class=\"mq-color\" color=\"{v}\" style=\"--mq-color:{v}\">{inner}</font>"
            ),
            None => inner,
        },
        "font" => match attrs.get("font").map(|s| s.as_str()).and_then(font_face) {
            Some(face) => {
                let token = attrs.get("font").unwrap();
                format!(
                    "<font class=\"mq-font-{token}\" face=\"{}\">{inner}</font>",
                    escape_attr(face)
                )
            }
            None => inner, // not on the list: words in their own clothes
        },
        // Permanent synonyms (SPEC.md): the list-marker rule, one layer up.
        "sidenote" | "aside" | "footnote" => {
            // A numbered mark in the flow; the note flushes just below the
            // triggering paragraph (see flush_notes).
            ctx.note_n += 1;
            let n = ctx.note_n;
            ctx.pending.push(format!("<span class=\"mq-note-num\">{n}</span>{inner}"));
            format!("<sup class=\"mq-noteref\">{n}</sup>")
        }
        "marquee" => {
            let dir = match attrs.get("direction").filter(|v| is_token(v)) {
                Some(v) => format!(" data-direction=\"{v}\""),
                None => String::new(),
            };
            let speed = match attrs.get("speed").filter(|v| is_count(v)) {
                Some(v) => format!(" style=\"--mq-speed:{v}\""),
                None => String::new(),
            };
            format!(
                "<span class=\"mq-marquee\"{dir}{speed}><span class=\"mq-marquee-inner\">{inner}</span></span>"
            )
        }
        "blink" => {
            let rate = match attrs.get("rate").filter(|v| is_count(v)) {
                Some(v) => format!(" style=\"--mq-rate:{v}\""),
                None => String::new(),
            };
            match attrs.get("by").map(|s| s.as_str()) {
                // Split blink: ramp is theater-marquee chase lights, scatter
                // is twinkle. The rate var rides the container.
                Some(by @ ("letter" | "word")) => {
                    by_segments(name, by, attrs.get("phase").map(|s| s.as_str()), nodes, ctx, &rate)
                }
                _ => format!("<span class=\"mq-blink\"{rate}>{inner}</span>"),
            }
        }
        "rainbow" | "bounce" | "jitter" | "wave" | "rubber" => {
            match attrs.get("by").map(|s| s.as_str()) {
                Some(by @ ("letter" | "word")) => {
                    by_segments(name, by, attrs.get("phase").map(|s| s.as_str()), nodes, ctx, "")
                }
                _ => format!("<span class=\"mq-{name}\">{inner}</span>"),
            }
        }
        "typewriter" => {
            // Inherently per-unit: the reveal IS a by=letter effect (by=word
            // for word-at-a-time). speed= is units per second; the container
            // carries the per-unit delay step, each unit its ordinal in --mq-o.
            let by = match attrs.get("by").map(|s| s.as_str()) {
                Some("word") => "word",
                _ => "letter",
            };
            let step = reveal_step(attrs.get("speed").map(|s| s.as_str()), 14.0);
            let style = format!(" style=\"--mq-tw-step:{step}s\"");
            by_segments(name, by, attrs.get("phase").map(|s| s.as_str()), nodes, ctx, &style)
        }
        "fadein" => {
            // The ghostly reveal. Bare [fadein] fades the whole run in once;
            // by=letter / by=word drift units in on staggered starts (same
            // one-shot family as typewriter); phase=scatter is apparition
            // weather.
            match attrs.get("by").map(|s| s.as_str()) {
                Some(by @ ("letter" | "word")) => {
                    let step = reveal_step(attrs.get("speed").map(|s| s.as_str()), 16.0);
                    let style = format!(" style=\"--mq-fi-step:{step}s\"");
                    by_segments(name, by, attrs.get("phase").map(|s| s.as_str()), nodes, ctx, &style)
                }
                _ => format!("<span class=\"mq-fadein\">{inner}</span>"),
            }
        }
        _ => inner, // unknown span: pure shrug, children as plain content
    }
}

// -- per-unit effects (by=letter / by=word): each unit in its own span with
// a phase offset in --mq-o; the stylesheet replays the effect's keyframes
// through a negative animation-delay. Segmentation is this renderer's own
// (unicode-segmentation); per-renderer goldens, not cross-renderer bytes.

/// Loopers pay a live animation per element forever, so they cap low;
/// typewriter's units are 1ms one-shots and its natural material is long
/// text, so it caps high.
const MAX_SPLIT_UNITS: usize = 400;
const MAX_REVEAL_UNITS: usize = 2000;

/// The one-shot reveals: sequential ordinals, the high unit cap.
fn is_reveal(effect: &str) -> bool {
    effect == "typewriter" || effect == "fadein"
}

/// speed= (units per second, a COUNT) into a per-unit delay step in
/// seconds; invalid or absent falls to the effect's default rate.
fn reveal_step(speed_attr: Option<&str>, dflt: f64) -> f64 {
    let speed = speed_attr
        .filter(|v| is_count(v))
        .and_then(|v| v.parse::<f64>().ok())
        .filter(|v| *v > 0.0)
        .unwrap_or(dflt);
    (1000.0 / speed).round() / 1000.0
}

fn gcd(a: usize, b: usize) -> usize {
    if b == 0 {
        a
    } else {
        gcd(b, a % b)
    }
}

/// The smallest stride >= ~61.8% of total that's coprime with it (falls
/// back to 1 for degenerate totals).
fn scatter_stride(total: usize) -> usize {
    let mut stride = ((total as f64) * 0.618).round().max(1.0) as usize;
    while stride < total && gcd(stride, total) != 1 {
        stride += 1;
    }
    if gcd(stride, total) == 1 {
        stride
    } else {
        1
    }
}

struct SplitState<'s> {
    effect: &'s str,
    by: &'s str,
    phase: &'s str,
    i: usize,
    total: usize,
}

fn by_segments(
    effect: &str,
    by: &str,
    phase_attr: Option<&str>,
    nodes: &[Node],
    ctx: &mut Ctx,
    container_style: &str,
) -> String {
    // Each effect has a natural phase order (jitter scatters, the rest
    // sweep); the knob overrides either way.
    let phase = match phase_attr {
        Some(p @ ("scatter" | "ramp")) => p,
        _ => {
            if effect == "jitter" {
                "scatter"
            } else {
                "ramp"
            }
        }
    };
    let total = count_units(nodes, by);
    let cap = if is_reveal(effect) { MAX_REVEAL_UNITS } else { MAX_SPLIT_UNITS };
    if total == 0 || total > cap {
        let inner = children(nodes, ctx);
        return format!("<span class=\"mq-{effect}\">{inner}</span>");
    }
    let mut state = SplitState { effect, by, phase, i: 0, total };
    let inner = split_render(nodes, ctx, &mut state);
    format!("<span class=\"mq-{effect} mq-split\"{container_style}>{inner}</span>")
}

fn segments<'t>(text: &'t str, by: &str) -> Vec<&'t str> {
    if by == "word" {
        text.split_word_bounds().collect()
    } else {
        text.graphemes(true).collect()
    }
}

/// A segment gets wrapped if it's animatable: for words, word-like segments
/// (spaces and bare punctuation ride along); for letters, anything that
/// isn't whitespace.
fn is_unit(segment: &str, by: &str) -> bool {
    if by == "word" {
        segment.chars().any(|c| c.is_alphanumeric())
    } else {
        !segment.trim().is_empty()
    }
}

/// Offsets are deterministic (goldens exist; a document renders the same
/// twice) in both phase orders: ramp sweeps, scatter scrambles by a fixed
/// integer hash - randomness-shaped, never random.
fn unit_offset(state: &SplitState) -> String {
    // Reveal offsets (typewriter, fadein) are sequential INTEGERS (the
    // ordinal; delay = ordinal x step), unlike the cyclic 0..1 fractions
    // the looping effects replay. phase=scatter walks a golden-ratio-stride
    // permutation - a fixed prime stride is a trap (7919 mod 40 = -1:
    // forty-unit runs typed in backwards).
    if is_reveal(state.effect) {
        let o = if state.phase == "scatter" {
            (state.i * scatter_stride(state.total)) % state.total
        } else {
            state.i
        };
        return o.to_string();
    }
    let o: f64 = if state.phase == "scatter" {
        ((state.i * 7919) % 101) as f64 / 101.0
    } else {
        match state.effect {
            "rainbow" => state.i as f64 / state.total as f64,
            "wave" => (state.i % 8) as f64 / 8.0,
            "bounce" => (state.i % 6) as f64 / 6.0,
            _ => (state.i % 8) as f64 / 8.0, // jitter in ramp mode: a ripple
        }
    };
    let rounded = (o * 1000.0).round() / 1000.0;
    // Trim like JS number formatting: no trailing zeros, bare 0.
    let s = format!("{rounded}");
    s
}

fn count_units(nodes: &[Node], by: &str) -> usize {
    let mut n = 0;
    for node in nodes {
        match node {
            Node::Text { value } => {
                n += segments(value, by).iter().filter(|s| is_unit(s, by)).count();
            }
            Node::Emphasis { children: c }
            | Node::Strong { children: c }
            | Node::Strikethrough { children: c } => {
                n += count_units(c, by);
            }
            _ => {}
        }
    }
    n
}

fn split_render(nodes: &[Node], ctx: &mut Ctx, state: &mut SplitState) -> String {
    let mut out = String::new();
    for node in nodes {
        match node {
            Node::Text { value } => {
                for segment in segments(value, state.by) {
                    if !is_unit(segment, state.by) {
                        out.push_str(&escape_text(segment)); // rides along
                        continue;
                    }
                    let o = unit_offset(state);
                    state.i += 1;
                    out.push_str(&format!(
                        "<span class=\"mq-l\" style=\"--mq-o:{o}\">{}</span>",
                        escape_text(segment)
                    ));
                }
            }
            Node::Emphasis { children: c } => {
                out.push_str(&format!("<em>{}</em>", split_render(c, ctx, state)));
            }
            Node::Strong { children: c } => {
                out.push_str(&format!("<strong>{}</strong>", split_render(c, ctx, state)));
            }
            Node::Strikethrough { children: c } => {
                out.push_str(&format!("<del>{}</del>", split_render(c, ctx, state)));
            }
            other => out.push_str(&render_node(other, ctx)), // whole, un-split
        }
    }
    out
}
