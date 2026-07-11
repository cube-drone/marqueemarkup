//! Line-oriented block parser. Bracket-LIFO directives, no per-element
//! implicit-close rules: recovery is trivial to specify and trivial to match.

use crate::ast::{Node, Reason};
use crate::attrs::{is_name, name_len, parse_attrs};
use crate::inlines::parse_inlines;

pub const MAX_LIST_DEPTH: usize = 16;
pub const MAX_QUOTE_DEPTH: usize = 16;
pub const MAX_DIRECTIVE_DEPTH: usize = 8;
pub const MAX_TARGET_BYTES: usize = 4096;

#[derive(Clone, Copy, Default)]
struct Ctx {
    dir_depth: usize,
    list_depth: usize,
    quote_depth: usize,
}

struct Cursor<'a> {
    lines: Vec<&'a str>,
    pos: usize,
}

impl<'a> Cursor<'a> {
    fn peek(&self) -> Option<&'a str> {
        self.lines.get(self.pos).copied()
    }
}

pub fn parse_blocks(body: &str) -> Vec<Node> {
    let mut lines: Vec<&str> = body.split('\n').collect();
    // A final newline terminates the last line rather than creating an empty
    // one (otherwise every trailing newline leaks a blank into fences).
    if lines.last() == Some(&"") {
        lines.pop();
    }
    let mut cur = Cursor { lines, pos: 0 };
    parse_container(&mut cur, Ctx::default(), None)
}

/// Parse blocks until the container ends. `open_dir` is the name of the
/// directive whose body this is (None at document level and inside
/// blockquotes / list items, which are fresh containers).
fn parse_container(cur: &mut Cursor, ctx: Ctx, open_dir: Option<&str>) -> Vec<Node> {
    let mut out: Vec<Node> = Vec::new();
    while let Some(line) = cur.peek() {
        if is_blank(line) {
            cur.pos += 1;
            continue;
        }

        // Directive open / close / error lines.
        if line.starts_with(":::") {
            cur.pos += 1;
            match classify_directive(line) {
                DirLine::Close(name) => match (open_dir, name) {
                    (Some(_), None) => return out,
                    (Some(open), Some(n)) if n == open => return out,
                    (Some(_), Some(_)) => out.push(invalid(Reason::MismatchedClose)),
                    (None, _) => out.push(invalid(Reason::StrayClose)),
                },
                DirLine::Open { name, attrs_src, leaf } => {
                    if ctx.dir_depth >= MAX_DIRECTIVE_DEPTH {
                        out.push(invalid(Reason::DepthExceeded));
                        continue;
                    }
                    match parse_attrs(&attrs_src) {
                        Err(reason) => out.push(invalid(reason)),
                        Ok(attrs) => {
                            let children = if leaf {
                                Vec::new()
                            } else {
                                let mut inner = ctx;
                                inner.dir_depth += 1;
                                parse_container(cur, inner, Some(&name))
                            };
                            out.push(Node::Directive { name, attrs, children });
                        }
                    }
                }
                DirLine::Bad(reason) => out.push(invalid(reason)),
            }
            continue;
        }

        // Comment block: consecutive `%%` lines, raw content.
        if line.starts_with("%%") {
            let mut texts: Vec<&str> = Vec::new();
            while let Some(l) = cur.peek() {
                match l.strip_prefix("%%") {
                    Some(rest) => {
                        texts.push(rest.strip_prefix(' ').unwrap_or(rest));
                        cur.pos += 1;
                    }
                    None => break,
                }
            }
            out.push(Node::Comment { text: texts.join("\n") });
            continue;
        }

        if let Some((level, content)) = heading_line(line) {
            cur.pos += 1;
            out.push(Node::Heading {
                level,
                children: parse_inlines(content.trim_matches([' ', '\t'])),
            });
            continue;
        }

        if let Some((fence_len, info)) = fence_open(line) {
            cur.pos += 1;
            let mut content: Vec<&str> = Vec::new();
            while let Some(l) = cur.peek() {
                cur.pos += 1;
                if fence_close(l, fence_len) {
                    break;
                }
                content.push(l);
            }
            out.push(Node::CodeBlock { info, text: content.join("\n") });
            continue;
        }

        if line.starts_with('>') && ctx.quote_depth < MAX_QUOTE_DEPTH {
            let mut inner_lines: Vec<&str> = Vec::new();
            while let Some(l) = cur.peek() {
                match l.strip_prefix('>') {
                    Some(rest) => {
                        inner_lines.push(rest.strip_prefix(' ').unwrap_or(rest));
                        cur.pos += 1;
                    }
                    None => break,
                }
            }
            let mut inner_ctx = ctx;
            inner_ctx.quote_depth += 1;
            let mut sub = Cursor { lines: inner_lines, pos: 0 };
            out.push(Node::Blockquote {
                children: parse_container(&mut sub, inner_ctx, None),
            });
            continue;
        }

        if line.trim_end_matches([' ', '\t']) == "---" {
            cur.pos += 1;
            out.push(Node::ThematicBreak);
            continue;
        }

        if ctx.list_depth < MAX_LIST_DEPTH {
            if let Some(m) = marker(line) {
                out.push(parse_list(cur, ctx, m));
                continue;
            }
        }

        // Paragraph: plain lines until blank / container end / block start.
        let mut plines = vec![line];
        cur.pos += 1;
        while let Some(l) = cur.peek() {
            if is_blank(l) || is_block_start(l, ctx) {
                break;
            }
            plines.push(l);
            cur.pos += 1;
        }
        if plines.len() == 1 {
            if let Some(target) = turbolink(plines[0]) {
                out.push(Node::Turbolink { target: target.to_string() });
                continue;
            }
        }
        out.push(Node::Paragraph {
            children: parse_inlines(&plines.join("\n")),
        });
    }
    out
}

