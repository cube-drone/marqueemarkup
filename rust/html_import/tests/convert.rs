//! What HTML becomes. Each test pins one mapping or one bit of feed-shaped
//! messiness.

use marquee_html_import::{convert, to_marquee, to_marquee_with, OnLoss, Options};

fn mq(html: &str) -> String {
    to_marquee(html)
}

fn based(html: &str, base: &str) -> String {
    to_marquee_with(html, &Options { base_url: Some(base.into()), ..Default::default() })
}

// ---- the prose core ----

#[test]
fn prose_maps_straight_across() {
    assert_eq!(mq("<h2>Hi</h2><p>One <em>two</em> <strong>three</strong> <del>four</del></p>"), "## Hi\n\nOne *two* **three** ~~four~~\n");
    assert_eq!(mq("<blockquote><p>quoted</p></blockquote>"), "> quoted\n");
    assert_eq!(mq("<ul><li>a</li><li>b</li></ul><hr><ol><li>c</li></ol>"), "- a\n- b\n\n---\n\n1. c\n");
    assert_eq!(mq("<p>use <code>x()</code></p>"), "use `x()`\n");
    assert_eq!(mq("<p>a<sup>2</sup></p>"), "a[sup]2[/sup]\n");
}

#[test]
fn whitespace_collapses_like_a_browser() {
    assert_eq!(mq("<p>  lots \n\n of\t space  </p>"), "lots of space\n");
    assert_eq!(mq("<p>a<em> b </em>c</p>"), "a *b* c\n");
}

#[test]
fn entities_decode_and_markup_characters_stay_literal() {
    let out = mq("<p>&lt;b&gt; &amp; *stars* [x](y) :smile: </p><p># not a heading</p>");
    assert!(out.contains("<b> & \\*stars\\* \\[x\\](y) \\:smile:"), "{out}");
    assert!(out.contains("\\# not a heading"), "{out}");
}

#[test]
fn double_br_is_a_paragraph_break_single_br_a_hard_break() {
    assert_eq!(mq("one<br><br>two<br>three"), "one\n\ntwo\\\nthree\n");
    assert_eq!(mq("<div>a<br> <br>b</div>"), "a\n\nb\n");
}

#[test]
fn loose_text_in_divs_becomes_paragraphs() {
    assert_eq!(mq("<div>first<div>second</div>third</div>"), "first\n\nsecond\n\nthird\n");
}

#[test]
fn headings_are_one_line() {
    assert_eq!(mq("<h1>a<br>b</h1>"), "# a b\n");
    assert_eq!(mq("<h3>   </h3><p>x</p>"), "x\n");
}

#[test]
fn nested_lists_and_paragraph_items() {
    let out = mq("<ul><li>one<ul><li>deep</li></ul></li><li><p>two</p></li></ul>");
    let tree = marquee_parser::parse(&out).expect("parses");
    let marquee_parser::Node::Document { children, .. } = tree else { panic!() };
    assert_eq!(children.len(), 1, "one list: {out}");
    assert!(out.contains("  - deep"), "{out}");
}

#[test]
fn stray_content_in_a_list_is_kept_as_an_item() {
    let out = mq("<ul>loose<li>real</li></ul>");
    assert!(out.contains("- loose") && out.contains("- real"), "{out}");
}

#[test]
fn code_blocks_keep_their_language_and_layout() {
    let out = mq("<pre><code class=\"hljs language-rust\">fn x() {\n    1\n}\n</code></pre>");
    assert_eq!(out, "```rust\nfn x() {\n    1\n}\n```\n");
    // A body with a fence in it still survives.
    let out = mq("<pre>```\nstill code\n```</pre>");
    assert!(out.starts_with("````\n"), "{out}");
}

// ---- formatting Marquee can't spell ----

#[test]
fn same_kind_formatting_never_nests_or_abuts() {
    assert_eq!(mq("<p><em>a <i>b</i> c</em></p>"), "*a b c*\n");
    assert_eq!(mq("<p><b>a</b><b>b</b></p>"), "**ab**\n");
}

#[test]
fn star_formatting_never_forms_a_triple_run() {
    assert_eq!(mq("<p><em><strong>both</strong></em></p>"), "*both*\n");
    assert_eq!(mq("<p><em>x</em><strong>y</strong></p>"), "*x*y\n");
    assert_eq!(mq("<p><strong>a <em>b</em></strong> c</p>"), "**a b** c\n");
}

#[test]
fn empty_formatting_disappears() {
    assert_eq!(mq("<p>a<b></b><em> </em>b</p>"), "a b\n");
}

// ---- links and media ----

#[test]
fn relative_references_resolve_against_the_base() {
    let out = based("<a href=\"../other\">x</a> <img src=\"/i.png\" alt=\"pic\">", "https://blog.example/a/b/post");
    assert!(out.contains("[x](https://blog.example/a/other)"), "{out}");
    assert!(out.contains("![pic](https://blog.example/i.png)"), "{out}");
}

#[test]
fn without_a_base_relative_references_stay_relative() {
    assert_eq!(mq("<a href=\"/x\">x</a>"), "[x](/x)\n");
}

#[test]
fn targets_are_spelled_for_the_marquee_lexer() {
    let out = mq("<a href=\"https://e.x/a (b)/[c]\">t</a>");
    assert_eq!(out, "[t](https://e.x/a%20%28b%29/%5Bc%5D)\n");
}

#[test]
fn fragment_links_unwrap() {
    assert_eq!(mq("<p>claim<a href=\"#fn1\">1</a></p>"), "claim1\n");
}

