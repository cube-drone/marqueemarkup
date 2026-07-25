#![doc = include_str!("../README.md")]

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
