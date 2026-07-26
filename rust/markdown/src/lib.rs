#![doc = include_str!("../README.md")]

use comrak::nodes::{
    AstNode, ListDelimType, ListType, NodeCode, NodeCodeBlock, NodeFootnoteDefinition,
    NodeFootnoteReference, NodeHeading, NodeLink, NodeList, NodeValue,
};
use comrak::{format_commonmark, parse_document, Arena};
use marquee_parser::{parse, serialize, Attrs, Node};
use std::cell::{Cell, RefCell};
use std::collections::HashMap;

// The one error a conversion can surface (an unknown Marquee dialect version),
// re-exported so consumers can name it without depending on the parser crate.
pub use marquee_parser::ParseError;

/// Which Markdown vocabulary a conversion may use.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Dialect {
    /// CommonMark core only. Extensions have no home, so they degrade: a
    /// strikethrough becomes plain text, and a Marquee sidenote flattens into
    /// the sentence (core Markdown has no footnote).
    Strict,
    /// CommonMark plus the widely-supported extensions Marquee can bridge to:
    /// footnotes (the `sidenote` bridge), strikethrough, autolinks, and
    /// `:shortcode:` emoji.
    #[default]
    Extended,
}

/// What to do with the losses a conversion incurs — the effects with no home
/// in the target format (a `blink` span flattened to text, a heading clamped
/// from level 8 to 6, raw HTML kept as literal text). Orthogonal to [`Dialect`]:
/// you can ask for strict CommonMark *and* a clean stderr log, or extended
/// output with an inline breadcrumb.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum OnLoss {
    /// Discard the loss record. The document still degrades visibly; you just
    /// aren't told what changed.
    #[default]
    Silent,
    /// A clean document; a deduplicated summary goes to stderr.
    Stderr,
    /// A deduplicated summary rides along in the document as a comment, invisible
    /// to readers. The vehicle fits the target: a Marquee `%%` comment; an HTML
    /// comment in Extended Markdown; the pure-CommonMark `[//]: #` idiom in
    /// Strict Markdown.
    Comment,
    /// Both — the comment breadcrumb and the stderr log.
    Both,
}

impl OnLoss {
    fn to_stderr(self) -> bool {
        matches!(self, OnLoss::Stderr | OnLoss::Both)
    }
    fn to_comment(self) -> bool {
        matches!(self, OnLoss::Comment | OnLoss::Both)
    }
}

/// Conversion options. `Default` is [`Dialect::Extended`] with [`OnLoss::Silent`].
#[derive(Debug, Clone, Default)]
pub struct Options {
    /// The Markdown vocabulary allowed in output (mq -> md) and recognized in
    /// input (md -> mq).
    pub dialect: Dialect,
    /// How conversion losses are recorded.
    pub on_loss: OnLoss,
}

// ===================================================================
// mq -> md :  Marquee Node -> comrak AST -> format_commonmark
// ===================================================================

/// Convert Marquee source to Markdown, [`Dialect::Extended`]. Fails only when
/// the source declares a dialect *version* this parser doesn't know — exactly
/// `marquee_parser::parse`'s one refusal.
pub fn to_markdown(source: &str) -> Result<String, ParseError> {
    to_markdown_with(source, &Options::default())
}

/// Convert Marquee source to Markdown under explicit options.
pub fn to_markdown_with(source: &str, options: &Options) -> Result<String, ParseError> {
    let doc = parse(source)?;
    let arena = Arena::new();
    let root = arena.alloc(AstNode::from(NodeValue::Document));
    let build = Build {
        arena: &arena,
        dialect: options.dialect,
        footnotes: RefCell::new(Vec::new()),
        next_note: Cell::new(1),
        losses: RefCell::new(Vec::new()),
    };
    if let Node::Document { children, .. } = &doc {
        build.all(children, root);
    }
    // Footnote definitions collect at the end of the document.
    for def in build.footnotes.borrow().iter() {
        root.append(def);
    }
    let md = render(root, options.dialect);
    let losses = std::mem::take(&mut *build.losses.borrow_mut());
    Ok(record_into_markdown(md, &losses, options))
}