#[test]
fn lazy_images_find_their_real_source() {
    let out = mq("<img src=\"data:image/gif;base64,R0lGOD\" data-src=\"https://e.x/real.jpg\" alt=\"a\">");
    assert_eq!(out, "![a](https://e.x/real.jpg)\n");
    let out = mq("<img srcset=\"https://e.x/s.jpg 1x, https://e.x/l.jpg 2x\" alt=\"b\">");
    assert_eq!(out, "![b](https://e.x/s.jpg)\n");
}

#[test]
fn tracking_pixels_vanish() {
    assert_eq!(mq("<p>text<img src=\"https://t.x/p.gif\" width=\"1\" height=\"1\"></p>"), "text\n");
}

#[test]
fn emoji_images_become_their_character() {
    assert_eq!(mq("<p>hi <img class=\"wp-smiley\" src=\"https://s.w.org/x.png\" alt=\"😀\"></p>"), "hi 😀\n");
}

#[test]
fn video_and_audio_are_embeds() {
    assert_eq!(mq("<video controls><source src=\"https://e.x/v.mp4\"></video>"), "![](https://e.x/v.mp4)\n");
    assert_eq!(mq("<audio src=\"https://e.x/a.mp3\" title=\"song\"></audio>"), "![song](https://e.x/a.mp3)\n");
}

#[test]
fn iframes_become_turbolinks() {
    assert_eq!(mq("<iframe src=\"https://www.youtube.com/embed/abc\"></iframe>"), "https://www.youtube.com/watch?v=abc\n");
    assert_eq!(mq("<iframe src=\"https://player.vimeo.com/video/42\"></iframe>"), "https://vimeo.com/42\n");
}

#[test]
fn a_link_around_an_image_keeps_both() {
    assert_eq!(mq("<a href=\"https://e.x/big\"><img src=\"https://e.x/s.jpg\" alt=\"s\"></a>"), "[![s](https://e.x/s.jpg)](https://e.x/big)\n");
}

// ---- tables ----

#[test]
fn data_tables_become_marquee_tables() {
    let out = mq("<table><thead><tr><th>dish</th><th>price</th></tr></thead><tbody><tr><td><em>Spag</em></td><td>$12</td></tr></tbody></table>");
    assert_eq!(out, ":::table header=row\n[c]dish[/c] [c]price[/c]\n\n[c]*Spag*[/c] [c]$12[/c]\n:::\n");
}

#[test]
fn header_columns_are_detected() {
    let out = mq("<table><tr><th>a</th><td>1</td></tr><tr><th>b</th><td>2</td></tr></table>");
    assert!(out.starts_with(":::table header=column\n"), "{out}");
}

#[test]
fn layout_tables_unwrap_to_their_content() {
    assert_eq!(mq("<table><tr><td><p>just</p><p>layout</p></td></tr></table>"), "just\n\nlayout\n");
    let out = mq("<table><tr><td><h2>side</h2></td><td><ul><li>x</li></ul></td></tr></table>");
    assert_eq!(out, "## side\n\n- x\n");
}

// ---- refusals ----

#[test]
fn script_style_and_friends_vanish_with_their_content() {
    let out = mq("<p>a</p><script>alert(1)</script><style>p{color:red}</style><svg><text>icon</text></svg><button>Share</button><p>b</p>");
    assert_eq!(out, "a\n\nb\n");
}

#[test]
fn hidden_content_vanishes() {
    assert_eq!(mq("<p>seen</p><div style=\"display: NONE\">unseen</div><p hidden>also</p>"), "seen\n");
}

#[test]
fn dangerous_schemes_unwrap_to_text() {
    for href in ["javascript:alert(1)", " JaVaScRiPt:alert(1)", "java\tscript:alert(1)", "vbscript:x", "data:text/html,<script>"] {
        let out = mq(&format!("<a href=\"{href}\">click</a>"));
        assert_eq!(out, "click\n", "{href:?}");
    }
    assert_eq!(mq("<img src=\"javascript:alert(1)\" alt=\"pic\">"), "pic\n");
}

#[test]
fn mailto_links_are_fine() {
    assert_eq!(mq("<a href=\"mailto:a@b.c\">mail</a>"), "[mail](mailto:a@b.c)\n");
}

#[test]
fn nesting_past_the_caps_flattens_instead_of_breaking() {
    let deep_quote = format!("{}deep{}", "<blockquote>".repeat(30), "</blockquote>".repeat(30));
    let out = mq(&deep_quote);
    assert!(out.contains("deep"), "{out}");
    assert_eq!(out.lines().next().unwrap().matches('>').count(), 16, "{out}");
    let deep_list = format!("{}deep{}", "<ul><li>".repeat(30), "</li></ul>".repeat(30));
    let out = mq(&deep_list);
    assert!(out.contains("- deep") && !out.contains("\\-"), "{out}");
}

// ---- losses ----

#[test]
fn losses_are_reported_and_deduplicated() {
    let c = convert("<script></script><script></script><a href=\"javascript:x\">y</a>", &Options::default());
    assert_eq!(c.losses, vec!["2× dropped <script>", "dropped a link with a 'javascript:' target"]);
    assert_eq!(c.marquee, "y\n");
}

#[test]
fn loss_comment_rides_along_on_request() {
    let out = to_marquee_with("<script></script>hi", &Options { on_loss: OnLoss::Comment, ..Default::default() });
    assert_eq!(out, "hi\n\n%% marquee-html-import — lost converting from HTML:\n%% - dropped <script>\n");
}

#[test]
fn whole_documents_lose_their_head() {
    let out = mq("<!DOCTYPE html><html><head><title>T</title><style>x</style></head><body><p>body</p></body></html>");
    assert_eq!(out, "body\n");
}
