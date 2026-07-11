//! The behavioral suite: the spec's renderer obligations, ported from
//! ts/html_renderer's behavior tests and run over the whole vector corpus.
//! These are renderer-agnostic - passing them does NOT require matching the
//! TypeScript renderer's bytes.
//!
//!   1. Never eat content: every text/code value in the AST appears.
//!   2. The anti-shrug: comment content NEVER appears.
//!   3. Fail closed, visibly: one placeholder per invalid_directive.
//!   4. Escaping: author bytes cannot become markup.

use marquee_html_renderer::{escape_text, render, render_marquee, BareWebProfile};
use marquee_parser::{parse, Node};
use std::fs;
use std::path::PathBuf;

#[derive(Default)]
struct Collected {
    visible: Vec<String>,
    comments: Vec<String>,
    invalids: usize,
}

fn collect(node: &Node, out: &mut Collected) {
    match node {
        Node::Text { value } => out.visible.push(value.clone()),
        Node::CodeBlock { text, .. } | Node::CodeSpan { text } => out.visible.push(text.clone()),
        Node::Comment { text } => out.comments.push(text.clone()),
        Node::InvalidDirective { .. } => out.invalids += 1,
        _ => {}
    }
    for child in node_children(node) {
        collect(child, out);
    }
}

fn node_children(node: &Node) -> &[Node] {
    match node {
        Node::Document { children, .. }
        | Node::Paragraph { children }
        | Node::Heading { children, .. }
        | Node::Blockquote { children }
        | Node::List { children, .. }
        | Node::ListItem { children }
        | Node::Directive { children, .. }
        | Node::InvalidDirective { children, .. }
        | Node::Emphasis { children }
        | Node::Strong { children }
        | Node::Strikethrough { children }
        | Node::Link { children, .. }
        | Node::Span { children, .. } => children,
        _ => &[],
    }
}