/// Builder state for mq -> md: the arena, the dialect, the footnote accumulator
/// (Marquee sidenotes become numbered footnotes whose definitions gather at the
/// document end), and the loss log.
struct Build<'a> {
    arena: &'a Arena<'a>,
    dialect: Dialect,
    footnotes: RefCell<Vec<&'a AstNode<'a>>>,
    next_note: Cell<usize>,
    losses: RefCell<Vec<String>>,
}

impl<'a> Build<'a> {
    fn node(&self, value: NodeValue) -> &'a AstNode<'a> {
        self.arena.alloc(AstNode::from(value))
    }

    fn lose(&self, message: String) {
        self.losses.borrow_mut().push(message);
    }

    fn all(&self, nodes: &[Node], parent: &'a AstNode<'a>) {
        for n in nodes {
            self.one(n, parent);
        }
    }

    /// Map one Marquee node into comrak nodes appended under `parent`.
    fn one(&self, node: &Node, parent: &'a AstNode<'a>) {
        match node {
            // Never nested; the entry point handles the root's children.
            Node::Document { .. } => {}

            // ---- blocks ----
            Node::Paragraph { children } => {
                let p = self.node(NodeValue::Paragraph);
                parent.append(p);
                self.all(children, p);
            }
            Node::Heading { level, children } => {
                // Markdown headings stop at 6; Marquee allows 8. Clamp (lossy).
                if *level > 6 {
                    self.lose(format!("clamped heading level {level} to 6"));
                }
                let h = self
                    .node(NodeValue::Heading(NodeHeading { level: (*level).min(6), ..Default::default() }));
                parent.append(h);
                self.all(children, h);
            }
            Node::Blockquote { children } => {
                let q = self.node(NodeValue::BlockQuote);
                parent.append(q);
                self.all(children, q);
            }
            Node::ThematicBreak => {
                parent.append(self.node(NodeValue::ThematicBreak));
            }
            Node::CodeBlock { info, text } => {
                let literal = if text.is_empty() { String::new() } else { format!("{text}\n") };
                parent.append(self.node(NodeValue::CodeBlock(Box::new(NodeCodeBlock {
                    fenced: true,
                    fence_char: b'`',
                    fence_length: (longest_backtick_run(text) + 1).max(3),
                    info: info.clone().unwrap_or_default(),
                    literal,
                    closed: true,
                    ..Default::default()
                }))));
            }
            Node::List { ordered, children } => {
                let meta = NodeList {
                    list_type: if *ordered { ListType::Ordered } else { ListType::Bullet },
                    padding: 2,
                    start: 1,
                    delimiter: ListDelimType::Period,
                    bullet_char: if *ordered { 0 } else { b'-' },
                    tight: true,
                    ..Default::default()
                };
                let list = self.node(NodeValue::List(meta));
                parent.append(list);
                for item in children {
                    if let Node::ListItem { children: ic } = item {
                        let it = self.node(NodeValue::Item(meta));
                        list.append(it);
                        self.all(ic, it);
                    }
                }
            }
            // A ListItem outside a List shouldn't occur; splice its content in.
            Node::ListItem { children } => self.all(children, parent),

            // A standalone URL. The lossy Markdown form is a bare autolink on
            // its own line (comrak emits `<url>` when link text equals its url).
            Node::Turbolink { target } => {
                let p = self.node(NodeValue::Paragraph);
                parent.append(p);
                let link = self
                    .node(NodeValue::Link(Box::new(NodeLink { url: target.clone(), title: String::new() })));
                p.append(link);
                link.append(self.node(NodeValue::Text(target.clone().into())));
            }

            // Directives (layout, containers) have no Markdown shape: unwrap,
            // keep the content.
            Node::Directive { name, children, .. } => {
                self.lose(format!("unwrapped '{name}' directive"));
                self.all(children, parent);
            }

            // Spans: a sidenote bridges to a footnote in Extended; every other
            // span (and any span in Strict) unwraps to its text.
            Node::Span { name, children, .. } => {
                if self.dialect == Dialect::Extended && is_sidenote(name) {
                    self.sidenote(children, parent);
                } else {
                    if is_sidenote(name) {
                        self.lose("flattened sidenote: strict has no footnote".into());
                    } else {
                        self.lose(format!("dropped '{name}' span"));
                    }
                    self.all(children, parent);
                }
            }

            // Author notes and malformed-directive markers carry no
            // reader-visible content; drop them.
            Node::Comment { .. } | Node::InvalidDirective { .. } => {}

            // ---- inlines ----
            Node::Text { value } => self.text(value, parent),
            Node::Emphasis { children } => {
                let e = self.node(NodeValue::Emph);
                parent.append(e);
                self.all(children, e);
            }
            Node::Strong { children } => {
                let s = self.node(NodeValue::Strong);
                parent.append(s);
                self.all(children, s);
            }
            Node::Strikethrough { children } => {
                // No `~~` in CommonMark core: Strict keeps the words, plain.
                if self.dialect == Dialect::Extended {
                    let s = self.node(NodeValue::Strikethrough);
                    parent.append(s);
                    self.all(children, s);
                } else {
                    self.lose("dropped strikethrough: not in strict CommonMark".into());
                    self.all(children, parent);
                }
            }
            Node::CodeSpan { text } => {
                parent.append(self.node(NodeValue::Code(NodeCode {
                    num_backticks: (longest_backtick_run(text) + 1).max(1),
                    literal: text.clone(),
                })));
            }
            Node::Link { target, children } => {
                let l = self
                    .node(NodeValue::Link(Box::new(NodeLink { url: target.clone(), title: String::new() })));
                parent.append(l);
                self.all(children, l);
            }
            // Media of any kind collapses to Markdown's single media syntax, the
            // image; the target extension still carries audio/video intent.
            Node::Embed { target, alt } => {
                let img = self
                    .node(NodeValue::Image(Box::new(NodeLink { url: target.clone(), title: String::new() })));
                parent.append(img);
                img.append(self.node(NodeValue::Text(alt.clone().into())));
            }
            // Emit the shortcode literally: GFM-flavored readers render it, it
            // needs no emoji table here, and it round-trips back to an emoji.
            Node::Emoji { slug } => {
                parent.append(self.node(NodeValue::Text(format!(":{slug}:").into())));
            }
            Node::HardBreak => {
                parent.append(self.node(NodeValue::LineBreak));
            }
        }
    }

