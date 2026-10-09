#![doc = include_str!("../README.md")]

mod escape;
mod profile;
mod render;

pub use escape::{escape_attr, escape_text};
pub use profile::{BareWebProfile, EmojiResolution, MediaKind, MediaResolution, Profile, TurbolinkLevel};
pub use render::{render, render_with, used_font_tokens, Output, FONTS};

use marquee_parser::{parse, Node, ParseError};

/// Parse and render in one step. Errors only on an unknown dialect version,
/// exactly as the parser does.
pub fn render_marquee(source: &str, profile: &dyn Profile) -> Result<String, ParseError> {
    let doc: Node = parse(source)?;
    Ok(render(&doc, profile))
}

/// Parse and render in one step, in the given output spelling - `Output::Xhtml`
/// for a page that must be well-formed XML, like an ePub's.
pub fn render_marquee_with(source: &str, profile: &dyn Profile, output: Output) -> Result<String, ParseError> {
    let doc: Node = parse(source)?;
    Ok(render_with(&doc, profile, output))
}
