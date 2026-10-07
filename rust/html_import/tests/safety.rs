//! The safety argument, tested end to end. The converter's output is Marquee
//! source; the renderer is the security boundary. So: throw hostile tag soup
//! at the converter, render what comes out, and check the rendered HTML for
//! anything executable. Alongside: the output always parses, and it is
//! already in canonical form (each block reads back as the tree we built).

use marquee_html_import::{to_marquee, to_marquee_with, Options};
use marquee_html_renderer::{render_marquee, BareWebProfile};
use scraper::{Html, Node as Dom};

/// xorshift64* — deterministic, dependency-free.
struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
    fn pick<'a>(&mut self, xs: &[&'a str]) -> &'a str {
        xs[(self.next() % xs.len() as u64) as usize]
    }
    fn chance(&mut self, n: u64) -> bool {
        self.next().is_multiple_of(n)
    }
}

const TAGS: &[&str] = &[
    "p", "div", "span", "a", "b", "strong", "i", "em", "s", "del", "code", "pre", "ul", "ol", "li",
    "blockquote", "h1", "h2", "h4", "br", "hr", "img", "table", "tr", "td", "th", "thead", "sup",
    "sub", "q", "script", "style", "iframe", "svg", "video", "source", "dl", "dt", "dd", "figure",
    "figcaption", "font", "center", "noscript", "object", "textarea", "math", "title", "x-custom",
];

const TEXTS: &[&str] = &[
    "hello", " ", "\n", "*", "**", "***", "~~", "_", "`", "``", "[", "]", "(", ")", "![", "](",
    ":smile:", ":", "#", "# ", "- ", "1. ", "> ", "%%", ":::", "---", "\\", "!", "<", "&lt;script&gt;",
    "&amp;", "https://e.x/", "javascript:alert(1)", "[/c]", "[c]", "[color=red]", "\u{a0}", "😀",
];

const ATTRS: &[&str] = &[
    "href=\"javascript:alert(1)\"", "href=\"https://e.x/a(b\"", "href=\"/rel)ative\"",
    "href=\" JAVASCRIPT:x\"", "href=\"data:text/html,x\"", "href=\"#frag\"", "href=\"mailto:a@b\"",
    "src=\"https://e.x/i.png\"", "src=\"javascript:alert(1)\"", "src=\"x](javascript:alert(1)\"",
    "alt=\"](javascript:alert(1))\"", "alt=\"a]b[c\"", "onerror=\"alert(1)\"", "onclick=\"x\"",
    "style=\"background:url(javascript:x)\"", "style=\"display:none\"", "class=\"language-x`y\"",
    "width=\"1\"", "hidden", "srcset=\"https://e.x/1.png 1x\"",
];

fn soup(rng: &mut Rng, depth: usize) -> String {
    let mut out = String::new();
    let n = 1 + rng.next() % 5;
    for _ in 0..n {
        if depth > 6 || rng.chance(2) {
            out.push_str(rng.pick(TEXTS));
            continue;
        }
        let tag = rng.pick(TAGS);
        out.push('<');
        out.push_str(tag);
        for _ in 0..rng.next() % 3 {
            out.push(' ');
            out.push_str(rng.pick(ATTRS));
        }
        out.push('>');
        out.push_str(&soup(rng, depth + 1));
        // Sometimes leave it unclosed, sometimes close the wrong thing.
        if !rng.chance(5) {
            let close = if rng.chance(8) { rng.pick(TAGS) } else { tag };
            out.push_str(&format!("</{close}>"));
        }
    }
    out
}