    /// A Marquee sidenote becomes a numbered footnote: a reference at the site,
    /// and a definition (its inline content wrapped in a paragraph) parked for
    /// the document's end.
    fn sidenote(&self, children: &[Node], parent: &'a AstNode<'a>) {
        let num = self.next_note.get();
        self.next_note.set(num + 1);
        let name = num.to_string();
        parent.append(self.node(NodeValue::FootnoteReference(Box::new(NodeFootnoteReference {
            name: name.clone(),
            ..Default::default()
        }))));
        let def =
            self.node(NodeValue::FootnoteDefinition(NodeFootnoteDefinition { name, ..Default::default() }));
        let p = self.node(NodeValue::Paragraph);
        def.append(p);
        self.all(children, p);
        self.footnotes.borrow_mut().push(def);
    }

    /// A Marquee text node keeps soft breaks as literal `\n`; comrak models
    /// those as `SoftBreak` nodes between `Text` runs.
    fn text(&self, value: &str, parent: &'a AstNode<'a>) {
        for (i, line) in value.split('\n').enumerate() {
            if i > 0 {
                parent.append(self.node(NodeValue::SoftBreak));
            }
            if !line.is_empty() {
                parent.append(self.node(NodeValue::Text(line.to_string().into())));
            }
        }
    }
}

