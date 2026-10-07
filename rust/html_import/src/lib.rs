#![doc = include_str!("../README.md")]

use ego_tree::NodeRef;
use marquee_parser::{parse, serialize, Attrs, Node};
use scraper::{Html, Node as Dom};
use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use url::Url;

// The spec's caps (SPEC.md, "Caps are spec"). Mirrored rather than imported:
// the parser keeps them crate-private, and they are sealed with v0 anyway.
const MAX_LIST_DEPTH: usize = 16;
const MAX_QUOTE_DEPTH: usize = 16;
const MAX_DIRECTIVE_DEPTH: usize = 8;
const MAX_TARGET_BYTES: usize = 4096;

/// How deep the DOM walk recurses before flattening the rest of a subtree to
/// its text. Hostile HTML nests without limit and the walk is recursive; this
/// bounds both the stack and the cost of looking for blocks inside inlines.
const MAX_DOM_DEPTH: usize = 200;

/// What to do with the losses a conversion incurs — the HTML with no home in
/// Marquee (a `<script>` dropped, a `javascript:` link unwrapped to its text,
/// a layout table flattened).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum OnLoss {
    /// Discard the loss record (it is still returned by [`convert`]).
    #[default]
    Silent,
    /// A deduplicated summary goes to stderr.
    Stderr,
    /// A deduplicated summary rides along in the document as a `%%` comment,
    /// invisible to readers.
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

/// Conversion options.
#[derive(Debug, Clone, Default)]
pub struct Options {
    /// The URL relative references resolve against — for a feed item, usually
    /// the item's own link. Without one (or if it doesn't parse), relative
    /// references are kept relative.
    pub base_url: Option<String>,
    /// How conversion losses are recorded.
    pub on_loss: OnLoss,
}

/// A conversion's full result: the Marquee source and the deduplicated loss
/// summary (`3× dropped <script>`), whatever [`OnLoss`] said to do with it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Conversion {
    pub marquee: String,
    pub losses: Vec<String>,
}

/// Convert HTML to Marquee source with default options. Never fails: any
/// input, however broken, yields a Marquee document.
pub fn to_marquee(html: &str) -> String {
    convert(html, &Options::default()).marquee
}

/// Convert HTML to Marquee source under explicit options.
pub fn to_marquee_with(html: &str, options: &Options) -> String {
    convert(html, options).marquee
}

/// Convert HTML to Marquee, returning the loss summary alongside the source.
pub fn convert(html: &str, options: &Options) -> Conversion {
    // A whole document parses as one (so `<head>` is recognized and dropped);
    // anything else — the common feed case — is a body fragment.
    let head = html.trim_start().get(..15).unwrap_or(html.trim_start()).to_ascii_lowercase();
    let dom = if head.starts_with("<!doctype") || head.starts_with("<html") {
        Html::parse_document(html)
    } else {
        Html::parse_fragment(html)
    };
    let import = Import {
        base: options.base_url.as_deref().and_then(|b| Url::parse(b).ok()),
        losses: RefCell::new(Vec::new()),
        dom_depth: Cell::new(0),
    };
    let blocks = import.blocks(dom.tree.root().children(), Depth::default());
    let mut children: Vec<Node> = blocks.into_iter().map(|b| import.settle(b)).collect();

    let losses = summarize(&import.losses.borrow());
    if options.on_loss.to_stderr() {
        for line in &losses {
            eprintln!("marquee-html-import: {line}");
        }
    }
    if options.on_loss.to_comment() && !losses.is_empty() {
        let mut text = String::from("marquee-html-import — lost converting from HTML:");
        for line in &losses {
            text.push_str(&format!("\n- {line}"));
        }
        children.push(Node::Comment { text });
    }
    // One last pass through the parser: per-block settling keeps fidelity,
    // and this makes the output canonical by construction even where blocks
    // interact (parse∘serialize is the identity on parser-produced trees).
    let source = serialize(&Node::Document { version: 0, children });
    let marquee = match parse(&source) {
        Ok(tree) => serialize(&tree),
        Err(_) => source,
    };
    Conversion { marquee, losses }
}

// ===================================================================
// Element vocabulary
// ===================================================================

/// Dropped with everything inside them. Their content isn't prose — it's code,
/// styling, metadata, or an interactive control with no meaning off its page.
const DROP: &[&str] = &[
    "script", "style", "template", "noscript", "object", "embed", "applet", "frame", "frameset",
    "noframes", "svg", "math", "canvas", "map", "input", "button", "select", "textarea",
    "datalist", "output", "progress", "meter", "dialog", "portal",
];

/// Dropped without comment: document plumbing that never carried visible text.
const DROP_QUIETLY: &[&str] =
    &["head", "title", "meta", "link", "base", "track", "param", "source", "area", "option", "optgroup", "wbr"];

/// Transparent block containers: they break the paragraph flow around them,
/// and their content is converted in place. Table parts are here for when a
/// table turns out to be layout and is unwrapped.
const CONTAINERS: &[&str] = &[
    "html", "body", "p", "div", "section", "article", "main", "header", "footer", "aside", "nav",
    "address", "center", "figure", "figcaption", "details", "summary", "hgroup", "fieldset",
    "form", "legend", "dd", "li", "search", "caption", "thead", "tbody", "tfoot", "tr", "td", "th",
];

