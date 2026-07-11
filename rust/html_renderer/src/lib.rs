//! Reference static HTML renderer for the Marquee markup language (Rust).
//!
//! A faithful port of ts/html_renderer: same class contract (marquee.css),
//! same Profile socket, same behavioral obligations. Output is NOT required
//! to match the TypeScript renderer byte-for-byte - renderers may differ;
//! the shared surface is the mq-* class vocabulary and the spec's renderer
//! obligations, which this crate's behavioral tests encode.

mod escape;
mod profile;
mod render;

pub use escape::{escape_attr, escape_text};
pub use profile::{BareWebProfile, EmojiResolution, MediaKind, MediaResolution, Profile, TurbolinkLevel};
pub use render::{render, used_font_tokens, FONTS};

use marquee_parser::{parse, Node, ParseError};

/// Parse and render in one step. Errors only on an unknown dialect version,
/// exactly as the parser does.
pub fn render_marquee(source: &str, profile: &dyn Profile) -> Result<String, ParseError> {
    let doc: Node = parse(source)?;
    Ok(render(&doc, profile))
}
