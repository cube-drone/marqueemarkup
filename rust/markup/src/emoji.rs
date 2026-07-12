//! The standard emoji shortcode table, embedded (the Rust spelling of
//! @cube-drone/marquee-emoji): gemoji's slug -> character data. The spec
//! refuses to own the contested 3,000-entry table; this is the referenced
//! standard one, made linkable. Custom image emoji belong to the embedder's
//! own table, layered on top.

mod table {
    include!("emoji_standard.rs");
}

/// gemoji's standard shortcode table: slug -> unicode character. The table
/// is sorted by slug; lookups are binary searches.
pub fn standard_emoji(slug: &str) -> Option<&'static str> {
    table::STANDARD
        .binary_search_by(|(s, _)| s.cmp(&slug))
        .ok()
        .map(|i| table::STANDARD[i].1)
}

/// The whole table, for embedders building their own resolution.
pub fn standard_emoji_table() -> &'static [(&'static str, &'static str)] {
    table::STANDARD
}