fn invalid(reason: Reason) -> Node {
    Node::InvalidDirective { reason, children: Vec::new() }
}

fn is_blank(line: &str) -> bool {
    line.bytes().all(|b| b == b' ' || b == b'\t')
}

fn indent_of(line: &str) -> usize {
    line.bytes().take_while(|b| *b == b' ').count()
}

/// Would this line start a non-paragraph block in this context? (Used both
/// by the dispatcher and to end paragraphs: any block construct interrupts.)
fn is_block_start(line: &str, ctx: Ctx) -> bool {
    line.starts_with(":::")
        || line.starts_with("%%")
        || heading_line(line).is_some()
        || fence_open(line).is_some()
        || (line.starts_with('>') && ctx.quote_depth < MAX_QUOTE_DEPTH)
        || line.trim_end_matches([' ', '\t']) == "---"
        || (ctx.list_depth < MAX_LIST_DEPTH && marker(line).is_some())
}

fn heading_line(line: &str) -> Option<(u8, &str)> {
    let n = line.bytes().take_while(|b| *b == b'#').count();
    if (1..=8).contains(&n) && line.as_bytes().get(n) == Some(&b' ') {
        Some((n as u8, &line[n + 1..]))
    } else {
        None
    }
}

fn fence_open(line: &str) -> Option<(usize, Option<String>)> {
    let n = line.bytes().take_while(|b| *b == b'`').count();
    if n < 3 {
        return None;
    }
    let info = line[n..].trim_matches([' ', '\t']);
    Some((n, (!info.is_empty()).then(|| info.to_string())))
}

fn fence_close(line: &str, open_len: usize) -> bool {
    let t = line.trim_end_matches([' ', '\t']);
    t.len() >= open_len && t.bytes().all(|b| b == b'`')
}

struct Marker {
    indent: usize,
    ordered: bool,
    content_idx: usize,
}

fn marker(line: &str) -> Option<Marker> {
    let indent = indent_of(line);
    let rest = &line.as_bytes()[indent..];
    if rest.len() >= 2 && matches!(rest[0], b'-' | b'*' | b'+') && rest[1] == b' ' {
        return Some(Marker { indent, ordered: false, content_idx: indent + 2 });
    }
    let digits = rest.iter().take_while(|b| b.is_ascii_digit()).count();
    if digits > 0 && rest[digits..].starts_with(b". ") {
        return Some(Marker { indent, ordered: true, content_idx: indent + digits + 2 });
    }
    None
}