/// Anything executable in rendered HTML: a script-ish element, an event
/// handler attribute, or a URL attribute with a non-web scheme.
fn hazards(html: &str) -> Vec<String> {
    let doc = Html::parse_fragment(html);
    let mut found = Vec::new();
    for node in doc.tree.root().descendants() {
        let Dom::Element(el) = node.value() else { continue };
        if matches!(el.name(), "script" | "iframe" | "object" | "embed" | "frame" | "base" | "form" | "meta") {
            found.push(format!("<{}>", el.name()));
        }
        for (name, value) in el.attrs() {
            if name.starts_with("on") {
                found.push(format!("{name}= on <{}>", el.name()));
            }
            if matches!(name, "href" | "src" | "action" | "formaction" | "poster" | "srcset" | "xlink:href") {
                let v: String = value.chars().filter(|c| !c.is_whitespace() && !c.is_control()).collect::<String>().to_ascii_lowercase();
                if v.starts_with("javascript:") || v.starts_with("vbscript:") || v.starts_with("data:") {
                    found.push(format!("{name}={value:?} on <{}>", el.name()));
                }
            }
        }
    }
    found
}

fn check(html: &str) {
    for options in [Options::default(), Options { base_url: Some("https://blog.example/a/".into()), ..Default::default() }] {
        let out = to_marquee_with(html, &options);
        let tree = marquee_parser::parse(&out).unwrap_or_else(|e| panic!("unparseable output {e} for {html:?}"));
        assert_eq!(marquee_parser::serialize(&tree), out, "output not canonical for {html:?}");
        let rendered = render_marquee(&out, &BareWebProfile).expect("renders");
        let found = hazards(&rendered);
        assert!(found.is_empty(), "hazards {found:?}\ninput: {html:?}\nmarquee: {out:?}\nhtml: {rendered}");
    }
}

#[test]
fn hostile_soup_fuzz() {
    let mut rng = Rng(0x9E37_79B9_7F4A_7C15);
    for _ in 0..3000 {
        check(&soup(&mut rng, 0));
    }
}

#[test]
fn known_xss_shapes() {
    for html in [
        "<img src=x onerror=alert(1)>",
        "<a href=\"javascript:alert(1)\">x</a>",
        "<a href=\"&#106;avascript:alert(1)\">x</a>",
        "<a href=\"jav&#x09;ascript:alert(1)\">x</a>",
        "<svg onload=alert(1)>",
        "<iframe src=\"javascript:alert(1)\"></iframe>",
        "<iframe srcdoc=\"<script>alert(1)</script>\"></iframe>",
        "<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>",
        "<noscript><p title=\"</noscript><img src=x onerror=alert(1)>\">",
        "<a href=\"https://ok.x/\" onclick=\"alert(1)\">x</a>",
        "<img alt=\"](javascript:alert(1))\" src=\"https://e.x/i.png\">",
        "<a href=\"https://e.x/)](javascript:alert(1)\">x</a>",
        "<p>[x](javascript:alert(1))</p>",
        "<p>![x](javascript:alert(1))</p>",
        "<form action=\"javascript:alert(1)\"><button>go</button></form>",
        "<video poster=\"javascript:alert(1)\" src=\"https://e.x/v.mp4\"></video>",
        "<object data=\"javascript:alert(1)\"></object>",
        "<base href=\"javascript:alert(1)//\"><a href=\"/x\">x</a>",
        "<div style=\"background:url(javascript:alert(1))\">x</div>",
    ] {
        check(html);
    }
}

#[test]
fn script_text_never_survives() {
    let out = to_marquee("<p>a</p><script>document.cookie</script><style>.x{}</style>");
    assert!(!out.contains("cookie") && !out.contains(".x"), "{out}");
}

#[test]
fn pathological_nesting_neither_overflows_nor_loses_text() {
    // Each of these overflowed the stack before the DOM depth guard.
    for html in [
        format!("{}spans{}", "<span>".repeat(5000), "<div>block</div>"),
        format!("{}divs", "<div>".repeat(5000)),
        format!("{}formatting", "<b><i>".repeat(3000)),
        format!("{}items", "<ul><li>".repeat(3000)),
    ] {
        let out = to_marquee(&html);
        let word = html.rsplit('>').next().unwrap_or("").to_string();
        let word = if word.is_empty() { "block".to_string() } else { word };
        assert!(out.contains(&word), "lost {word:?}: {out:?}");
        marquee_parser::parse(&out).expect("parses");
    }
}
