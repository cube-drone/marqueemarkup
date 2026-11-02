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

/// The same cases as the npm package's css.test.ts: both strippers must agree.
#[test]
fn comment_stripping_matches_the_npm_package() {
    use marquee_markup::strip_css_comments as strip;
    assert_eq!(strip("a { color: red; } /* gone */\n"), "a { color: red; }");
    assert_eq!(strip("/* whole\n   lines */\n\n  b {\n    top: 0;\n  }\n"), "b {\ntop: 0;\n}");
    assert_eq!(strip("/*! keep\n * me */\na{}"), "/*! keep\n* me */\na{}");
    assert_eq!(strip("a{b:c/**/d}"), "a{b:c d}");
    assert_eq!(strip("a{background:url(\"x/*y*/z\")}"), "a{background:url(\"x/*y*/z\")}");
    assert_eq!(strip("a{content:'\\'/*k*/'}"), "a{content:'\\'/*k*/'}");
    assert_eq!(strip("a{content:\"é\"}/* é */b{}"), "a{content:\"é\"} b{}");
    assert_eq!(strip("a{} /* never closed"), "a{}");
}

#[test]
fn the_wire_stylesheet_leaves_comments_behind_but_not_the_license() {
    let css = marquee_markup::marquee_css();
    assert!(css.len() < marquee_markup::MARQUEE_CSS.len());
    assert!(!css.contains("the reference stylesheet for rendered Marquee"), "ordinary comments go");
    assert!(css.contains("Copyright 2020 Jordan Scales"), "MIT notice stays");
    assert!(css.contains("Copyright 2020 Adam Hammad, Jordan Scales"), "MIT notice stays");
    assert!(css.contains(".mq-scheme-windows-xp"), "the rules stay");
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