/// Elements with a block-level mapping of their own.
const SPECIAL_BLOCKS: &[&str] = &[
    "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "menu", "dir", "blockquote", "pre", "hr",
    "table", "iframe", "dl", "dt",
];

fn is_block(name: &str) -> bool {
    CONTAINERS.contains(&name) || SPECIAL_BLOCKS.contains(&name)
}

/// Inline formatting kinds, tracked so the same kind never nests in itself
/// (`*` inside `*` would spell `**` — strong — in Marquee).
#[derive(Clone, Copy, Default)]
struct Ctx {
    active: u8,
    /// Headings and table cells are one line: a `<br>` becomes a space.
    single_line: bool,
}

const EM: u8 = 1;
const STRONG: u8 = 2;
const STRIKE: u8 = 4;
const LINK: u8 = 8;
const SUP: u8 = 16;
const SUB: u8 = 32;

impl Ctx {
    fn has(self, kind: u8) -> bool {
        self.active & kind != 0
    }
    fn with(self, kind: u8) -> Ctx {
        Ctx { active: self.active | kind, ..self }
    }
}

/// Block nesting so far, against the spec's caps.
#[derive(Clone, Copy, Default)]
struct Depth {
    list: usize,
    quote: usize,
    directive: usize,
}

// ===================================================================
// The walk: DOM -> Marquee tree
// ===================================================================

struct Import {
    base: Option<Url>,
    losses: RefCell<Vec<String>>,
    dom_depth: Cell<usize>,
}

/// One level of DOM recursion, released on drop.
struct Level<'a>(&'a Cell<usize>);

impl Drop for Level<'_> {
    fn drop(&mut self) {
        self.0.set(self.0.get() - 1);
    }
}

type DomRef<'a> = NodeRef<'a, Dom>;

impl Import {
    fn lose(&self, message: impl Into<String>) {
        self.losses.borrow_mut().push(message.into());
    }

