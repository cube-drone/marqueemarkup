//! The attribute grammar (SPEC.md, "The attribute grammar"). Shared by
//! directive open lines and span openers; only the failure mode differs
//! (blocks get `invalid_directive` nodes, spans fall back to literal text).

use crate::ast::{Attrs, Reason};

pub const MAX_ATTR_VALUE_BYTES: usize = 2048;

pub fn is_name(s: &str) -> bool {
    let mut bytes = s.bytes();
    match bytes.next() {
        Some(b) if b.is_ascii_lowercase() => {}
        _ => return false,
    }
    bytes.all(|b| matches!(b, b'a'..=b'z' | b'0'..=b'9' | b'_' | b'-'))
}

/// Length of the leading name in `s`, if any.
pub fn name_len(s: &str) -> usize {
    let b = s.as_bytes();
    if b.first().is_some_and(|c| c.is_ascii_lowercase()) {
        b.iter()
            .take_while(|c| matches!(c, b'a'..=b'z' | b'0'..=b'9' | b'_' | b'-'))
            .count()
    } else {
        0
    }
}

/// Parse a whitespace-separated `key=value` list. Duplicate keys resolve
/// first-writer-wins. Any deviation from the grammar is an error.
pub fn parse_attrs(src: &str) -> Result<Attrs, Reason> {
    let mut map = Attrs::new();
    let mut rest = src;
    loop {
        rest = rest.trim_start_matches([' ', '\t']);
        if rest.is_empty() {
            return Ok(map);
        }
        let klen = name_len(rest);
        if klen == 0 {
            return Err(Reason::BadAttribute);
        }
        let key = &rest[..klen];
        rest = &rest[klen..];
        if !rest.starts_with('=') {
            return Err(Reason::BadAttribute);
        }
        rest = &rest[1..];
        let (value, after) = parse_value(rest)?;
        rest = after;
        // After a value: end of input or whitespace.
        if !(rest.is_empty() || rest.starts_with(' ') || rest.starts_with('\t')) {
            return Err(Reason::BadAttribute);
        }
        map.entry(key.to_string()).or_insert(value);
    }
}

/// Parse one attribute value at the start of `s`; returns (value, rest).
pub fn parse_value(s: &str) -> Result<(String, &str), Reason> {
    if let Some(inner) = s.strip_prefix('"') {
        let mut value = String::new();
        let mut chars = inner.char_indices();
        while let Some((i, c)) = chars.next() {
            match c {
                '"' => {
                    if value.len() > MAX_ATTR_VALUE_BYTES {
                        return Err(Reason::AttributeTooLong);
                    }
                    return Ok((value, &inner[i + 1..]));
                }
                '\\' => match chars.next() {
                    Some((_, '"')) => value.push('"'),
                    Some((_, '\\')) => value.push('\\'),
                    _ => return Err(Reason::BadAttribute),
                },
                c => value.push(c),
            }
        }
        Err(Reason::BadAttribute) // unterminated quote
    } else {
        let end = s
            .char_indices()
            .find(|(_, c)| matches!(c, ' ' | '\t' | '"'))
            .map(|(i, _)| i)
            .unwrap_or(s.len());
        if end == 0 {
            return Err(Reason::BadAttribute); // empty bare value
        }
        let rest = &s[end..];
        if rest.starts_with('"') {
            return Err(Reason::BadAttribute); // quote inside a bare value
        }
        if end > MAX_ATTR_VALUE_BYTES {
            return Err(Reason::AttributeTooLong);
        }
        Ok((s[..end].to_string(), rest))
    }
}
