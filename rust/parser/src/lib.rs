//! Reference parser for the Marquee markup language.
//!
//! Parse is total: any byte sequence yields a document. The one refusal is
//! an unknown dialect version (SPEC.md, "Conformance"), surfaced as an error
//! rather than a guessed parse.

mod ast;
mod attrs;
mod blocks;
mod inlines;

pub use ast::{Attrs, Node, Reason};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParseError {
    UnsupportedVersion(u64),
}

impl std::fmt::Display for ParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ParseError::UnsupportedVersion(v) => write!(f, "unsupported marquee version {v}"),
        }
    }
}

impl std::error::Error for ParseError {}

pub fn parse(input: &str) -> Result<Node, ParseError> {
    // Front-door normalization: \r\n and \r become \n before anything else.
    let normalized = input.replace("\r\n", "\n").replace('\r', "\n");
    let (version, body) = strip_version(&normalized);
    if version != 0 {
        return Err(ParseError::UnsupportedVersion(version));
    }
    Ok(Node::Document {
        version,
        children: blocks::parse_blocks(body),
    })
}

/// The in-band version declaration: line 1, exactly `#!marquee <integer>`.
/// The default is version 0, forever.
fn strip_version(s: &str) -> (u64, &str) {
    let first = s.split('\n').next().unwrap_or("");
    if let Some(digits) = first.strip_prefix("#!marquee ") {
        if !digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit()) {
            if let Ok(v) = digits.parse::<u64>() {
                let body = &s[first.len()..];
                return (v, body.strip_prefix('\n').unwrap_or(body));
            }
        }
    }
    (0, s)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_version_is_refused() {
        assert_eq!(parse("#!marquee 7\nhi\n"), Err(ParseError::UnsupportedVersion(7)));
    }

    #[test]
    fn malformed_version_line_is_prose() {
        let doc = parse("#!marquee 1x\n").unwrap();
        let Node::Document { version, children } = &doc else { panic!() };
        assert_eq!(*version, 0);
        assert_eq!(children.len(), 1); // a paragraph, not a refusal
    }
}
