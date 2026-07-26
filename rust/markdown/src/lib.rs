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

use comrak::nodes::{
    AstNode, ListDelimType, ListType, NodeCode, NodeCodeBlock, NodeHeading, NodeLink, NodeList,
    NodeValue,
};
use comrak::{format_commonmark, Arena, Options};
use marquee_parser::{parse, Node, ParseError};

/// Convert Marquee source to Markdown (CommonMark + a few widely-supported
/// extensions). Fails only when the Marquee source declares a dialect version
/// this parser doesn't know — exactly `marquee_parser::parse`'s one refusal.
pub fn to_markdown(source: &str) -> Result<String, ParseError> {
    let doc = parse(source)?;
    let arena = Arena::new();
    let root = arena.alloc(AstNode::from(NodeValue::Document));
    if let Node::Document { children, .. } = &doc {
        build_all(&arena, children, root);
    }
    Ok(render(root))
}

fn render<'a>(root: &'a AstNode<'a>) -> String {
    let mut opt = Options::default();
    opt.extension.strikethrough = true;
    opt.extension.autolink = true;
    let mut out = String::new();
    format_commonmark(root, &opt, &mut out).expect("writing to a String cannot fail");
    out
}

fn alloc<'a>(arena: &'a Arena<'a>, value: NodeValue) -> &'a AstNode<'a> {
    arena.alloc(AstNode::from(value))
}

fn build_all<'a>(arena: &'a Arena<'a>, nodes: &[Node], parent: &'a AstNode<'a>) {
    for n in nodes {
        build(arena, n, parent);
    }
}

/// Map one Marquee node into comrak nodes appended under `parent`. Container
/// mappings recurse; the unmappable wrappers (directives, spans) unwrap to
/// their children so no authored text is lost.
fn build<'a>(arena: &'a Arena<'a>, node: &Node, parent: &'a AstNode<'a>) {
    match node {
        // Never nested; the entry point handles the root's children.
        Node::Document { .. } => {}

        // ---- blocks that map 1:1 ----
        Node::Paragraph { children } => {
            let p = alloc(arena, NodeValue::Paragraph);
            parent.append(p);
            build_all(arena, children, p);
        }
        Node::Heading { level, children } => {
            // Markdown headings stop at 6; Marquee allows 8. Clamp (lossy).
            let h = alloc(
                arena,
                NodeValue::Heading(NodeHeading { level: (*level).min(6), ..Default::default() }),
            );
            parent.append(h);
            build_all(arena, children, h);
        }
        Node::Blockquote { children } => {
            let q = alloc(arena, NodeValue::BlockQuote);
            parent.append(q);
            build_all(arena, children, q);
        }
        Node::ThematicBreak => {
            parent.append(alloc(arena, NodeValue::ThematicBreak));
        }
        Node::CodeBlock { info, text } => {
            let literal = if text.is_empty() { String::new() } else { format!("{text}\n") };
            parent.append(alloc(
                arena,
                NodeValue::CodeBlock(Box::new(NodeCodeBlock {
                    fenced: true,
                    fence_char: b'`',
                    fence_length: (longest_backtick_run(text) + 1).max(3),
                    info: info.clone().unwrap_or_default(),
                    literal,
                    closed: true,
                    ..Default::default()
                })),
            ));
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
            let list = alloc(arena, NodeValue::List(meta));
            parent.append(list);
            for item in children {
                if let Node::ListItem { children: ic } = item {
                    let it = alloc(arena, NodeValue::Item(meta));
                    list.append(it);
                    build_all(arena, ic, it);
                }
            }
        }
        // A ListItem outside a List shouldn't occur; splice its content in.
        Node::ListItem { children } => build_all(arena, children, parent),

        // A standalone URL. The lossy Markdown form is a bare autolink on its
        // own line (comrak emits `<url>` when the link's text equals its url).
        Node::Turbolink { target } => {
            let p = alloc(arena, NodeValue::Paragraph);
            parent.append(p);
            let link =
                alloc(arena, NodeValue::Link(Box::new(NodeLink { url: target.clone(), title: String::new() })));
            p.append(link);
            link.append(alloc(arena, NodeValue::Text(target.clone().into())));
        }

        // ---- the unmappable wrappers: unwrap, keep the content ----
        // Directives (layout, colors-as-container) and spans (colors, fonts,
        // sizing, animation, sidenotes) have no CommonMark equivalent. Drop the
        // wrapper, keep its children. (Semantic bridges — sidenote->footnote,
        // etc. — arrive with the dialect/loss options.)
        Node::Directive { children, .. } | Node::Span { children, .. } => {
            build_all(arena, children, parent);
        }

        // Author notes and malformed-directive markers carry no reader-visible
        // content; drop them.
        Node::Comment { .. } | Node::InvalidDirective { .. } => {}

        // ---- inlines ----
        Node::Text { value } => build_text(arena, value, parent),
        Node::Emphasis { children } => {
            let e = alloc(arena, NodeValue::Emph);
            parent.append(e);
            build_all(arena, children, e);
        }
        Node::Strong { children } => {
            let s = alloc(arena, NodeValue::Strong);
            parent.append(s);
            build_all(arena, children, s);
        }
        Node::Strikethrough { children } => {
            let s = alloc(arena, NodeValue::Strikethrough);
            parent.append(s);
            build_all(arena, children, s);
        }
        Node::CodeSpan { text } => {
            parent.append(alloc(
                arena,
                NodeValue::Code(NodeCode {
                    num_backticks: (longest_backtick_run(text) + 1).max(1),
                    literal: text.clone(),
                }),
            ));
        }
        Node::Link { target, children } => {
            let l =
                alloc(arena, NodeValue::Link(Box::new(NodeLink { url: target.clone(), title: String::new() })));
            parent.append(l);
            build_all(arena, children, l);
        }
        // Media of any kind collapses to Markdown's single media syntax, the
        // image; the target extension still carries audio/video intent.
        Node::Embed { target, alt } => {
            let img =
                alloc(arena, NodeValue::Image(Box::new(NodeLink { url: target.clone(), title: String::new() })));
            parent.append(img);
            img.append(alloc(arena, NodeValue::Text(alt.clone().into())));
        }
        // Emit the shortcode literally: GFM-flavored readers render it, it needs
        // no emoji table here, and it round-trips back to an emoji.
        Node::Emoji { slug } => {
            parent.append(alloc(arena, NodeValue::Text(format!(":{slug}:").into())));
        }
        Node::HardBreak => {
            parent.append(alloc(arena, NodeValue::LineBreak));
        }
    }
}

