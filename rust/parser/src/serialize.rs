//! AST -> `.mq` source. The inverse of the parser: given a node tree, emit
//! text that parses back to the identical tree. Marquee guarantees one AST per
//! source but NOT one source per AST (`*x*` has many spellings that collapse to
//! one `emphasis`), so this picks a *canonical* spelling - it is a formatter,
//! not a byte-for-byte inverse. The contract it upholds is the round trip:
//! `parse(serialize(ast)) == ast` for every parser-produced tree (the vector
//! corpus and a round-trip fuzzer are the proof).
//!
//! Out of contract:
//! - **Hand-built trees the parser could never emit** - a `depth_exceeded` node
//!   anywhere but at depth 8, an emphasis whose text opens or closes on a space,
//!   a code span whose content edges on a backtick. These have no source form.
//! - **One reachable class the grammar cannot canonicalize:** an unescapable
//!   `[`/`]` nested inside a link or span. Link/embed TARGETS and CODE SPAN text
//!   are emitted raw (neither has any escape), so a bracket in one, sitting
//!   inside an enclosing bracket construct, is counted by that construct's
//!   character-based matching-`]` scan; the literal `]` that balanced it in the
//!   source must be escaped here, and the balance can't be reproduced. This is a
//!   Marquee grammar limitation (targets and code spans have no escape), not a
//!   defect in this code - a candidate spec open-question.

use crate::ast::{Attrs, Node, Reason};

/// Serialize a document (or any node) to canonical `.mq` source.
pub fn serialize(node: &Node) -> String {
    match node {
        Node::Document { children, .. } => {
            let mut s = blocks(children, None);
            // A leading `#!marquee <int>` on line 1 would be stripped as an
            // in-band version declaration, eating the paragraph it came from.
            if leading_version_shebang(&s) {
                s.insert(0, '\\');
            }
            s.push('\n');
            s
        }
        other => block(other, None),
    }
}

fn leading_version_shebang(s: &str) -> bool {
    let first = s.split('\n').next().unwrap_or("");
    first
        .strip_prefix("#!marquee ")
        .is_some_and(|d| !d.is_empty() && d.bytes().all(|b| b.is_ascii_digit()))
}

// ---- blocks -------------------------------------------------------------

