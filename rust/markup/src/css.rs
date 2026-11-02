//! The reference stylesheet, embedded. The canonical file lives at
//! ts/marquee-css/marquee.css (the npm package @cube-drone/marquee-css);
//! this crate carries a byte-identical copy so Rust consumers need no npm -
//! a lockstep test pins the equality, and set-version's lockstep versioning
//! means "same number = same stylesheet".

use std::sync::OnceLock;

/// The stylesheet file, comments and all.
pub const MARQUEE_CSS: &str = include_str!("../assets/marquee.css");

/// The stylesheet as it goes out over the wire, often inlined into every page:
/// [`MARQUEE_CSS`] without its comments.
pub fn marquee_css() -> &'static str {
    static STRIPPED: OnceLock<String> = OnceLock::new();
    STRIPPED.get_or_init(|| strip_css_comments(MARQUEE_CSS))
}

/// Strip CSS comments and indentation, keeping `/*!` notices (a license has to
/// travel with the code). A comment becomes a space, because in CSS it separates
/// tokens; quoted strings are skipped whole, because a data: URI can say
/// anything. Kept in lockstep with the npm package's copy.
pub fn strip_css_comments(css: &str) -> String {
    let bytes = css.as_bytes();
    let mut out = String::with_capacity(css.len());
    let mut i = 0;
    let mut start = 0; // the run of bytes being kept; every delimiter is ASCII
    let mut quote = 0u8;
    while i < bytes.len() {
        let c = bytes[i];
        if quote != 0 {
            if c == b'\\' {
                i += 1;
            } else if c == quote {
                quote = 0;
            }
            i += 1;
        } else if c == b'"' || c == b'\'' {
            quote = c;
            i += 1;
        } else if c == b'/' && bytes.get(i + 1) == Some(&b'*') {
            let end = css[i + 2..].find("*/").map_or(css.len(), |n| i + 2 + n + 2);
            if bytes.get(i + 2) == Some(&b'!') {
                i = end; // part of the kept run
            } else {
                out.push_str(&css[start..i]);
                out.push(' ');
                i = end;
                start = end;
            }
        } else {
            i += 1;
        }
    }
    out.push_str(&css[start.min(css.len())..]);
    let lines: Vec<&str> = out.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    lines.join("\n")
}