fn render<'a>(root: &'a AstNode<'a>, dialect: Dialect) -> String {
    let mut opt = comrak::Options::default();
    opt.extension.autolink = true;
    if dialect == Dialect::Extended {
        opt.extension.strikethrough = true;
        opt.extension.footnotes = true;
    }
    let mut out = String::new();
    format_commonmark(root, &opt, &mut out).expect("writing to a String cannot fail");
    out
}

// ===================================================================
// md -> mq :  comrak AST -> Marquee Node -> serialize
// ===================================================================

/// Convert Markdown to Marquee source, [`Dialect::Extended`]. Infallible.
///
/// Marquee's whole reason to exist: **raw HTML is never passed through.** An
/// HTML block or inline tag becomes visible literal text — the bytes survive,
/// escaped, and can never execute.
pub fn to_marquee(source: &str) -> String {
    to_marquee_with(source, &Options::default())
}

/// Convert Markdown to Marquee source under explicit options.
pub fn to_marquee_with(source: &str, options: &Options) -> String {
    let arena = Arena::new();
    let mut opt = comrak::Options::default();
    opt.extension.autolink = true;
    opt.extension.shortcodes = true;
    if options.dialect == Dialect::Extended {
        opt.extension.strikethrough = true;
        opt.extension.footnotes = true;
    }
    let root = parse_document(&arena, source, &opt);
    let lower = Lower { footnotes: collect_footnotes(root), losses: RefCell::new(Vec::new()) };
    let mut children: Vec<Node> = root.children().flat_map(|c| lower.one(c)).collect();
    let losses = std::mem::take(&mut *lower.losses.borrow_mut());
    if !losses.is_empty() {
        let summary = summarize(&losses);
        if options.on_loss.to_stderr() {
            for line in &summary {
                eprintln!("marquee-markdown: {line}");
            }
        }
        if options.on_loss.to_comment() {
            let mut text = String::from("marquee-markdown — lost converting from Markdown:");
            for line in &summary {
                text.push_str(&format!("\n- {line}"));
            }
            children.push(Node::Comment { text });
        }
    }
    serialize(&Node::Document { version: 0, children })
}

/// Lowering state for md -> mq: the footnote definitions (so a reference can
/// pull its note inline as a Marquee sidenote) and the loss log.
struct Lower<'a> {
    footnotes: HashMap<String, &'a AstNode<'a>>,
    losses: RefCell<Vec<String>>,
}

impl<'a> Lower<'a> {
    fn lose(&self, message: String) {
        self.losses.borrow_mut().push(message);
    }

    fn all(&self, node: &'a AstNode<'a>) -> Vec<Node> {
        node.children().flat_map(|c| self.one(c)).collect()
    }