    /// Descend one DOM level, or `None` past [`MAX_DOM_DEPTH`].
    fn descend(&self) -> Option<Level<'_>> {
        let d = self.dom_depth.get();
        if d >= MAX_DOM_DEPTH {
            self.lose(format!("flattened markup nested past {MAX_DOM_DEPTH} levels to its text"));
            return None;
        }
        self.dom_depth.set(d + 1);
        Some(Level(&self.dom_depth))
    }

    /// Convert a run of sibling DOM nodes in block context. Loose inline
    /// content gathers into a pending paragraph that block elements flush.
    fn blocks<'a>(&self, nodes: impl Iterator<Item = DomRef<'a>>, depth: Depth) -> Vec<Node> {
        let Some(_level) = self.descend() else {
            let text: String = nodes.map(text_content).collect();
            let mut out = Vec::new();
            paragraph(vec![Node::Text { value: clean_text(&text) }], &mut out);
            return out;
        };
        let mut out = Vec::new();
        let mut pending = Vec::new();
        for node in nodes {
            let el = match node.value() {
                Dom::Text(t) => {
                    pending.push(Node::Text { value: clean_text(t) });
                    continue;
                }
                Dom::Document | Dom::Fragment => {
                    flush(&mut pending, &mut out);
                    out.extend(self.blocks(node.children(), depth));
                    continue;
                }
                Dom::Element(el) => el,
                _ => continue,
            };
            let name = el.name();
            if self.skipped(node, name) {
                continue;
            }
            match name {
                "br" => pending.push(Node::HardBreak),
                "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => {
                    flush(&mut pending, &mut out);
                    let level = name.as_bytes()[1] - b'0';
                    let ctx = Ctx { single_line: true, ..Ctx::default() };
                    let children = trim(normalize(self.inlines(node.children(), ctx)));
                    if !children.is_empty() {
                        out.push(Node::Heading { level, children });
                    }
                }
                "ul" | "ol" | "menu" | "dir" => {
                    flush(&mut pending, &mut out);
                    out.extend(self.list(node, name == "ol", depth));
                }
                "blockquote" => {
                    flush(&mut pending, &mut out);
                    if depth.quote >= MAX_QUOTE_DEPTH {
                        self.lose("unwrapped a blockquote nested past the depth cap");
                        out.extend(self.blocks(node.children(), depth));
                    } else {
                        let inner = Depth { quote: depth.quote + 1, ..depth };
                        let children = self.blocks(node.children(), inner);
                        if !children.is_empty() {
                            out.push(Node::Blockquote { children });
                        }
                    }
                }
                "pre" => {
                    flush(&mut pending, &mut out);
                    out.extend(code_block(node));
                }
                "hr" => {
                    flush(&mut pending, &mut out);
                    out.push(Node::ThematicBreak);
                }
                "table" => {
                    flush(&mut pending, &mut out);
                    out.extend(self.table(node, depth));
                }
                "iframe" => {
                    flush(&mut pending, &mut out);
                    out.extend(self.frame(el.attr("src")));
                }
                "dl" => {
                    flush(&mut pending, &mut out);
                    out.extend(self.blocks(node.children(), depth));
                }
                "dt" => {
                    flush(&mut pending, &mut out);
                    let term = trim(normalize(self.inlines(node.children(), Ctx::default().with(STRONG))));
                    if !term.is_empty() {
                        out.push(Node::Paragraph { children: vec![Node::Strong { children: term }] });
                    }
                }
                _ if CONTAINERS.contains(&name) => {
                    flush(&mut pending, &mut out);
                    out.extend(self.blocks(node.children(), depth));
                    flush(&mut pending, &mut out);
                }
                // An inline element wrapping block content (`<a><div>…</div></a>`,
                // `<font><p>…</p></font>`) can't stay inline in Marquee. Its
                // formatting goes; its content converts as blocks.
                _ if has_block_descendant(node) => {
                    if name == "a" {
                        self.lose("unwrapped a link around block content");
                    }
                    flush(&mut pending, &mut out);
                    out.extend(self.blocks(node.children(), depth));
                }
                _ => pending.extend(self.inline(node, Ctx::default())),
            }
        }
        flush(&mut pending, &mut out);
        out
    }

    /// Whether to skip an element entirely (recording why, where it matters).
    fn skipped(&self, node: DomRef<'_>, name: &str) -> bool {
        if DROP_QUIETLY.contains(&name) {
            return true;
        }
        if DROP.contains(&name) {
            self.lose(format!("dropped <{name}>"));
            return true;
        }
        if let Dom::Element(el) = node.value() {
            if is_hidden(el) {
                self.lose("dropped a hidden element");
                return true;
            }
        }
        false
    }

    fn list(&self, node: DomRef<'_>, ordered: bool, depth: Depth) -> Vec<Node> {
        if depth.list >= MAX_LIST_DEPTH {
            self.lose("flattened a list nested past the depth cap");
            return self.blocks(node.children(), depth);
        }
        let inner = Depth { list: depth.list + 1, ..depth };
        let mut items = Vec::new();
        // Anything loose between the `<li>`s (stray text, a `<p>`) becomes an
        // item of its own rather than vanishing.
        let mut loose = Vec::new();
        let push_loose = |loose: &mut Vec<DomRef<'_>>, items: &mut Vec<Node>| {
            let children = self.blocks(loose.drain(..), inner);
            if !children.is_empty() {
                items.push(Node::ListItem { children });
            }
        };
        for child in node.children() {
            let is_item = matches!(child.value(), Dom::Element(el) if el.name() == "li");
            if is_item {
                push_loose(&mut loose, &mut items);
                if self.skipped(child, "li") {
                    continue;
                }
                let children = self.blocks(child.children(), inner);
                if !children.is_empty() {
                    items.push(Node::ListItem { children });
                }
            } else {
                loose.push(child);
            }
        }
        push_loose(&mut loose, &mut items);
        if items.is_empty() {
            return vec![];
        }
        vec![Node::List { ordered, children: items }]
    }

    /// A data table becomes Marquee's paragraph-row `:::table`; anything that
    /// looks like layout (one column, or cells holding real block structure)
    /// is unwrapped to its content in reading order.
    fn table(&self, node: DomRef<'_>, depth: Depth) -> Vec<Node> {
        let mut rows = Vec::new();
        let mut caption = None;
        for child in node.children() {
            let Dom::Element(el) = child.value() else { continue };
            match el.name() {
                "tr" => rows.push(child),
                "thead" | "tbody" | "tfoot" => rows.extend(
                    child.children().filter(|c| matches!(c.value(), Dom::Element(e) if e.name() == "tr")),
                ),
                "caption" => caption = Some(child),
                _ => {}
            }
        }
        let columns = rows.iter().map(|r| cells_of(*r).len()).max().unwrap_or(0);
        let layout = columns <= 1
            || depth.directive >= MAX_DIRECTIVE_DEPTH
            || rows.iter().flat_map(|r| cells_of(*r)).any(has_structure);
        if layout {
            return self.blocks(node.children(), depth);
        }

        let is_th = |c: &DomRef<'_>| matches!(c.value(), Dom::Element(e) if e.name() == "th");
        let header_row = cells_of(rows[0]).iter().all(is_th);
        let header_col = rows.iter().all(|r| cells_of(*r).first().is_some_and(is_th));
        let mut attrs = Attrs::new();
        match (header_row, header_col) {
            (true, true) => attrs.insert("header".into(), "both".into()),
            (true, false) => attrs.insert("header".into(), "row".into()),
            (false, true) => attrs.insert("header".into(), "column".into()),
            (false, false) => None,
        };

        let ctx = Ctx { single_line: true, ..Ctx::default() };
        let mut spanned = false;
        let paragraphs: Vec<Node> = rows
            .iter()
            .map(|row| {
                let mut children = Vec::new();
                for (i, cell) in cells_of(*row).into_iter().enumerate() {
                    if let Dom::Element(e) = cell.value() {
                        spanned |= e.attr("colspan").is_some() || e.attr("rowspan").is_some();
                    }
                    if i > 0 {
                        children.push(Node::Text { value: " ".into() });
                    }
                    let content = trim(normalize(self.inlines(cell.children(), ctx)));
                    children.push(Node::Span { name: "c".into(), attrs: Attrs::new(), children: content });
                }
                Node::Paragraph { children }
            })
            .collect();
        if spanned {
            self.lose("ignored table colspan/rowspan");
        }

        let mut out = Vec::new();
        if let Some(caption) = caption {
            let children = trim(normalize(self.inlines(caption.children(), ctx)));
            if !children.is_empty() {
                out.push(Node::Paragraph { children });
            }
        }
        out.push(Node::Directive { name: "table".into(), attrs, children: paragraphs });
        out
    }

    /// An `<iframe>` is someone else's page; the closest Marquee has is a
    /// turbolink, which a renderer may enrich into a preview (per its fetch
    /// policy) and always keeps as a plain link.
    fn frame(&self, src: Option<&str>) -> Vec<Node> {
        match src.and_then(|s| self.target(s, Use::Link)) {
            Some(t) if t.contains("://") => vec![Node::Turbolink { target: unembed(&t) }],
            _ => {
                self.lose("dropped an <iframe> with no usable source");
                vec![]
            }
        }
    }

    // ---- inline context ----

    fn inlines<'a>(&self, nodes: impl Iterator<Item = DomRef<'a>>, ctx: Ctx) -> Vec<Node> {
        nodes.flat_map(|n| self.inline(n, ctx)).collect()
    }

    /// Map one DOM node to zero or more Marquee inlines. Anything unrecognized
    /// is transparent: its formatting goes, its text stays.
    fn inline(&self, node: DomRef<'_>, ctx: Ctx) -> Vec<Node> {
        let Some(_level) = self.descend() else {
            return vec![Node::Text { value: clean_text(&text_content(node)) }];
        };
        let el = match node.value() {
            Dom::Text(t) => return vec![Node::Text { value: clean_text(t) }],
            Dom::Element(el) => el,
            _ => return vec![],
        };
        let name = el.name();
        if self.skipped(node, name) {
            return vec![];
        }
        let wrap = |kind: u8, make: fn(Vec<Node>) -> Node| -> Vec<Node> {
            if ctx.has(kind) {
                self.inlines(node.children(), ctx)
            } else {
                vec![make(self.inlines(node.children(), ctx.with(kind)))]
            }
        };
        match name {
            "br" if ctx.single_line => vec![Node::Text { value: " ".into() }],
            "br" => vec![Node::HardBreak],
            "em" | "i" | "cite" | "var" | "dfn" => wrap(EM, |children| Node::Emphasis { children }),
            "strong" | "b" => wrap(STRONG, |children| Node::Strong { children }),
            "s" | "strike" | "del" => wrap(STRIKE, |children| Node::Strikethrough { children }),
            "sup" => wrap(SUP, |children| span("sup", children)),
            "sub" => wrap(SUB, |children| span("sub", children)),
            "code" | "kbd" | "samp" | "tt" => {
                let text = clean_text(&text_content(node)).trim().to_string();
                if text.is_empty() {
                    vec![]
                } else if text.starts_with('`') || text.ends_with('`') {
                    // A code span can't edge on a backtick in Marquee: the
                    // delimiter would absorb it. Keep the words as text.
                    vec![Node::Text { value: text }]
                } else {
                    vec![Node::CodeSpan { text }]
                }
            }
            "q" => {
                let mut out = vec![Node::Text { value: "“".into() }];
                out.extend(self.inlines(node.children(), ctx));
                out.push(Node::Text { value: "”".into() });
                out
            }
            "a" => self.link(node, el, ctx),
            "img" => self.image(el),
            "video" | "audio" => self.media(node, el),
            "iframe" => match el.attr("src").and_then(|s| self.target(s, Use::Link)) {
                Some(t) => {
                    let t = unembed(&t);
                    vec![Node::Link { target: t.clone(), children: vec![Node::Text { value: t }] }]
                }
                None => vec![],
            },
            // Block structure met in a one-line context (a list in a table
            // cell, a paragraph in a heading): keep the words, space-separated.
            _ if is_block(name) => {
                let mut out = vec![Node::Text { value: " ".into() }];
                out.extend(self.inlines(node.children(), ctx));
                out.push(Node::Text { value: " ".into() });
                out
            }
            _ => self.inlines(node.children(), ctx),
        }
    }

    fn link(&self, node: DomRef<'_>, el: &scraper::node::Element, ctx: Ctx) -> Vec<Node> {
        let children = self.inlines(node.children(), ctx.with(LINK));
        if ctx.has(LINK) {
            return children;
        }
        match el.attr("href") {
            // In-page anchors point into a document that no longer exists.
            Some(h) if h.trim_start().starts_with('#') => children,
            Some(h) => match self.target(h, Use::Link) {
                Some(target) => vec![Node::Link { target, children }],
                None => children,
            },
            None => children,
        }
    }

    fn image(&self, el: &scraper::node::Element) -> Vec<Node> {
        let alt = clean_text(el.attr("alt").unwrap_or("")).trim().to_string();
        let tiny = |a: &str| el.attr(a).and_then(|v| v.trim().trim_end_matches("px").parse::<f64>().ok()).is_some_and(|v| v <= 1.0);
        if tiny("width") || tiny("height") {
            self.lose("dropped a tracking pixel");
            return vec![];
        }
        // An emoji drawn as an image (WordPress's `wp-smiley`) is better as its
        // own character, which its alt usually is.
        let emoji_class = el.classes().any(|c| c.contains("emoji") || c == "wp-smiley");
        if emoji_class && !alt.is_empty() {
            return vec![Node::Text { value: alt }];
        }
        // Lazy loaders park the real source in a data attribute and leave a
        // placeholder (often a `data:` pixel) in `src`.
        let candidates = [
            el.attr("src"),
            el.attr("data-src"),
            el.attr("data-lazy-src"),
            el.attr("data-original"),
            el.attr("srcset").and_then(first_srcset),
            el.attr("data-srcset").and_then(first_srcset),
        ];
        let found = candidates.into_iter().flatten().find_map(|c| self.target_quiet(c, Use::Embed));
        match found {
            Some(target) => vec![Node::Embed { target, alt }],
            None => {
                self.lose("dropped an image with no usable source");
                if alt.is_empty() {
                    vec![]
                } else {
                    vec![Node::Text { value: alt }]
                }
            }
        }
    }

    fn media(&self, node: DomRef<'_>, el: &scraper::node::Element) -> Vec<Node> {
        let sources = node.children().filter_map(|c| match c.value() {
            Dom::Element(s) if s.name() == "source" => s.attr("src"),
            _ => None,
        });
        let found = el.attr("src").into_iter().chain(sources).find_map(|s| self.target_quiet(s, Use::Embed));
        let alt = clean_text(el.attr("title").or(el.attr("aria-label")).unwrap_or("")).trim().to_string();
        match found {
            Some(target) => vec![Node::Embed { target, alt }],
            None => {
                self.lose(format!("dropped a <{}> with no usable source", el.name()));
                vec![]
            }
        }
    }

    // ---- targets ----

    fn target(&self, raw: &str, use_: Use) -> Option<String> {
        let result = self.resolve(raw, use_);
        if let Err(Some(why)) = &result {
            self.lose(why.clone());
        }
        result.ok()
    }

    /// As [`Import::target`], but silent — for trying a list of candidates.
    fn target_quiet(&self, raw: &str, use_: Use) -> Option<String> {
        self.resolve(raw, use_).ok()
    }

    /// Resolve a reference against the base, admit only known-safe schemes,
    /// and spell it so the Marquee target lexer reads it back intact (no
    /// whitespace, no parens or brackets, under the length cap). `Err(None)`
    /// is a silent refusal (nothing there).
    fn resolve(&self, raw: &str, use_: Use) -> Result<String, Option<String>> {
        let raw: String = raw.chars().filter(|c| !c.is_control()).collect();
        let raw = raw.trim();
        if raw.is_empty() {
            return Err(None);
        }
        let absolute = match &self.base {
            Some(base) => base.join(raw).ok(),
            None => Url::parse(raw).ok(),
        };
        let spelled = match absolute {
            Some(url) => {
                let scheme = url.scheme();
                if !use_.allows(scheme) {
                    return Err(Some(format!("dropped a {} with a '{scheme}:' target", use_.noun())));
                }
                url.to_string()
            }
            None => {
                // Something that didn't parse as absolute is only admitted as a
                // relative reference if it can't be read as having a scheme at
                // all: no `:` before the first `/`, `?` or `#`.
                let first = raw.split(['/', '?', '#']).next().unwrap_or("");
                if first.contains(':') {
                    return Err(Some(format!("dropped a {} with an unreadable target", use_.noun())));
                }
                raw.to_string()
            }
        };
        let spelled = lexer_safe(&spelled);
        if spelled.len() > MAX_TARGET_BYTES {
            return Err(Some(format!("dropped a {} with an over-long target", use_.noun())));
        }
        Ok(spelled)
    }

    // ---- the round-trip proof ----

    /// Make sure a top-level block reads back from its serialization as the
    /// very tree we built. The serializer's contract covers parser-shaped
    /// trees, and HTML can describe formatting Marquee's grammar can't spell
    /// (`<b>a</b><b>b</b>` side by side, `<em>` hugging `<strong>`). When a
    /// block doesn't survive, its emphasis is flattened to plain text, which
    /// always does — the words win over the formatting.
    fn settle(&self, block: Node) -> Node {
        if survives(&block) {
            return block;
        }
        let flat = flatten_delimiters(block);
        if !survives(&flat) {
            self.lose("approximated structure Marquee can't spell exactly");
        } else {
            self.lose("flattened emphasis Marquee can't spell exactly");
        }
        flat
    }
}

