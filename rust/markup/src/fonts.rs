//! The font grab bag, embedded (the Rust spelling of
//! @cube-drone/marquee-fonts). Optional in spirit: every font name degrades
//! to its fallback stack without these bytes; they exist so pages can wear
//! the actual faces with zero third-party CDN fetches. Two deliveries,
//! exactly as the npm package: external files (a real site - use
//! `font_bytes` to write them) or inline base64 (a self-contained page).

use base64::Engine as _;
use marquee_html_renderer::FONTS;

include!("font_files.rs");

/// The face's family name, from the renderer's shared FONTS vocabulary.
/// None for the four standard stacks (they are fallback stacks, not files)
/// and for unknown tokens.
fn family(token: &str) -> Option<&'static str> {
    const STANDARD_STACKS: [&str; 4] = ["sans", "serif", "mono", "comic"];
    if STANDARD_STACKS.contains(&token) {
        return None;
    }
    FONTS.iter().find(|(t, _)| *t == token).map(|(_, f)| *f)
}

/// The embedded WOFF2 bytes for a face, for site builders shipping fonts/
/// beside their pages. None for standard stacks and unknown tokens.
pub fn font_bytes(token: &str) -> Option<&'static [u8]> {
    family(token)?;
    FONT_FILES.iter().find(|(t, _)| *t == token).map(|(_, b)| *b)
}

fn face_rule(token: &str, src: &str) -> Option<String> {
    let family = family(token)?;
    Some(format!(
        "@font-face {{\n  font-family: \"{family}\";\n  src: {src};\n  font-display: swap;\n}}"
    ))
}

fn sorted_unique(tokens: &[String]) -> Vec<&str> {
    let mut t: Vec<&str> = tokens.iter().map(|s| s.as_str()).collect();
    t.sort_unstable();
    t.dedup();
    t
}

/// @font-face rules pointing at files you serve yourself,
/// `{base}{token}.woff2`. Unknown tokens are skipped - fallbacks handle them.
pub fn external_font_faces(tokens: &[String], base: &str) -> String {
    sorted_unique(tokens)
        .into_iter()
        .filter(|t| font_bytes(t).is_some())
        .filter_map(|t| face_rule(t, &format!("url(\"{base}{t}.woff2\") format(\"woff2\")")))
        .collect::<Vec<_>>()
        .join("\n\n")
}

/// @font-face rules with the WOFF2 bytes inlined as base64 data URIs: a
/// fully self-contained page, no font files to host. Only the faces you
/// pass are paid for.
pub fn inline_font_faces(tokens: &[String]) -> String {
    sorted_unique(tokens)
        .into_iter()
        .filter_map(|t| {
            let bytes = font_bytes(t)?;
            let data = base64::engine::general_purpose::STANDARD.encode(bytes);
            face_rule(t, &format!("url(data:font/woff2;base64,{data}) format(\"woff2\")"))
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}