    /// Map one comrak node to zero or more Marquee nodes. The catch-all recurses
    /// into children, so anything unmapped still surfaces its text.
    fn one(&self, node: &'a AstNode<'a>) -> Vec<Node> {
        let value = &node.data.borrow().value;
        match value {
            // Never nested; the entry point handles the root.
            NodeValue::Document => vec![],

            // ---- blocks ----
            NodeValue::Paragraph => {
                let children = self.all(node);
                // A paragraph that is exactly one scheme'd autolink is a turbolink.
                if let [Node::Link { target, children: text }] = children.as_slice() {
                    if target.contains("://") && text.as_slice() == [Node::Text { value: target.clone() }] {
                        return vec![Node::Turbolink { target: target.clone() }];
                    }
                }
                vec![Node::Paragraph { children }]
            }
            NodeValue::Heading(h) => vec![Node::Heading { level: h.level, children: self.all(node) }],
            NodeValue::BlockQuote => vec![Node::Blockquote { children: self.all(node) }],
            NodeValue::List(l) => {
                vec![Node::List { ordered: matches!(l.list_type, ListType::Ordered), children: self.all(node) }]
            }
            NodeValue::Item(_) => vec![Node::ListItem { children: self.all(node) }],
            NodeValue::CodeBlock(cb) => vec![Node::CodeBlock {
                info: (!cb.info.is_empty()).then(|| cb.info.clone()),
                text: strip_trailing_newline(&cb.literal),
            }],
            NodeValue::ThematicBreak => vec![Node::ThematicBreak],
            // Raw HTML never passes through: keep it as visible literal text.
            NodeValue::HtmlBlock(h) => {
                self.lose("kept raw HTML block as literal text".into());
                vec![Node::Paragraph { children: vec![Node::Text { value: strip_trailing_newline(&h.literal) }] }]
            }
            // Definitions render at their reference site; don't emit them here.
            NodeValue::FootnoteDefinition(_) => vec![],

            // ---- inlines ----
            NodeValue::Text(t) => vec![Node::Text { value: t.to_string() }],
            NodeValue::Emph => vec![Node::Emphasis { children: self.all(node) }],
            NodeValue::Strong => vec![Node::Strong { children: self.all(node) }],
            NodeValue::Strikethrough => vec![Node::Strikethrough { children: self.all(node) }],
            NodeValue::Code(c) => vec![Node::CodeSpan { text: c.literal.clone() }],
            NodeValue::Link(l) => vec![Node::Link { target: l.url.clone(), children: self.all(node) }],
            NodeValue::Image(l) => vec![Node::Embed { target: l.url.clone(), alt: text_of(node) }],
            NodeValue::SoftBreak => vec![Node::Text { value: "\n".to_string() }],
            NodeValue::LineBreak => vec![Node::HardBreak],
            // Raw inline HTML, same refusal as blocks: literal text, never a tag.
            NodeValue::HtmlInline(s) => {
                self.lose("kept raw inline HTML as literal text".into());
                vec![Node::Text { value: s.clone() }]
            }
            // A `:slug:` shortcode is exactly Marquee's emoji.
            NodeValue::ShortCode(sc) => vec![Node::Emoji { slug: sc.code.clone() }],
            // A footnote reference becomes a Marquee sidenote, its note pulled
            // inline. Only present in Extended — Strict never parses footnotes,
            // so `[^n]` stays literal text.
            NodeValue::FootnoteReference(fr) => match self.footnotes.get(&fr.name) {
                Some(def) => vec![Node::Span {
                    name: "sidenote".to_string(),
                    attrs: Attrs::new(),
                    children: self.inline_of(def),
                }],
                None => vec![],
            },

            // Everything else (extension nodes we don't map yet): keep content.
            _ => self.all(node),
        }
    }

    /// The inline content of a footnote definition — its block children's
    /// inlines, mapped and concatenated (a sidenote holds inlines, not blocks).
    fn inline_of(&self, def: &'a AstNode<'a>) -> Vec<Node> {
        let mut out = Vec::new();
        for (i, block) in def.children().enumerate() {
            if i > 0 {
                out.push(Node::Text { value: " ".to_string() });
            }
            for inline in block.children() {
                out.extend(self.one(inline));
            }
        }
        out
    }
}

/// Index the document's footnote definitions by name.
fn collect_footnotes<'a>(root: &'a AstNode<'a>) -> HashMap<String, &'a AstNode<'a>> {
    let mut map = HashMap::new();
    for child in root.children() {
        if let NodeValue::FootnoteDefinition(fd) = &child.data.borrow().value {
            map.insert(fd.name.clone(), child);
        }
    }
    map
}

fn is_sidenote(name: &str) -> bool {
    matches!(name, "sidenote" | "footnote" | "aside")
}

/// Deduplicate loss messages, prefixing repeats with a count (`3× …`), in
/// first-seen order.
fn summarize(losses: &[String]) -> Vec<String> {
    let mut order: Vec<&str> = Vec::new();
    let mut counts: HashMap<&str, usize> = HashMap::new();
    for l in losses {
        if !counts.contains_key(l.as_str()) {
            order.push(l.as_str());
        }
        *counts.entry(l.as_str()).or_insert(0) += 1;
    }
    order
        .into_iter()
        .map(|k| {
            let n = counts[k];
            if n > 1 {
                format!("{n}× {k}")
            } else {
                k.to_string()
            }
        })
        .collect()
}