#[derive(Clone, Copy)]
enum Use {
    Link,
    Embed,
}

impl Use {
    fn allows(self, scheme: &str) -> bool {
        match self {
            Use::Link => matches!(scheme, "http" | "https" | "mailto"),
            Use::Embed => matches!(scheme, "http" | "https"),
        }
    }
    fn noun(self) -> &'static str {
        match self {
            Use::Link => "link",
            Use::Embed => "media embed",
        }
    }
}

// ===================================================================
// Helpers
// ===================================================================

/// Collapse HTML whitespace runs to one space and drop control characters.
fn clean_text(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_space = false;
    for c in s.chars() {
        if matches!(c, ' ' | '\t' | '\n' | '\r' | '\x0C') {
            if !in_space {
                out.push(' ');
            }
            in_space = true;
        } else if !c.is_control() {
            out.push(c);
            in_space = false;
        }
    }
    out
}

/// All descendant text, `<br>` as a newline — for `<pre>` and `<code>`.
fn text_content(node: DomRef<'_>) -> String {
    let mut out = String::new();
    for d in node.descendants() {
        match d.value() {
            Dom::Text(t) => out.push_str(t),
            Dom::Element(e) if e.name() == "br" => out.push('\n'),
            _ => {}
        }
    }
    out
}

fn code_block(node: DomRef<'_>) -> Vec<Node> {
    let text = text_content(node).replace("\r\n", "\n").replace('\r', "\n");
    let text: String = text.chars().filter(|c| !c.is_control() || matches!(c, '\n' | '\t')).collect();
    let text = text.trim_end().to_string();
    if text.trim().is_empty() {
        return vec![];
    }
    // `<pre><code class="language-rust">` is the near-universal info string.
    let info = node
        .descendants()
        .filter_map(|d| match d.value() {
            Dom::Element(e) if matches!(e.name(), "code" | "pre") => Some(e),
            _ => None,
        })
        .flat_map(|e| e.classes())
        .find_map(|c| c.strip_prefix("language-").or_else(|| c.strip_prefix("lang-")))
        .map(|lang| lang.chars().filter(|c| c.is_ascii_alphanumeric() || "+#._-".contains(*c)).collect::<String>())
        .filter(|lang| !lang.is_empty());
    vec![Node::CodeBlock { info, text }]
}

