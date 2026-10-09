//! The only paths author bytes may take into markup.

pub fn escape_text(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

pub fn escape_attr(s: &str) -> String {
    escape_text(s).replace('"', "&quot;")
}

/// Characters XML 1.0 forbids outright - even as a numeric reference: the C0
/// controls bar tab, newline, and return, and the noncharacters U+FFFE/U+FFFF.
/// HTML parsers shrug these off; an XML parser refuses the whole page, so
/// XHTML output carries U+FFFD in their place.
fn xml_forbidden(c: char) -> bool {
    matches!(c, '\0'..='\u{8}' | '\u{B}' | '\u{C}' | '\u{E}'..='\u{1F}' | '\u{FFFE}' | '\u{FFFF}')
}

pub(crate) fn escape_text_xml(s: &str) -> String {
    let text = escape_text(s);
    if text.contains(xml_forbidden) {
        text.chars().map(|c| if xml_forbidden(c) { '\u{FFFD}' } else { c }).collect()
    } else {
        text
    }
}

/// An XML parser normalizes whitespace in an attribute value to spaces, so a
/// newline in alt text survives only as a character reference.
pub(crate) fn escape_attr_xml(s: &str) -> String {
    escape_text_xml(s)
        .replace('"', "&quot;")
        .replace('\t', "&#9;")
        .replace('\n', "&#10;")
        .replace('\r', "&#13;")
}