/// `open_dir` names the directive whose body this is (None at document level
/// and inside blockquotes / list items, which are fresh containers). It is
/// what a bare `:::` and a mismatched close resolve against.
fn blocks(nodes: &[Node], open_dir: Option<&str>) -> String {
    nodes
        .iter()
        .map(|n| block(n, open_dir))
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn block(node: &Node, open_dir: Option<&str>) -> String {
    match node {
        Node::Document { children, .. } => blocks(children, None),
        Node::Paragraph { children } => paragraph(children),
        Node::Heading { level, children } => {
            format!("{} {}", "#".repeat(*level as usize), inlines(children))
        }
        Node::CodeBlock { info, text } => code_block(info.as_deref(), text),
        Node::Blockquote { children } => blockquote(children),
        Node::List { ordered, children } => list(*ordered, children),
        Node::ListItem { children } => {
            // Only reached defensively; List drives item layout.
            blocks(children, None)
        }
        Node::ThematicBreak => "---".to_string(),
        Node::Directive { name, attrs, children } => directive(name, attrs, children),
        Node::InvalidDirective { reason, .. } => invalid(*reason, open_dir),
        Node::Comment { text } => text
            .split('\n')
            .map(|l| format!("%% {l}"))
            .collect::<Vec<_>>()
            .join("\n"),
        Node::Turbolink { target } => target.clone(),
        // Inline nodes never sit at block position in a real tree; emit inertly.
        other => inlines(std::slice::from_ref(other)),
    }
}

fn directive(name: &str, attrs: &Attrs, children: &[Node]) -> String {
    let attrs_src = directive_attrs(attrs);
    if children.is_empty() {
        if attrs.is_empty() {
            // Leaf form is safe only with no attrs (an attr value ending `:::`
            // would turn a `:::name ...` open line into an accidental leaf).
            format!(":::{name}:::")
        } else {
            format!(":::{name}{attrs_src}\n:::")
        }
    } else {
        let body = blocks(children, Some(name));
        format!(":::{name}{attrs_src}\n{body}\n:::")
    }
}

fn directive_attrs(attrs: &Attrs) -> String {
    attrs
        .iter()
        .map(|(k, v)| format!(" {k}={}", attr_value(v)))
        .collect()
}

fn invalid(reason: Reason, open_dir: Option<&str>) -> String {
    match reason {
        // A close with nothing open (only reached where open_dir is None).
        Reason::StrayClose => ":::".to_string(),
        // A named close that names something other than the innermost open.
        Reason::MismatchedClose => {
            let other = if open_dir == Some("q") { "z" } else { "q" };
            format!("::: {other}")
        }
        // A `:::` line whose name is ill-formed (leading digit).
        Reason::BadName => ":::0".to_string(),
        // An attribute list that doesn't parse (empty bare value).
        Reason::BadAttribute => ":::x y=".to_string(),
        // A value one byte over the 2048 cap.
        Reason::AttributeTooLong => format!(":::x y={}", "v".repeat(2049)),
        // An open past depth 8 (only reproduces when already 8 deep - which,
        // for a parser-produced tree, is exactly where this node sits).
        Reason::DepthExceeded => ":::z".to_string(),
    }
}

fn blockquote(children: &[Node]) -> String {
    blocks(children, None)
        .split('\n')
        .map(|l| if l.is_empty() { ">".to_string() } else { format!("> {l}") })
        .collect::<Vec<_>>()
        .join("\n")
}

fn list(ordered: bool, items: &[Node]) -> String {
    let marker = if ordered { "1. " } else { "- " };
    items
        .iter()
        .map(|item| {
            let ic = match item {
                Node::ListItem { children } => children.as_slice(),
                _ => std::slice::from_ref(item),
            };
            let body = blocks(ic, None);
            let mut out = String::new();
            for (idx, line) in body.split('\n').enumerate() {
                if idx == 0 {
                    out.push_str(marker);
                    out.push_str(line);
                } else {
                    out.push('\n');
                    // Continuation rides in the 2-space content column (the
                    // parser strips exactly 2, for ordered and unordered alike).
                    if !line.is_empty() {
                        out.push_str("  ");
                        out.push_str(line);
                    }
                }
            }
            out
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn code_block(info: Option<&str>, text: &str) -> String {
    // A content line that is all backticks and at least as long as the fence
    // would close it early: outrun every backtick run in the body.
    let longest = text
        .lines()
        .map(|l| {
            let t = l.trim_end_matches([' ', '\t']);
            if !t.is_empty() && t.bytes().all(|b| b == b'`') {
                t.len()
            } else {
                0
            }
        })
        .max()
        .unwrap_or(0);
    let fence = "`".repeat(longest.max(2) + 1);
    match info {
        // A space between fence and info: the parser trims it, and it keeps an
        // info that itself opens with a backtick (reachable when the source put
        // spaces between fence and info) from lengthening the fence count.
        Some(i) => format!("{fence} {i}\n{text}\n{fence}"),
        None => format!("{fence}\n{text}\n{fence}"),
    }
}

// ---- paragraphs & the block-start guard ---------------------------------

fn paragraph(children: &[Node]) -> String {
    let raw = inlines(children);
    let guarded = raw
        .split('\n')
        .map(guard_block_start)
        .collect::<Vec<_>>()
        .join("\n");
    // A lone authority-URI paragraph would be swallowed as a turbolink; break
    // the `://` so it stays prose.
    if !guarded.contains('\n') && is_turbolink(&guarded) {
        return guarded.replacen("://", "\\://", 1);
    }
    guarded
}

/// Escape a paragraph line that would otherwise open a block. Inline escaping
/// already defused `*`, backticks, and brackets; what remains is `#`, `>`,
/// `%%`, `:::`, `---`, and list markers.
fn guard_block_start(line: &str) -> String {
    if is_heading(line)
        || line.starts_with('>')
        || line.starts_with("%%")
        || line.starts_with(":::")
        || is_fence(line)
        || line.trim_end_matches([' ', '\t']) == "---"
    {
        return format!("\\{line}");
    }
    let bytes = line.as_bytes();
    let indent = bytes.iter().take_while(|b| **b == b' ').count();
    let rest = &bytes[indent..];
    // Unordered marker: `- `, `* `, `+ ` (any indent).
    if rest.len() >= 2 && matches!(rest[0], b'-' | b'*' | b'+') && rest[1] == b' ' {
        return format!("{}\\{}", &line[..indent], &line[indent..]);
    }
    // Ordered marker: digits then `. ` - escape the dot, not the digit (a
    // backslash before a digit would survive as a literal backslash).
    let digits = rest.iter().take_while(|b| b.is_ascii_digit()).count();
    if digits > 0 && rest[digits..].starts_with(b". ") {
        let dot = indent + digits;
        return format!("{}\\{}", &line[..dot], &line[dot..]);
    }
    line.to_string()
}

fn is_heading(line: &str) -> bool {
    let n = line.bytes().take_while(|b| *b == b'#').count();
    (1..=8).contains(&n) && line.as_bytes().get(n) == Some(&b' ')
}

fn is_fence(line: &str) -> bool {
    line.bytes().take_while(|b| *b == b'`').count() >= 3
}

fn is_turbolink(line: &str) -> bool {
    let t = line.trim_matches([' ', '\t']);
    if t.is_empty() || t.contains([' ', '\t']) {
        return false;
    }
    let b = t.as_bytes();
    if !b[0].is_ascii_alphabetic() {
        return false;
    }
    let scheme = b
        .iter()
        .take_while(|c| c.is_ascii_alphanumeric() || matches!(c, b'+' | b'-' | b'.'))
        .count();
    t[scheme..].starts_with("://") && t.len() > scheme + 3
}

// ---- inlines ------------------------------------------------------------

fn inlines(nodes: &[Node]) -> String {
    inlines_at(nodes, false)
}

/// `after_bracket` is true when what precedes these nodes is a real `]` (a span
/// opener's `]` for a span's first child, a span closer's `]` for a following
/// sibling). A `(` there would read as a link's `](target)`, so a leading `(`
/// must be escaped. Only `Span` boundaries produce that hazard - every other
/// inline ends in `*`, `)`, backtick, `:` or an escaped `\]`.
fn inlines_at(nodes: &[Node], after_bracket: bool) -> String {
    let mut s = String::new();
    let mut danger = after_bracket;
    for n in nodes {
        match n {
            Node::Text { value } => s.push_str(&escape_text(value, danger)),
            Node::Emphasis { children } => {
                s.push('*');
                s.push_str(&inlines(children));
                s.push('*');
            }
            Node::Strong { children } => {
                s.push_str("**");
                s.push_str(&inlines(children));
                s.push_str("**");
            }
            Node::Strikethrough { children } => {
                s.push_str("~~");
                s.push_str(&inlines(children));
                s.push_str("~~");
            }
            Node::CodeSpan { text } => s.push_str(&code_span(text)),
            Node::Link { target, children } => {
                s.push('[');
                s.push_str(&inlines(children));
                s.push_str("](");
                s.push_str(target);
                s.push(')');
            }
            Node::Embed { target, alt } => {
                s.push_str("![");
                s.push_str(&escape_alt(alt));
                s.push_str("](");
                s.push_str(target);
                s.push(')');
            }
            Node::Span { name, attrs, children } => {
                s.push_str(&span_open(name, attrs));
                s.push_str(&inlines_at(children, true));
                s.push_str(&format!("[/{name}]"));
            }
            Node::Emoji { slug } => {
                s.push(':');
                s.push_str(slug);
                s.push(':');
            }
            Node::HardBreak => s.push_str("\\\n"),
            // A block node inside inlines never happens in a real tree.
            _ => {}
        }
        // A `(` opening the next node is dangerous only right after a span's `]`.
        danger = matches!(n, Node::Span { .. });
    }
    s
}

fn span_open(name: &str, attrs: &Attrs) -> String {
    let mut s = format!("[{name}");
    // The BBCode default-parameter idiom: an attr keyed by the span's own name
    // spells as `[name=value ...]`.
    if let Some(v) = attrs.get(name) {
        s.push('=');
        s.push_str(&attr_value(v));
    }
    for (k, v) in attrs {
        if k == name {
            continue;
        }
        s.push_str(&format!(" {k}={}", attr_value(v)));
    }
    s.push(']');
    s
}

/// A bare value carries verbatim; anything that would break the lexer (spaces,
/// quotes, emptiness, or a `:::` that could clip a directive line) is quoted.
fn attr_value(v: &str) -> String {
    let needs_quote =
        v.is_empty() || v.contains([' ', '\t', '"']) || v.contains(":::");
    if needs_quote {
        format!("\"{}\"", v.replace('\\', "\\\\").replace('"', "\\\""))
    } else {
        v.to_string()
    }
}

/// Text nodes: escape every character the inline pass reacts to, so the bytes
/// come back as literal content. `]` is escaped too - the bracket scanner skips
/// an escaped bracket, so it never clips link/span text.
fn escape_text(s: &str, lead_paren: bool) -> String {
    let ch: Vec<char> = s.chars().collect();
    let mut out = String::new();
    let mut i = 0;
    while i < ch.len() {
        let c = ch[i];
        match c {
            // A `(` opening the text, when it sits right after a span's `]`,
            // would form a `](` link opener; escape it. Interior `(` is inert.
            '(' if i == 0 && lead_paren => {
                out.push('\\');
                out.push('(');
                i += 1;
            }
            '\\' | '*' | '~' | '`' | '[' | ']' => {
                out.push('\\');
                out.push(c);
                i += 1;
            }
            ':' => {
                // A `:` before a slug char could open an emoji `:slug:` - either
                // closed inside this text, or closed by a following `:`-opening
                // sibling (`:no` + emoji `:smile:` would fuse). Escaping every
                // such colon means no unescaped `:` in text ever starts a scan.
                if ch.get(i + 1).is_some_and(|&c| is_slug_char(c)) {
                    out.push('\\');
                }
                out.push(':');
                i += 1;
            }
            '!' => {
                // A trailing `!` would fuse with a following `[`-opener from the
                // next sibling (a link) into an `![` embed marker. A mid-text
                // `!` is safe: any `[` after it in this text is itself escaped.
                if i + 1 == ch.len() {
                    out.push('\\');
                }
                out.push('!');
                i += 1;
            }
            _ => {
                out.push(c);
                i += 1;
            }
        }
    }
    out
}

/// An embed's alt is a plain string put through `resolve_escapes` at parse:
/// only the bracket-scanner characters need escaping.
fn escape_alt(s: &str) -> String {
    let mut out = String::new();
    for c in s.chars() {
        if matches!(c, '\\' | '[' | ']') {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

fn code_span(text: &str) -> String {
    // The closer matches a run of EXACTLY n backticks, so any run length absent
    // from the interior is a safe delimiter - pick the smallest. (`longest + 1`
    // would over-expand `` ` `` into ``` ``` ``` and collide with a block fence
    // when the span opens a line.) A parser-produced span never edges on a
    // backtick, so the delimiter can't merge into the content.
    let mut present = std::collections::HashSet::new();
    let mut run = 0usize;
    for c in text.chars() {
        if c == '`' {
            run += 1;
        } else {
            if run > 0 {
                present.insert(run);
            }
            run = 0;
        }
    }
    if run > 0 {
        present.insert(run);
    }
    let mut n = 1usize;
    while present.contains(&n) {
        n += 1;
    }
    let ticks = "`".repeat(n);
    format!("{ticks}{text}{ticks}")
}

fn is_slug_char(c: char) -> bool {
    c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '_' | '+' | '-')
}

#[cfg(test)]
mod tests {
    use super::serialize;
    use crate::parse;

    /// The core property, spot-checked: whatever a source parses to, the
    /// serialized form of that tree parses to the very same tree.
    fn round_trips(src: &str) {
        let tree = parse(src).expect("parse");
        let reparsed = parse(&serialize(&tree)).expect("reparse");
        assert_eq!(reparsed, tree, "round trip diverged for {src:?}");
    }

    /// A canonical spelling is one exact string; assert we emit it (and that it
    /// still round-trips). These pin the formatter's choices, not just parity.
    fn canonical(src: &str, expected: &str) {
        let tree = parse(src).expect("parse");
        assert_eq!(serialize(&tree), expected, "spelling for {src:?}");
        round_trips(src);
    }

    #[test]
    fn prose_core_spellings() {
        canonical("# hi\n", "# hi\n");
        canonical("*a* **b** ~~c~~\n", "*a* **b** ~~c~~\n");
        canonical("a\n\nb\n", "a\n\nb\n");
        canonical("> quote\n", "> quote\n");
        canonical("- one\n- two\n", "- one\n- two\n");
        canonical("1. a\n2. b\n", "1. a\n1. b\n"); // ordinal isn't in the AST
        canonical("---\n", "---\n");
        canonical("[t](u)\n", "[t](u)\n");
        canonical("![alt](u)\n", "![alt](u)\n");
        canonical(":sparkles:\n", ":sparkles:\n");
        canonical("%% note\n", "%% note\n");
    }

    #[test]
    fn directives_and_spans() {
        canonical(":::x:::\n", ":::x:::\n"); // empty leaf, no attrs
        canonical(":::x k=v\n:::\n", ":::x k=v\n:::\n"); // attrs -> open/close
        canonical("[color=red]hot[/color]\n", "[color=red]hot[/color]\n");
        round_trips(":::page\n:::section\nhi\n:::\n:::\n");
    }

    #[test]
    fn code_span_delimiter_is_smallest_absent_run() {
        // Content holds a run of two backticks; a single backtick never appears
        // inside, so one backtick is the canonical delimiter (not `longest + 1`).
        canonical("`a``b`\n", "`a``b`\n");
        round_trips("``a`b``\n"); // interior single backtick -> two-tick delims
    }

    #[test]
    fn escapes_found_by_fuzzing() {
        // A `!` before a following link would fuse into an embed marker.
        round_trips("a![t](u)\n");
        // An escaped colon leaves `:no` text that must not fuse with an emoji.
        round_trips("word\\:no:smile:\n");
        // A span whose content opens with `(` must escape it (`](` is a link).
        round_trips("[color=red]\\(hi[/color]\n");
        // A leading `#!marquee 0` paragraph must not become a version shebang.
        round_trips("\n#!marquee 0\n");
        // A code block info that opens with a backtick (source had spaces).
        round_trips("```   ``info\ncode\n```\n");
    }
}
