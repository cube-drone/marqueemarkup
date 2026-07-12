//! Lockstep tests: this crate EMBEDS copies of artifacts whose canonical
//! sources live in the npm packages (one repo, one version number, one set
//! of bytes). These tests pin the equalities, so drift is impossible to
//! ship: change ts/marquee-css/marquee.css and forget the copy here, and
//! release-check fails. Repo-relative paths - these run in the repo, not
//! against the published crate.

use std::fs;
use std::path::PathBuf;

fn repo(rel: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..").join(rel)
}

/// Published-crate escape hatch: these pins compare against the npm
/// packages' sources, which exist in the monorepo but not in a crates.io
/// download. Outside the repo they skip (the release gate runs them where
/// the sources exist).
fn in_repo() -> bool {
    repo("ts/marquee-css/marquee.css").exists()
}

#[test]
fn css_is_byte_identical_to_the_npm_package() {
    if !in_repo() { return; }
    let npm = fs::read_to_string(repo("ts/marquee-css/marquee.css")).unwrap();
    assert!(
        marquee_markup::MARQUEE_CSS == npm,
        "assets/marquee.css drifted from ts/marquee-css/marquee.css - re-copy it"
    );
}

#[test]
fn fonts_are_byte_identical_to_the_npm_package() {
    if !in_repo() { return; }
    let mut count = 0;
    for (token, family) in marquee_markup::FONTS {
        if matches!(*token, "sans" | "serif" | "mono" | "comic") {
            continue;
        }
        let bytes = marquee_markup::font_bytes(token)
            .unwrap_or_else(|| panic!("{token} ({family}) missing from the embedded grab bag"));
        let npm = fs::read(repo(&format!("ts/marquee-fonts/fonts/{token}.woff2"))).unwrap();
        assert!(bytes == npm.as_slice(), "{token}.woff2 drifted - re-copy assets/fonts");
        count += 1;
    }
    assert_eq!(count, 31, "the grab bag is 31 faces");
}

#[test]
fn emoji_table_matches_the_npm_package() {
    if !in_repo() { return; }
    let ts = fs::read_to_string(repo("ts/marquee-emoji/src/standard.ts")).unwrap();
    let mut npm: Vec<(String, String)> = Vec::new();
    for line in ts.lines() {
        let Some(rest) = line.strip_prefix("  \"") else { continue };
        let Some((slug, rest)) = rest.split_once("\": \"") else { continue };
        let Some(emoji) = rest.strip_suffix("\",") else { continue };
        npm.push((slug.to_string(), emoji.to_string()));
    }
    let ours = marquee_markup::standard_emoji_table();
    assert_eq!(ours.len(), npm.len(), "table sizes differ - regenerate emoji_standard.rs");
    for ((slug, emoji), (npm_slug, npm_emoji)) in ours.iter().zip(&npm) {
        assert_eq!((*slug, *emoji), (npm_slug.as_str(), npm_emoji.as_str()));
    }
    assert_eq!(marquee_markup::standard_emoji("sparkles"), Some("✨"));
    assert_eq!(marquee_markup::standard_emoji("+1"), Some("👍"));
    assert_eq!(marquee_markup::standard_emoji("thisoneisnotreal"), None);
}

#[test]
fn card_css_matches_the_npm_package() {
    if !in_repo() { return; }
    let ts = fs::read_to_string(repo("ts/marquee-turbolink/src/card.ts")).unwrap();
    let start = ts.find("export const cardCss = `").unwrap() + "export const cardCss = `".len();
    let end = start + ts[start..].find('`').unwrap();
    assert_eq!(marquee_markup::turbolink::CARD_CSS, &ts[start..end], "card css drifted");
}