#[test]
fn obligations_over_the_vector_corpus() {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../vectors");
    let mut files: Vec<PathBuf> = fs::read_dir(&dir)
        .expect("vectors/")
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "json"))
        .collect();
    files.sort();
    assert!(!files.is_empty());

    let mut failures: Vec<String> = Vec::new();
    for path in files {
        let cases: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        for case in cases.as_array().unwrap() {
            let name = case["name"].as_str().unwrap();
            let source = case["marquee"].as_str().unwrap();
            let doc = parse(source).unwrap();
            let html = render(&doc, &BareWebProfile);
            let mut got = Collected::default();
            collect(&doc, &mut got);
            for value in &got.visible {
                if !value.is_empty() && !html.contains(&escape_text(value)) {
                    failures.push(format!("{name}: authored content eaten: {value:?}"));
                }
            }
            for value in &got.comments {
                if !value.is_empty() && html.contains(&escape_text(value)) {
                    failures.push(format!("{name}: comment leaked: {value:?}"));
                }
            }
            let placeholders = html.matches("class=\"mq-invalid\"").count();
            if placeholders != got.invalids {
                failures.push(format!(
                    "{name}: {placeholders} placeholders for {} invalid constructs",
                    got.invalids
                ));
            }
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn escaping_author_bytes_cannot_become_markup() {
    let source = concat!(
        "# <script>alert(1)</script>\n\n",
        "<img onerror=x> & \"quotes\" &amp; entities\n\n",
        "[click](javascript:alert(1))\n\n",
        "![<b>bold alt</b>](https://e.x/pic.png)\n\n",
        "```html\n<script>boom</script>\n```\n\n",
        ":::x k=\"<script>injected</script>\":::\n\n",
        "%% secret <script>comment</script>\n",
    );
    let html = render_marquee(source, &BareWebProfile).unwrap();
    assert!(!html.contains("<script"), "script tag survived escaping");
    assert!(!html.contains("href=\"javascript:"), "javascript: URL became a link");
    assert!(!html.contains("secret"), "comment content leaked");
    assert!(html.contains("&lt;script&gt;alert(1)&lt;/script&gt;"));
}

#[test]
fn blocked_links_keep_their_children() {
    let html = render_marquee("[the words](weird://scheme)\n", &BareWebProfile).unwrap();
    assert!(html.contains("the words"));
    assert!(!html.contains("weird://scheme"));
}

#[test]
fn asides_flush_below_the_triggering_block() {
    let html = render_marquee(
        "First[sidenote]note one[/sidenote] paragraph.\n\nSecond[sidenote]note two[/sidenote] here.\n",
        &BareWebProfile,
    )
    .unwrap();
    assert!(html.contains("<sup class=\"mq-noteref\">1</sup> paragraph.</p><aside class=\"mq-notes\">"));
    assert!(html.contains("<span class=\"mq-note-num\">2</span>note two"));
}

#[test]
fn effects_split_deterministically() {
    let a = render_marquee("[wave by=letter]hi there[/wave]\n", &BareWebProfile).unwrap();
    let b = render_marquee("[wave by=letter]hi there[/wave]\n", &BareWebProfile).unwrap();
    assert_eq!(a, b);
    assert_eq!(a.matches("class=\"mq-l\"").count(), 7, "7 letters wrapped, space not");
    assert!(a.contains("mq-wave mq-split"));
    let scatter = render_marquee("[rainbow by=letter phase=scatter]abcd[/rainbow]\n", &BareWebProfile).unwrap();
    let ramp = render_marquee("[rainbow by=letter]abcd[/rainbow]\n", &BareWebProfile).unwrap();
    assert_ne!(scatter, ramp);
}

#[test]
fn vocabulary_spot_checks() {
    let html = render_marquee(
        ":::media width=200 height=300\n![x](https://e.x/p.png)\n:::\n",
        &BareWebProfile,
    )
    .unwrap();
    assert!(html.contains("--mq-media-w:200px;--mq-media-h:300px"));
    let sized = render_marquee("[size=6]loud[/size] [enormous]!![/enormous]\n", &BareWebProfile).unwrap();
    assert!(sized.contains("<font class=\"mq-size-6\" size=\"6\">loud</font>"));
    assert!(sized.contains("<font class=\"mq-size-7\" size=\"7\">!!</font>"));
    let fonty = render_marquee("[font=orbitron]go[/font] [font=papyrus]nope[/font]\n", &BareWebProfile).unwrap();
    assert!(fonty.contains("<font class=\"mq-font-orbitron\" face=\"Orbitron\">go</font>"));
    assert!(!fonty.contains("papyrus"));
    let colored = render_marquee("[color=#f06]hp[/color]\n", &BareWebProfile).unwrap();
    assert!(colored.contains("<font class=\"mq-color\" color=\"#f06\" style=\"--mq-color:#f06\">hp</font>"));
}

#[test]
fn turbolink_socket_floor_and_rich_wrapper() {
    struct Rich;
    impl marquee_html_renderer::Profile for Rich {
        fn turbolink(
            &self,
            _target: &str,
            level: marquee_html_renderer::TurbolinkLevel,
        ) -> Option<String> {
            (level == marquee_html_renderer::TurbolinkLevel::Full).then(|| "<b>RICH</b>".to_string())
        }
    }
    let full = render_marquee("https://e.x/post\n", &Rich).unwrap();
    assert!(full.contains("<div class=\"mq-turbolink mq-turbolink-rich\"><b>RICH</b>"));
    assert!(full.contains("<a class=\"mq-turbolink-source\" href=\"https://e.x/post\">"));
    let floor = render_marquee("https://e.x/post\n", &BareWebProfile).unwrap();
    assert!(floor.contains("<p class=\"mq-turbolink\"><a href=\"https://e.x/post\">"));
}

#[test]
fn emoji_socket_text_image_and_literal() {
    use marquee_html_renderer::EmojiResolution;
    struct Table;
    impl marquee_html_renderer::Profile for Table {
        fn emoji(&self, slug: &str) -> Option<EmojiResolution> {
            match slug {
                "cat" => Some(EmojiResolution::Text("🐱".to_string())),
                "blobcat" => Some(EmojiResolution::Image {
                    url: "https://e.x/blob.png".to_string(),
                    alt: None,
                }),
                "sly" => Some(EmojiResolution::Image {
                    url: "\"><script>alert(1)</script>".to_string(),
                    alt: Some("<b>".to_string()),
                }),
                _ => None,
            }
        }
    }
    let html = render_marquee(":cat: :blobcat: :dog:\n", &Table).unwrap();
    assert!(html.contains("🐱"));
    assert!(html.contains(
        "<img class=\"mq-emoji\" src=\"https://e.x/blob.png\" alt=\":blobcat:\" loading=\"lazy\">"
    ));
    assert!(html.contains(":dog:"), "unresolved slug stays literal");
    let escaped = render_marquee(":sly:\n", &Table).unwrap();
    assert!(!escaped.contains("<script"), "src and alt are attribute-escaped");
    assert!(escaped.contains("&lt;b&gt;"));
}