/// A Marquee text node keeps soft breaks as literal `\n`; comrak models those
/// as `SoftBreak` nodes between `Text` runs.
fn build_text<'a>(arena: &'a Arena<'a>, value: &str, parent: &'a AstNode<'a>) {
    for (i, line) in value.split('\n').enumerate() {
        if i > 0 {
            parent.append(alloc(arena, NodeValue::SoftBreak));
        }
        if !line.is_empty() {
            parent.append(alloc(arena, NodeValue::Text(line.to_string().into())));
        }
    }
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
    use super::to_markdown;

    fn md(mq: &str) -> String {
        to_markdown(mq).expect("a known dialect")
    }

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
        let ordered = md("1. a\n2. b\n");
        assert!(ordered.contains("1. a"), "{ordered}");
    }

    #[test]
    fn code_block_keeps_info_and_body() {
        let out = md("```rust\nfn x() {}\n```\n");
        assert!(out.contains("```rust"), "{out}");
        assert!(out.contains("fn x() {}"), "{out}");
    }

    #[test]
    fn media_of_any_kind_becomes_an_image() {
        // Audio/video/image all share Markdown's one media syntax.
        assert!(md("![a song](song.mp3)\n").contains("![a song](song.mp3)"));
    }

    #[test]
    fn spans_unwrap_to_their_text_never_dropped() {
        // Color, animation, sizing, fonts, sidenotes: the effect is gone, the
        // words survive — and the bracket syntax must not leak through.
        let out = md("[color=goldenrod]hot[/color] [blink]now[/blink]\n");
        assert!(out.contains("hot") && out.contains("now"), "{out}");
        assert!(!out.contains("color=") && !out.contains("[blink]"), "leaked syntax: {out}");
    }

    #[test]
    fn directives_unwrap_comments_drop() {
        let out = md(":::page\nvisible\n:::\n\n%% secret note\n");
        assert!(out.contains("visible"), "{out}");
        assert!(!out.contains(":::"), "directive leaked: {out}");
        assert!(!out.contains("secret"), "comment leaked: {out}");
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
        // Marquee allows eight levels; Markdown stops at six.
        assert_eq!(md("######## deep\n"), "###### deep\n");
    }
}