/// Apply the loss policy to Markdown output. The comment vehicle fits the
/// dialect: an HTML comment in Extended, the pure-CommonMark never-referenced
/// link definition (`[//]: # (…)`) in Strict.
fn record_into_markdown(mut md: String, losses: &[String], options: &Options) -> String {
    if losses.is_empty() {
        return md;
    }
    let summary = summarize(losses);
    if options.on_loss.to_stderr() {
        for line in &summary {
            eprintln!("marquee-markdown: {line}");
        }
    }
    if options.on_loss.to_comment() {
        if !md.ends_with('\n') {
            md.push('\n');
        }
        match options.dialect {
            Dialect::Extended => {
                // Guard against a stray `--` closing the HTML comment early.
                let body = summary
                    .iter()
                    .map(|s| format!("     {}", s.replace("--", "-")))
                    .collect::<Vec<_>>()
                    .join("\n");
                md.push_str(&format!(
                    "\n<!-- marquee-markdown — lost converting from Marquee:\n{body} -->\n"
                ));
            }
            Dialect::Strict => {
                // Strip parens so they can't close the link title early.
                md.push('\n');
                for s in &summary {
                    let safe = s.replace(['(', ')'], "");
                    md.push_str(&format!("[//]: # (marquee-markdown lost: {safe})\n"));
                }
            }
        }
    }
    md
}

/// Flatten a node's descendant text — an image's alt is a plain Marquee string.
fn text_of<'a>(node: &'a AstNode<'a>) -> String {
    let mut out = String::new();
    for c in node.children() {
        match &c.data.borrow().value {
            NodeValue::Text(t) => out.push_str(t),
            NodeValue::Code(code) => out.push_str(&code.literal),
            NodeValue::SoftBreak | NodeValue::LineBreak => out.push(' '),
            _ => out.push_str(&text_of(c)),
        }
    }
    out
}

fn strip_trailing_newline(s: &str) -> String {
    s.strip_suffix('\n').unwrap_or(s).to_string()
}

fn longest_backtick_run(s: &str) -> usize {
    let mut longest = 0;
    let mut run = 0;
    for c in s.chars() {
        if c == '`' {
            run += 1;
            longest = longest.max(run);
        } else {
            run = 0;
        }
    }
    longest
}

#[cfg(test)]
mod tests {
    use super::{to_markdown, to_markdown_with, to_marquee, to_marquee_with, Dialect, OnLoss, Options};

    fn md(mq: &str) -> String {
        to_markdown(mq).expect("a known dialect")
    }
    fn strict() -> Options {
        Options { dialect: Dialect::Strict, ..Default::default() }
    }

    // ---- mq -> md ----

    #[test]
    fn prose_core_maps_straight_across() {
        assert_eq!(md("# hi\n"), "# hi\n");
        assert_eq!(md("> quote\n"), "> quote\n");
        let em = md("*a* **b** ~~c~~\n");
        assert!(em.contains("*a*") && em.contains("**b**") && em.contains("~~c~~"), "{em}");
        assert!(md("`x()`\n").contains("`x()`"));
        assert!(md("[t](u)\n").contains("[t](u)"));
    }

    #[test]
    fn lists_keep_their_kind() {
        let bullet = md("- a\n- b\n");
        assert!(bullet.contains("- a") && bullet.contains("- b"), "{bullet}");
        assert!(md("1. a\n2. b\n").contains("1. a"));
    }

    #[test]
    fn code_block_keeps_info_and_body() {
        let out = md("```rust\nfn x() {}\n```\n");
        assert!(out.contains("```rust") && out.contains("fn x() {}"), "{out}");
    }

