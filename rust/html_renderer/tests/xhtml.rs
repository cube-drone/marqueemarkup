//! Output::Xhtml: every page an XML parser will accept, as an ePub reader
//! needs - checked by parsing, not by eye - and the same words and classes
//! as the HTML spelling. Plus Profile::link_target, which an ePub needs to
//! point a link at a chapter.

use marquee_html_renderer::{
    render_marquee, render_marquee_with, render_with, BareWebProfile, EmojiResolution, MediaKind,
    MediaResolution, Output, Profile,
};
use marquee_parser::parse;
use std::fs;
use std::path::PathBuf;

/// Parse as a page body the way a strict reader would: XHTML namespace,
/// no DTD, so only XML's own five entities exist.
fn well_formed(xhtml: &str) -> Result<(), String> {
    let page = format!("<html xmlns=\"http://www.w3.org/1999/xhtml\"><body>{xhtml}</body></html>");
    roxmltree::Document::parse(&page).map(|_| ()).map_err(|e| e.to_string())
}

/// Every embed kind, emoji as images, and a turbolink enrichment - the
/// branches the bare-web profile never reaches.
struct Everything;

impl Profile for Everything {
    fn media(&self, target: &str) -> Option<MediaResolution> {
        let kind = if target.ends_with(".mp3") {
            MediaKind::Audio
        } else if target.ends_with(".mp4") || target.ends_with(".gif") {
            MediaKind::Video
        } else {
            MediaKind::Image
        };
        Some(MediaResolution { kind, url: target.to_string(), looping: target.ends_with(".gif") })
    }
    fn emoji(&self, slug: &str) -> Option<EmojiResolution> {
        Some(EmojiResolution::Image { url: format!("emoji/{slug}.png"), alt: None })
    }
}

#[test]
fn the_vector_corpus_is_well_formed_xml() {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../vectors");
    let mut files: Vec<PathBuf> = fs::read_dir(&dir)
        .expect("vectors/")
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "json"))
        .collect();
    files.sort();
    let mut failures: Vec<String> = Vec::new();
    for path in files {
        let cases: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        for case in cases.as_array().unwrap() {
            let name = case["name"].as_str().unwrap();
            let doc = parse(case["marquee"].as_str().unwrap()).unwrap();
            for profile in [&BareWebProfile as &dyn Profile, &Everything] {
                if let Err(e) = well_formed(&render_with(&doc, profile, Output::Xhtml)) {
                    failures.push(format!("{name}: {e}"));
                }
            }
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

const KITCHEN_SINK: &str = concat!(
    "one\\\ntwo\n\n",
    "---\n\n",
    "![a picture](p.png) ![a song](s.mp3) ![a clip](c.mp4) ![a loop](l.gif) :horse:\n\n",
    "![two\nlines](p.png)\n\n",
    "&nbsp; &copy; &amp; <br> \"quoted\"\n\n",
    "nul\u{0}bell\u{7}tab\there \u{FFFF}\n\n",
    "[rainbow by=letter]co\u{1}lor[/rainbow]\n",
);

#[test]
fn void_elements_close_and_boolean_attributes_carry_values() {
    let html = render_marquee(KITCHEN_SINK, &Everything).unwrap();
    assert!(well_formed(&html).is_err(), "the HTML spelling should not pass as XML: {html}");
    assert!(well_formed("<p>bell\u{7}</p>").is_err(), "the checker itself refuses what XML forbids");

    let xhtml = render_marquee_with(KITCHEN_SINK, &Everything, Output::Xhtml).unwrap();
    well_formed(&xhtml).unwrap_or_else(|e| panic!("{e}\n{xhtml}"));
    for spelling in [
        "<br/>",
        "<hr/>",
        "<img class=\"mq-embed\" src=\"p.png\" alt=\"a picture\" loading=\"lazy\"/>",
        "<img class=\"mq-emoji\" src=\"emoji/horse.png\" alt=\":horse:\" loading=\"lazy\"/>",
        "<audio class=\"mq-embed\" controls=\"controls\" src=\"s.mp3\"",
        "<video class=\"mq-embed\" controls=\"controls\" src=\"c.mp4\"",
        "<video class=\"mq-embed\" autoplay=\"autoplay\" loop=\"loop\" muted=\"muted\" playsinline=\"playsinline\" src=\"l.gif\"",
        "alt=\"two&#10;lines\"",
        "&amp;nbsp; &amp;copy; &amp;amp; &lt;br&gt; \"quoted\"",
        "nul\u{FFFD}bell\u{FFFD}tab\there \u{FFFD}",
    ] {
        assert!(xhtml.contains(spelling), "missing {spelling:?}:\n{xhtml}");
    }
}

#[test]
fn xhtml_is_the_same_document_spelled_differently() {
    // Without voids, flags, or awkward characters the two spellings agree
    // byte for byte.
    let src = "# Hi\n\n*a* **b** [link](https://e.x)\n\n:::section scheme=noir\n[rainbow by=word]some words[/rainbow]\n:::\n";
    assert_eq!(
        render_marquee(src, &BareWebProfile).unwrap(),
        render_marquee_with(src, &BareWebProfile, Output::Xhtml).unwrap()
    );
}

/// Notes in a book: a link to another note points at its chapter.
struct Book;

impl Profile for Book {
    fn link_target(&self, target: &str) -> Option<String> {
        target.strip_prefix("https://app.example/note/").map(|id| format!("chapter-{id}.xhtml"))
    }
}

#[test]
fn link_target_rewrites_where_an_allowed_link_points() {
    let html = render_marquee(
        "[the other note](https://app.example/note/07) and [elsewhere](https://e.x)\n\n\
         https://app.example/note/08\n\n\
         ![a document](https://app.example/note/09)\n\n\
         [refused](javascript:alert(1))\n",
        &Book,
    )
    .unwrap();
    assert!(html.contains("<a href=\"chapter-07.xhtml\">the other note</a>"), "{html}");
    assert!(html.contains("<a href=\"https://e.x\">elsewhere</a>"), "None keeps the target: {html}");
    assert!(
        html.contains("<a href=\"chapter-08.xhtml\">https://app.example/note/08</a>"),
        "a turbolink's text stays the author's: {html}"
    );
    assert!(
        html.contains("<a class=\"mq-embed-fallback\" href=\"chapter-09.xhtml\">[a document]</a>"),
        "{html}"
    );
    assert!(html.contains("<span class=\"mq-blocked\">refused</span>"), "a refused link stays refused: {html}");
}

#[test]
fn link_target_is_escaped_like_any_target() {
    struct Sloppy;
    impl Profile for Sloppy {
        fn link_target(&self, _target: &str) -> Option<String> {
            Some("a\"b&c<d".to_string())
        }
    }
    let html = render_marquee("[x](https://e.x)\n", &Sloppy).unwrap();
    assert!(html.contains("href=\"a&quot;b&amp;c&lt;d\""), "{html}");
}
