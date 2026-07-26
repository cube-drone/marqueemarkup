//! Lossy two-way conversion between Marquee and Markdown.
//!
//! Both directions pivot on the Marquee AST (`marquee_parser::Node`) and
//! comrak's CommonMark AST:
//!
//! ```text
//! md -> mq:  comrak AST --map--> Marquee Node --serialize--> .mq
//! mq -> md:  Marquee Node --map--> comrak AST --format_commonmark--> .md
//! ```
//!
//! Neither direction is lossless — that is the deal. Marquee has effects
//! Markdown can't say (colors, animation, fonts, sizing), and Markdown has raw
//! HTML and rich tables Marquee deliberately refuses. The guiding rule, borrowed
//! from Marquee itself: **degrade visibly, never eat content.** An effect with
//! no Markdown equivalent is unwrapped to the text it decorated; it is never
//! dropped.
//!
//! The [`Dialect`] chooses how much Markdown vocabulary a conversion may use.
//! In [`Dialect::Extended`] (the default) a Marquee **sidenote bridges to a
//! footnote** and back; in [`Dialect::Strict`] — CommonMark core only — the
//! sidenote flattens into the sentence, because core Markdown has no footnote.

use comrak::nodes::{
    AstNode, ListDelimType, ListType, NodeCode, NodeCodeBlock, NodeFootnoteDefinition,
    NodeFootnoteReference, NodeHeading, NodeLink, NodeList, NodeValue,
};
use comrak::{format_commonmark, parse_document, Arena};
use marquee_parser::{parse, serialize, Attrs, Node, ParseError};
use std::cell::{Cell, RefCell};
use std::collections::HashMap;

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

/// Conversion options. `Default` is [`Dialect::Extended`].
#[derive(Debug, Clone, Default)]
pub struct Options {
    /// The Markdown vocabulary allowed in output (mq -> md) and recognized in
    /// input (md -> mq).
    pub dialect: Dialect,
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
    };
    if let Node::Document { children, .. } = &doc {
        build.all(children, root);
    }
    // Footnote definitions collect at the end of the document.
    for def in build.footnotes.borrow().iter() {
        root.append(def);
    }
    Ok(render(root, options.dialect))
}

/// Builder state for mq -> md: the arena, the dialect, and the footnote
/// accumulator (Marquee sidenotes become numbered footnotes whose definitions
/// gather at the document end).
struct Build<'a> {
    arena: &'a Arena<'a>,
    dialect: Dialect,
    footnotes: RefCell<Vec<&'a AstNode<'a>>>,
    next_note: Cell<usize>,
}

impl<'a> Build<'a> {
    fn node(&self, value: NodeValue) -> &'a AstNode<'a> {
        self.arena.alloc(AstNode::from(value))
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
            Node::Directive { children, .. } => self.all(children, parent),

            // Spans: a sidenote bridges to a footnote in Extended; every other
            // span (and any span in Strict) unwraps to its text.
            Node::Span { name, children, .. } => {
                if self.dialect == Dialect::Extended && is_sidenote(name) {
                    self.sidenote(children, parent);
                } else {
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
    let lower = Lower { footnotes: collect_footnotes(root) };
    let children = root.children().flat_map(|c| lower.one(c)).collect();
    serialize(&Node::Document { version: 0, children })
}

/// Lowering state for md -> mq: the footnote definitions, so a reference can
/// pull its note inline as a Marquee sidenote.
struct Lower<'a> {
    footnotes: HashMap<String, &'a AstNode<'a>>,
}

impl<'a> Lower<'a> {
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
            NodeValue::HtmlInline(s) => vec![Node::Text { value: s.clone() }],
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
    use super::{to_markdown, to_markdown_with, to_marquee, Dialect, Options};

    fn md(mq: &str) -> String {
        to_markdown(mq).expect("a known dialect")
    }
    fn strict() -> Options {
        Options { dialect: Dialect::Strict }
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