    #[test]
    fn media_of_any_kind_becomes_an_image() {
        assert!(md("![a song](song.mp3)\n").contains("![a song](song.mp3)"));
    }

    #[test]
    fn spans_unwrap_to_their_text_never_dropped() {
        let out = md("[color=goldenrod]hot[/color] [blink]now[/blink]\n");
        assert!(out.contains("hot") && out.contains("now"), "{out}");
        assert!(!out.contains("color=") && !out.contains("[blink]"), "leaked syntax: {out}");
    }

    #[test]
    fn directives_unwrap_comments_drop() {
        let out = md(":::page\nvisible\n:::\n\n%% secret note\n");
        assert!(out.contains("visible"), "{out}");
        assert!(!out.contains(":::") && !out.contains("secret"), "{out}");
    }

    #[test]
    fn emoji_stays_a_shortcode() {
        assert!(md(":sparkles:\n").contains(":sparkles:"));
    }

    #[test]
    fn turbolink_becomes_a_bare_autolink() {
        assert!(md("https://example.org/\n").contains("<https://example.org/>"));
    }

    #[test]
    fn heading_depth_clamps_to_six() {
        assert_eq!(md("######## deep\n"), "###### deep\n");
    }

    // ---- the sidenote <-> footnote bridge (Extended) ----

    #[test]
    fn sidenote_bridges_to_a_footnote() {
        let out = md("a claim[sidenote]the caveat[/sidenote] stands\n");
        assert!(out.contains("a claim[^1]"), "no reference: {out}");
        // comrak writes the definition in the multi-line form: `[^1]:\n    body`.
        assert!(out.contains("[^1]:") && out.contains("the caveat"), "no definition: {out}");
    }

    #[test]
    fn footnote_bridges_back_to_a_sidenote() {
        let out = to_marquee("a claim[^1] stands\n\n[^1]: the caveat\n");
        assert!(out.contains("[sidenote]the caveat[/sidenote]"), "{out}");
    }

    #[test]
    fn sidenote_survives_a_round_trip() {
        let back = to_marquee(&md("claim[sidenote]caveat[/sidenote]\n"));
        assert!(back.contains("[sidenote]caveat[/sidenote]"), "{back}");
    }

    // ---- Strict dialect: extensions degrade ----

    #[test]
    fn strict_flattens_sidenote_into_the_sentence() {
        let out = to_markdown_with("a claim[sidenote]the caveat[/sidenote] stands\n", &strict())
            .expect("known");
        assert!(!out.contains("[^"), "footnote leaked into strict: {out}");
        assert!(out.contains("the caveat"), "caveat lost: {out}");
    }

    #[test]
    fn strict_drops_strikethrough_to_plain_text() {
        let out = to_markdown_with("~~gone~~\n", &strict()).expect("known");
        assert_eq!(out, "gone\n");
    }

    // ---- OnLoss ----

    #[test]
    fn loss_is_silent_by_default() {
        // The document still degrades; you just aren't told.
        let out = md("[color=red]hi[/color]\n");
        assert!(out.contains("hi") && !out.contains("<!--") && !out.contains("[//]:"), "{out}");
    }

    #[test]
    fn loss_comment_rides_along_extended() {
        let opt = Options { on_loss: OnLoss::Comment, ..Default::default() };
        let out = to_markdown_with("######## deep\n\n[color=red]hi[/color]\n", &opt).expect("known");
        assert!(out.contains("<!-- marquee-markdown"), "no HTML comment: {out}");
        assert!(out.contains("dropped 'color' span"), "{out}");
        assert!(out.contains("clamped heading level 8 to 6"), "{out}");
    }

    #[test]
    fn loss_comment_stays_pure_commonmark_in_strict() {
        let opt = Options { dialect: Dialect::Strict, on_loss: OnLoss::Comment };
        let out = to_markdown_with("[color=red]hi[/color]\n", &opt).expect("known");
        assert!(out.contains("[//]: # (marquee-markdown lost:"), "no link-ref comment: {out}");
        assert!(out.contains("dropped 'color' span"), "{out}");
        assert!(!out.contains("<!--"), "strict must not emit raw HTML: {out}");
    }