/// One list of one kind. A same-column marker of the other kind ends this
/// list (the dispatcher immediately starts the next one).
fn parse_list(cur: &mut Cursor, ctx: Ctx, first: Marker) -> Node {
    let ordered = first.ordered;
    let mut items: Vec<Node> = Vec::new();
    let mut buf: Vec<String> = vec![cur.peek().unwrap()[first.content_idx..].to_string()];
    cur.pos += 1;

    while let Some(line) = cur.peek() {
        if is_blank(line) {
            // The list continues past blanks only into indented content or a
            // same-kind column-0/1 marker; anything else ends it here.
            let mut j = cur.pos + 1;
            while j < cur.lines.len() && is_blank(cur.lines[j]) {
                j += 1;
            }
            let continues = match cur.lines.get(j) {
                None => false,
                Some(l) => {
                    indent_of(l) >= 2
                        || marker(l).is_some_and(|m| m.ordered == ordered && m.indent < 2)
                }
            };
            if !continues {
                break;
            }
            buf.push(String::new());
            cur.pos += 1;
            continue;
        }
        if indent_of(line) >= 2 {
            // Content (or a deeper marker) inside the current item; strip the
            // content column. Off-grid extra spaces ride along (floor rule).
            buf.push(line[2..].to_string());
            cur.pos += 1;
            continue;
        }
        // Column 0 or 1 (floors to 0).
        match marker(line) {
            Some(m) if m.ordered == ordered => {
                items.push(finish_item(std::mem::take(&mut buf), ctx));
                buf.push(line[m.content_idx..].to_string());
                cur.pos += 1;
            }
            _ => break, // column-0 block, or a kind switch
        }
    }
    items.push(finish_item(buf, ctx));
    Node::List { ordered, children: items }
}

fn finish_item(buf: Vec<String>, ctx: Ctx) -> Node {
    let mut inner_ctx = ctx;
    inner_ctx.list_depth += 1;
    let mut sub = Cursor {
        lines: buf.iter().map(|s| s.as_str()).collect(),
        pos: 0,
    };
    Node::ListItem {
        children: parse_container(&mut sub, inner_ctx, None),
    }
}

enum DirLine {
    Open { name: String, attrs_src: String, leaf: bool },
    Close(Option<String>),
    Bad(Reason),
}

fn classify_directive(line: &str) -> DirLine {
    let rest = line[3..].trim_end_matches([' ', '\t']);
    if rest.is_empty() {
        return DirLine::Close(None);
    }
    if rest.starts_with(' ') || rest.starts_with('\t') {
        // `::: name` - a named close.
        let name = rest.trim_matches([' ', '\t']);
        return if is_name(name) {
            DirLine::Close(Some(name.to_string()))
        } else {
            DirLine::Bad(Reason::BadName)
        };
    }
    // Open line. The leaf closer token is stripped before attribute parsing.
    let (body, leaf) = match rest.strip_suffix(":::") {
        Some(b) => (b, true),
        None => (rest, false),
    };
    let nlen = name_len(body);
    if nlen == 0 {
        return DirLine::Bad(Reason::BadName);
    }
    let after = &body[nlen..];
    if !(after.is_empty() || after.starts_with(' ') || after.starts_with('\t')) {
        return DirLine::Bad(Reason::BadName);
    }
    DirLine::Open {
        name: body[..nlen].to_string(),
        attrs_src: after.to_string(),
        leaf,
    }
}

/// A paragraph that is exactly one authority-form absolute URI is a
/// turbolink. Every bare word is a valid relative URI reference, so the
/// sugar demands `scheme://`; everything else uses `:::turbolink`.
fn turbolink(line: &str) -> Option<&str> {
    let t = line.trim_matches([' ', '\t']);
    if t.is_empty() || t.len() > MAX_TARGET_BYTES {
        return None;
    }
    if t.contains(' ') || t.contains('\t') {
        return None;
    }
    let b = t.as_bytes();
    if !b[0].is_ascii_alphabetic() {
        return None;
    }
    let scheme_len = b
        .iter()
        .take_while(|c| c.is_ascii_alphanumeric() || matches!(c, b'+' | b'-' | b'.'))
        .count();
    let after = &t[scheme_len..];
    if after.starts_with("://") && after.len() > 3 {
        Some(t)
    } else {
        None
    }
}