fn span(name: &str, children: Vec<Node>) -> Node {
    Node::Span { name: name.into(), attrs: Attrs::new(), children }
}

fn cells_of(row: DomRef<'_>) -> Vec<DomRef<'_>> {
    row.children()
        .filter(|c| matches!(c.value(), Dom::Element(e) if matches!(e.name(), "td" | "th")))
        .collect()
}

fn has_block_descendant(node: DomRef<'_>) -> bool {
    node.descendants().skip(1).any(|d| matches!(d.value(), Dom::Element(e) if is_block(e.name())))
}

/// Block structure a table cell can't hold without being a layout table.
fn has_structure(cell: DomRef<'_>) -> bool {
    const STRUCTURE: &[&str] =
        &["table", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "dl", "blockquote", "pre", "hr", "iframe", "video", "audio"];
    cell.descendants().skip(1).any(|d| matches!(d.value(), Dom::Element(e) if STRUCTURE.contains(&e.name())))
}

fn is_hidden(el: &scraper::node::Element) -> bool {
    if el.attr("hidden").is_some() || el.attr("aria-hidden") == Some("true") {
        return true;
    }
    el.attr("style").is_some_and(|s| {
        let s: String = s.chars().filter(|c| !c.is_whitespace()).collect::<String>().to_ascii_lowercase();
        s.contains("display:none") || s.contains("visibility:hidden")
    })
}

fn first_srcset(srcset: &str) -> Option<&str> {
    srcset.split(',').next()?.split_whitespace().next()
}

/// Spell a URL for Marquee's target lexer, which has no escapes: it ends at
/// whitespace or an unbalanced `)`, and brackets confuse an enclosing link.
/// Percent-encoding these is meaning-preserving.
fn lexer_safe(url: &str) -> String {
    let mut out = String::with_capacity(url.len());
    for c in url.chars() {
        match c {
            '(' => out.push_str("%28"),
            ')' => out.push_str("%29"),
            '[' => out.push_str("%5B"),
            ']' => out.push_str("%5D"),
            '\\' => out.push_str("%5C"),
            c if c.is_whitespace() => {
                let mut buf = [0u8; 4];
                for b in c.encode_utf8(&mut buf).bytes() {
                    out.push_str(&format!("%{b:02X}"));
                }
            }
            c => out.push(c),
        }
    }
    out
}

/// Video players' embed URLs back to their watch pages, which is what a
/// turbolink preview wants.
fn unembed(target: &str) -> String {
    if let Ok(url) = Url::parse(target) {
        let host = url.host_str().unwrap_or("").trim_start_matches("www.");
        let mut path = url.path_segments().map(|s| s.collect::<Vec<_>>()).unwrap_or_default();
        path.retain(|s| !s.is_empty());
        match (host, path.as_slice()) {
            ("youtube.com" | "youtube-nocookie.com", ["embed", id]) => {
                return format!("https://www.youtube.com/watch?v={id}");
            }
            ("player.vimeo.com", ["video", id]) => return format!("https://vimeo.com/{id}"),
            _ => {}
        }
    }
    target.to_string()
}

// ---- inline normalization ----

/// Close the pending paragraph: split it at `<br><br>` (the feed idiom for a
/// paragraph break), tidy each piece, and keep the non-empty ones.
fn flush(pending: &mut Vec<Node>, out: &mut Vec<Node>) {
    let items = std::mem::take(pending);
    let mut group = Vec::new();
    let mut breaks = Vec::new();
    for item in items {
        match item {
            Node::HardBreak => breaks.push(item),
            Node::Text { ref value } if !breaks.is_empty() && value.trim().is_empty() => {}
            other => {
                if breaks.len() >= 2 {
                    paragraph(std::mem::take(&mut group), out);
                }
                group.append(&mut breaks);
                group.push(other);
            }
        }
    }
    paragraph(group, out);
}

fn paragraph(inlines: Vec<Node>, out: &mut Vec<Node>) {
    let children = trim(normalize(inlines));
    if !children.is_empty() {
        out.push(Node::Paragraph { children });
    }
}

/// Shape a run of inlines the way the Marquee parser would have produced it:
/// adjacent text merged, no doubled spaces, formatting never opening or
/// closing on whitespace (Marquee's delimiter rule), no empty formatting,
/// adjacent same-kind formatting merged, no doubled hard breaks.
fn normalize(nodes: Vec<Node>) -> Vec<Node> {
    let mut out: Vec<Node> = Vec::new();
    for node in nodes {
        match unwrap(node) {
            Ok((wrap, children)) => {
                let (lead, kids, trail) = hoist(normalize(children));
                let mut kids = unhug(&wrap, kids);
                lead.into_iter().for_each(|n| push(&mut out, n));
                // `*a*` right against `**b**` spells `*a***b**`: a run of three
                // asterisks, literal in Marquee. The later one gives way.
                let collides = wrap.is_star()
                    && out.last().is_some_and(|n| matches!(n, Node::Emphasis { .. } | Node::Strong { .. }))
                    && !wrap.merges_with_node(out.last().expect("checked"));
                if collides {
                    kids.into_iter().for_each(|n| push(&mut out, n));
                } else if !kids.is_empty() {
                    // `<b>a</b><b>b</b>` would spell `**a****b**`: merge.
                    let last = out.pop();
                    match last.map(unwrap) {
                        Some(Ok((prev, mut prev_kids))) if wrap.merges_with(&prev) => {
                            prev_kids.append(&mut kids);
                            out.push(wrap.build(normalize(prev_kids)));
                        }
                        Some(Ok((prev, prev_kids))) => {
                            out.push(prev.build(prev_kids));
                            out.push(wrap.build(kids));
                        }
                        Some(Err(prev)) => {
                            out.push(prev);
                            out.push(wrap.build(kids));
                        }
                        None => out.push(wrap.build(kids)),
                    }
                }
                trail.into_iter().for_each(|n| push(&mut out, n));
            }
            Err(other) => push(&mut out, other),
        }
    }
    out
}

/// An inline container, taken apart so it can be rebuilt around tidied
/// children.
enum Wrap {
    Emphasis,
    Strong,
    Strikethrough,
    Link(String),
    Span(String, Attrs),
}

impl Wrap {
    fn build(self, children: Vec<Node>) -> Node {
        match self {
            Wrap::Emphasis => Node::Emphasis { children },
            Wrap::Strong => Node::Strong { children },
            Wrap::Strikethrough => Node::Strikethrough { children },
            Wrap::Link(target) => Node::Link { target, children },
            Wrap::Span(name, attrs) => Node::Span { name, attrs, children },
        }
    }

    fn is_star(&self) -> bool {
        matches!(self, Wrap::Emphasis | Wrap::Strong)
    }

    fn merges_with_node(&self, node: &Node) -> bool {
        matches!(
            (self, node),
            (Wrap::Emphasis, Node::Emphasis { .. })
                | (Wrap::Strong, Node::Strong { .. })
                | (Wrap::Strikethrough, Node::Strikethrough { .. })
        )
    }

    /// Only delimiter formatting fuses when adjacent; links and spans have
    /// explicit ends.
    fn merges_with(&self, prev: &Wrap) -> bool {
        matches!(
            (self, prev),
            (Wrap::Emphasis, Wrap::Emphasis) | (Wrap::Strong, Wrap::Strong) | (Wrap::Strikethrough, Wrap::Strikethrough)
        )
    }
}

/// An emphasis whose content opens or closes with a strong (or the reverse)
/// spells `***`, which Marquee reads as literal asterisks. Keep the outer
/// formatting; the inner one at the edge unwraps.
fn unhug(wrap: &Wrap, mut kids: Vec<Node>) -> Vec<Node> {
    let other = |n: &Node| match wrap {
        Wrap::Emphasis => matches!(n, Node::Strong { .. }),
        Wrap::Strong => matches!(n, Node::Emphasis { .. }),
        _ => false,
    };
    let mut changed = false;
    if kids.first().is_some_and(other) {
        let Ok((_, inner)) = unwrap(kids.remove(0)) else { unreachable!() };
        kids.splice(0..0, inner);
        changed = true;
    }
    if kids.last().is_some_and(other) {
        let Ok((_, inner)) = unwrap(kids.pop().expect("non-empty")) else { unreachable!() };
        kids.extend(inner);
        changed = true;
    }
    if changed {
        let (_, kids, _) = hoist(normalize(kids));
        kids
    } else {
        kids
    }
}

fn unwrap(node: Node) -> Result<(Wrap, Vec<Node>), Node> {
    match node {
        Node::Emphasis { children } => Ok((Wrap::Emphasis, children)),
        Node::Strong { children } => Ok((Wrap::Strong, children)),
        Node::Strikethrough { children } => Ok((Wrap::Strikethrough, children)),
        Node::Link { target, children } => Ok((Wrap::Link(target), children)),
        Node::Span { name, attrs, children } => Ok((Wrap::Span(name, attrs), children)),
        other => Err(other),
    }
}

fn push(out: &mut Vec<Node>, node: Node) {
    match node {
        Node::Text { value } => push_text(out, &value),
        Node::HardBreak => {
            // No space hugs a hard break, and two in a row are one.
            if let Some(Node::Text { value }) = out.last_mut() {
                value.truncate(value.trim_end_matches(' ').len());
                if value.is_empty() {
                    out.pop();
                }
            }
            if !matches!(out.last(), Some(Node::HardBreak)) {
                out.push(Node::HardBreak);
            }
        }
        other => out.push(other),
    }
}

fn push_text(out: &mut Vec<Node>, value: &str) {
    let value = if matches!(out.last(), Some(Node::HardBreak)) { value.trim_start_matches(' ') } else { value };
    if value.is_empty() {
        return;
    }
    if let Some(Node::Text { value: prev }) = out.last_mut() {
        if prev.ends_with(' ') && value.starts_with(' ') {
            prev.push_str(&value[1..]);
        } else {
            prev.push_str(value);
        }
    } else {
        out.push(Node::Text { value: value.to_string() });
    }
}

/// Move whitespace and hard breaks off a container's edges, so `<em> hi </em>`
/// becomes ` *hi* ` — Marquee delimiters can't open or close on a space.
fn hoist(mut kids: Vec<Node>) -> (Vec<Node>, Vec<Node>, Vec<Node>) {
    let mut lead = Vec::new();
    loop {
        match kids.first_mut() {
            Some(Node::HardBreak) => lead.push(kids.remove(0)),
            Some(Node::Text { value }) if value.starts_with(' ') => {
                *value = value.trim_start_matches(' ').to_string();
                if value.is_empty() {
                    kids.remove(0);
                }
                lead.push(Node::Text { value: " ".into() });
            }
            _ => break,
        }
    }
    let mut trail = Vec::new();
    loop {
        match kids.last_mut() {
            Some(Node::HardBreak) => trail.push(kids.pop().expect("non-empty")),
            Some(Node::Text { value }) if value.ends_with(' ') => {
                value.truncate(value.trim_end_matches(' ').len());
                if value.is_empty() {
                    kids.pop();
                }
                trail.push(Node::Text { value: " ".into() });
            }
            _ => break,
        }
    }
    trail.reverse();
    (lead, kids, trail)
}

/// Strip whitespace and hard breaks from the ends of a line of inlines.
fn trim(mut nodes: Vec<Node>) -> Vec<Node> {
    loop {
        match nodes.first_mut() {
            Some(Node::HardBreak) => {
                nodes.remove(0);
            }
            Some(Node::Text { value }) if value.starts_with(' ') || value.is_empty() => {
                *value = value.trim_start_matches(' ').to_string();
                if value.is_empty() {
                    nodes.remove(0);
                }
            }
            _ => break,
        }
    }
    loop {
        match nodes.last_mut() {
            Some(Node::HardBreak) => {
                nodes.pop();
            }
            Some(Node::Text { value }) if value.ends_with(' ') || value.is_empty() => {
                value.truncate(value.trim_end_matches(' ').len());
                if value.is_empty() {
                    nodes.pop();
                }
            }
            _ => break,
        }
    }
    nodes
}

// ---- the round-trip proof ----

fn survives(block: &Node) -> bool {
    let doc = Node::Document { version: 0, children: vec![block.clone()] };
    matches!(parse(&serialize(&doc)), Ok(Node::Document { children, .. }) if children.len() == 1 && children[0] == *block)
}

/// Remove every emphasis, strong and strikethrough in a block, keeping their
/// content.
fn flatten_delimiters(node: Node) -> Node {
    fn list(nodes: Vec<Node>) -> Vec<Node> {
        let mut out = Vec::new();
        for n in nodes {
            match n {
                Node::Emphasis { children } | Node::Strong { children } | Node::Strikethrough { children } => {
                    out.extend(list(children))
                }
                other => out.push(flatten_delimiters(other)),
            }
        }
        normalize(out)
    }
    match node {
        Node::Paragraph { children } => Node::Paragraph { children: trim(list(children)) },
        Node::Heading { level, children } => Node::Heading { level, children: trim(list(children)) },
        Node::Blockquote { children } => Node::Blockquote { children: list(children) },
        Node::List { ordered, children } => Node::List { ordered, children: list(children) },
        Node::ListItem { children } => Node::ListItem { children: list(children) },
        Node::Directive { name, attrs, children } => Node::Directive { name, attrs, children: list(children) },
        Node::Span { name, attrs, children } => Node::Span { name, attrs, children: list(children) },
        Node::Link { target, children } => Node::Link { target, children: list(children) },
        other => other,
    }
}

/// Deduplicate loss messages, prefixing repeats with a count (`3× …`), in
/// first-seen order.
fn summarize(losses: &[String]) -> Vec<String> {
    let mut order: Vec<&str> = Vec::new();
    let mut counts: HashMap<&str, usize> = HashMap::new();
    for l in losses {
        let count = counts.entry(l.as_str()).or_insert(0);
        if *count == 0 {
            order.push(l.as_str());
        }
        *count += 1;
    }
    order
        .into_iter()
        .map(|k| match counts[k] {
            1 => k.to_string(),
            n => format!("{n}× {k}"),
        })
        .collect()
}