    #[test]
    fn loss_summary_dedupes_with_counts() {
        let opt = Options { on_loss: OnLoss::Comment, ..Default::default() };
        let out = to_markdown_with(
            "[color=red]a[/color] [color=red]b[/color] [color=red]c[/color]\n",
            &opt,
        )
        .expect("known");
        assert!(out.contains("3× dropped 'color' span"), "{out}");
    }

    #[test]
    fn loss_records_raw_html_on_the_marquee_side() {
        let opt = Options { on_loss: OnLoss::Comment, ..Default::default() };
        let out = to_marquee_with("inline <b>x</b> here\n", &opt);
        assert!(out.contains("%% marquee-markdown"), "no marquee comment: {out}");
        assert!(out.contains("raw inline HTML"), "{out}");
    }

    // ---- md -> mq ----

    #[test]
    fn md_prose_core_maps_straight_across() {
        assert_eq!(to_marquee("# hi\n"), "# hi\n");
        assert_eq!(to_marquee("> quote\n"), "> quote\n");
        let em = to_marquee("*a* **b** ~~c~~\n");
        assert!(em.contains("*a*") && em.contains("**b**") && em.contains("~~c~~"), "{em}");
        assert!(to_marquee("`x()`\n").contains("`x()`"));
        assert!(to_marquee("[t](u)\n").contains("[t](u)"));
        assert!(to_marquee("![alt](p.png)\n").contains("![alt](p.png)"));
        let code = to_marquee("```rust\nfn x() {}\n```\n");
        assert!(code.contains("```rust") && code.contains("fn x() {}"), "{code}");
    }

    #[test]
    fn md_raw_html_never_passes_through() {
        let out = to_marquee("<div onclick=\"x\">danger</div>\n\ninline <b>bold</b> too\n");
        assert!(out.contains("<div") && out.contains("danger") && out.contains("<b>"), "{out}");
        let tree = marquee_parser::parse(&out).expect("known");
        assert!(!has_active_node(&tree), "raw HTML produced an active node: {out}");
    }

    #[test]
    fn md_shortcode_becomes_emoji() {
        let tree = marquee_parser::parse(&to_marquee(":sparkles:\n")).expect("known");
        assert!(contains_emoji(&tree, "sparkles"));
    }

    #[test]
    fn md_standalone_autolink_becomes_a_turbolink() {
        let out = to_marquee("<https://example.org/>\n");
        assert_eq!(out.trim_end(), "https://example.org/");
    }

    #[test]
    fn md_to_mq_to_md_keeps_the_core_subset() {
        let src = "# Title\n\nSome *text* with `code` and a [link](https://e.x).\n\n- one\n- two\n";
        let back = to_markdown(&to_marquee(src)).expect("known");
        for needle in ["# Title", "*text*", "`code`", "[link](https://e.x)", "- one", "- two"] {
            assert!(back.contains(needle), "lost {needle:?} in round trip:\n{back}");
        }
    }

    // -- small AST probes --

    fn has_active_node(n: &marquee_parser::Node) -> bool {
        use marquee_parser::Node::*;
        match n {
            Directive { .. } | Span { .. } | Embed { .. } | Link { .. } => true,
            Document { children, .. }
            | Paragraph { children }
            | Heading { children, .. }
            | Blockquote { children }
            | List { children, .. }
            | ListItem { children }
            | Emphasis { children }
            | Strong { children }
            | Strikethrough { children } => children.iter().any(has_active_node),
            _ => false,
        }
    }

    fn contains_emoji(n: &marquee_parser::Node, slug: &str) -> bool {
        use marquee_parser::Node::*;
        match n {
            Emoji { slug: s } => s == slug,
            Document { children, .. } | Paragraph { children } => {
                children.iter().any(|c| contains_emoji(c, slug))
            }
            _ => false,
        }
    }
}
