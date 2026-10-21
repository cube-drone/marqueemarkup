//! The inline algorithm (SPEC.md, "The inline algorithm"): one left-to-right
//! pass per container; escape > code span > bracket > emoji > delimiter run;
//! top-of-stack delimiter matching; everything unmatched reverts to literal.

use crate::ast::{Attrs, Node};
use crate::attrs::{name_len, parse_attrs, parse_value};
use crate::blocks::MAX_TARGET_BYTES;

pub const MAX_INLINE_DEPTH: usize = 16;
pub const MAX_EMOJI_SLUG_BYTES: usize = 64;
pub const MAX_SPAN_OPENER_BYTES: usize = 4096;

#[derive(Clone, Copy, PartialEq, Eq)]
enum DelimKind {
    Em,
    Strong,
    Strike,
}

struct Delim {
    kind: DelimKind,
    idx: usize,
    raw: &'static str,
}

struct Frame {
    /// Raw span opener text (`[color=red]`), for reverting if never closed.
    opener_raw: String,
    name: String,
    attrs: Attrs,
    children: Vec<Node>,
    delims: Vec<Delim>,
}

impl Frame {
    fn root() -> Frame {
        Frame {
            opener_raw: String::new(),
            name: String::new(),
            attrs: Attrs::new(),
            children: Vec::new(),
            delims: Vec::new(),
        }
    }
}

pub fn parse_inlines(text: &str) -> Vec<Node> {
    parse_inlines_at(text, 0)
}

/// `base` is the inline depth already spent by enclosing link text: spans,
/// delimiters, and link nesting share the one ≤ 16 cap (a per-construct cap
/// would let composition multiply past it).
fn parse_inlines_at(text: &str, base: usize) -> Vec<Node> {
    let chars: Vec<char> = text.chars().collect();
    let closes = find_closes(&chars);
    let mut frames: Vec<Frame> = vec![Frame::root()];
    let mut i = 0;

    while i < chars.len() {
        let c = chars[i];
        match c {
            '\\' => match chars.get(i + 1) {
                Some('\n') => {
                    frames.last_mut().unwrap().children.push(Node::HardBreak);
                    i += 2;
                }
                Some(&n) if n.is_ascii() && n.is_ascii_punctuation() => {
                    push_char(&mut frames, n);
                    i += 2;
                }
                _ => {
                    push_char(&mut frames, '\\');
                    i += 1;
                }
            },
            '`' => {
                let n = run_len(&chars, i, '`');
                match find_backtick_closer(&chars, i + n, n) {
                    Some(k) => {
                        let text: String = chars[i + n..k].iter().collect();
                        frames.last_mut().unwrap().children.push(Node::CodeSpan { text });
                        i = k + n;
                    }
                    None => {
                        push_str(&mut frames, &"`".repeat(n));
                        i += n;
                    }
                }
            }
            '[' => i = bracket(&chars, &closes, i, false, &mut frames, base),
            '!' if chars.get(i + 1) == Some(&'[') => {
                i = bracket(&chars, &closes, i + 1, true, &mut frames, base)
            }
            ':' => {
                let mut k = i + 1;
                while k < chars.len() && is_slug_char(chars[k]) {
                    k += 1;
                }
                let slug_len = k - (i + 1);
                if (1..=MAX_EMOJI_SLUG_BYTES).contains(&slug_len)
                    && chars.get(k) == Some(&':')
                {
                    let slug: String = chars[i + 1..k].iter().collect();
                    frames.last_mut().unwrap().children.push(Node::Emoji { slug });
                    i = k + 1;
                } else {
                    push_char(&mut frames, ':');
                    i += 1;
                }
            }
            '*' => {
                let n = run_len(&chars, i, '*');
                match n {
                    1 => i = delimiter(&chars, i, n, DelimKind::Em, "*", &mut frames, base),
                    2 => i = delimiter(&chars, i, n, DelimKind::Strong, "**", &mut frames, base),
                    _ => {
                        push_str(&mut frames, &"*".repeat(n));
                        i += n;
                    }
                }
            }
            '~' => {
                let n = run_len(&chars, i, '~');
                if n == 2 {
                    i = delimiter(&chars, i, n, DelimKind::Strike, "~~", &mut frames, base);
                } else {
                    push_str(&mut frames, &"~".repeat(n));
                    i += n;
                }
            }
            c => {
                push_char(&mut frames, c);
                i += 1;
            }
        }
    }

    // Container end: unclosed spans and delimiters revert to literal text.
    while frames.len() > 1 {
        let frame = frames.pop().unwrap();
        let flat = revert_frame(frame);
        let parent = frames.last_mut().unwrap();
        parent.children.extend(flat);
    }
    let root = frames.pop().unwrap();
    normalize(revert_delims(root.children, root.delims))
}

fn push_char(frames: &mut [Frame], c: char) {
    let mut buf = [0u8; 4];
    push_str(frames, c.encode_utf8(&mut buf));
}

fn push_str(frames: &mut [Frame], s: &str) {
    let frame = frames.last_mut().unwrap();
    // An open delimiter sits (invisibly, until it closes) at its recorded
    // index: text on its far side must not merge into text before it.
    let barrier = frame.delims.last().map_or(0, |d| d.idx);
    let children = &mut frame.children;
    if children.len() > barrier {
        if let Some(Node::Text { value }) = children.last_mut() {
            value.push_str(s);
            return;
        }
    }
    children.push(Node::Text { value: s.to_string() });
}

fn run_len(chars: &[char], i: usize, c: char) -> usize {
    chars[i..].iter().take_while(|&&x| x == c).count()
}

/// Grammar whitespace is ASCII only (SPEC.md, front-door normalization):
/// Unicode spaces are content, not structure.
fn is_ws(c: char) -> bool {
    matches!(c, ' ' | '\t' | '\n')
}

fn is_slug_char(c: char) -> bool {
    c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '_' | '+' | '-')
}

fn find_backtick_closer(chars: &[char], from: usize, n: usize) -> Option<usize> {
    let mut k = from;
    while k < chars.len() {
        if chars[k] == '`' {
            let m = run_len(chars, k, '`');
            if m == n {
                return Some(k);
            }
            k += m;
        } else {
            k += 1;
        }
    }
    None
}

fn total_depth(frames: &[Frame]) -> usize {
    frames.len() - 1 + frames.iter().map(|f| f.delims.len()).sum::<usize>()
}

fn delimiter(
    chars: &[char],
    i: usize,
    n: usize,
    kind: DelimKind,
    raw: &'static str,
    frames: &mut [Frame],
    base: usize,
) -> usize {
    let can_close = i > 0 && !is_ws(chars[i - 1]);
    let can_open = chars.get(i + n).is_some_and(|&c| !is_ws(c));
    let deep = base + total_depth(frames) >= MAX_INLINE_DEPTH;
    let frame = frames.last_mut().unwrap();
    if can_close && frame.delims.last().is_some_and(|d| d.kind == kind) {
        let delim = frame.delims.pop().unwrap();
        let inner: Vec<Node> = frame.children.drain(delim.idx..).collect();
        let inner = normalize(inner);
        frame.children.push(match kind {
            DelimKind::Em => Node::Emphasis { children: inner },
            DelimKind::Strong => Node::Strong { children: inner },
            DelimKind::Strike => Node::Strikethrough { children: inner },
        });
    } else if can_open && !deep {
        let idx = frame.children.len();
        frame.delims.push(Delim { kind, idx, raw });
    } else {
        push_str(frames, raw);
    }
    i + n
}

/// Where each `[` and `(` in a container closes (`None` if never), found
/// all at once: scanning forward from each opener in turn made `[`×n and
/// `[a](`×n quadratic.
struct Closes {
    /// Balanced and escape-aware, as a bracket's interior is.
    brackets: Vec<Option<usize>>,
    /// Balanced, no escapes, as a link target is.
    parens: Vec<Option<usize>>,
}

fn find_closes(chars: &[char]) -> Closes {
    Closes {
        brackets: match_closes(chars, '[', ']', true),
        parens: match_closes(chars, '(', ')', false),
    }
}

/// `level[k]` is the nesting depth after `chars[k]` (an escaped char leaves
/// it unchanged); the closer matching the opener at j is the first k > j
/// whose level is `level[j] - 1`, so one right-to-left sweep that remembers
/// the nearest position of each level answers every opener.
fn match_closes(chars: &[char], open: char, close: char, escapes: bool) -> Vec<Option<usize>> {
    let n = chars.len();
    let mut level = vec![0isize; n];
    let mut depth = 0isize;
    let mut k = 0;
    while k < n {
        let c = chars[k];
        if escapes && c == '\\' && k + 1 < n {
            level[k] = depth;
            k += 1;
        } else if c == open {
            depth += 1;
        } else if c == close {
            depth -= 1;
        }
        level[k] = depth;
        k += 1;
    }
    // Levels span [-n, n]: nearest[level + n + 1], so level - 1 indexes >= 0.
    let slot = |l: isize| (l + n as isize + 1) as usize;
    let mut nearest: Vec<Option<usize>> = vec![None; 2 * n + 2];
    let mut closes: Vec<Option<usize>> = vec![None; n];
    for j in (0..n).rev() {
        if chars[j] == open {
            closes[j] = nearest[slot(level[j] - 1)];
        }
        nearest[slot(level[j])] = Some(j);
    }
    closes
}

/// Handle a bracket construct starting at `chars[open]` (which is `[`).
/// `embed` means a `!` sits just before it. Returns the new position.
fn bracket(
    chars: &[char],
    closes: &Closes,
    open: usize,
    embed: bool,
    frames: &mut Vec<Frame>,
    base: usize,
) -> usize {
    let bang = if embed { open - 1 } else { open };
    let fallback = |frames: &mut Vec<Frame>| {
        push_char(frames, chars[bang]);
        bang + 1
    };

    // The matching `]` (balanced, escape-aware).
    let Some(k) = closes.brackets[open] else {
        return fallback(frames);
    };
    // Copied only once a construct is sure to want it: copying up front made
    // nested brackets (`[`×n `]`×n) quadratic.
    let interior = || -> String { chars[open + 1..k].iter().collect() };

    // Link / embed: `](` with a lexable target.
    if chars.get(k + 1) == Some(&'(') {
        // A link's text is one nesting level (embeds don't recurse: alt is
        // a plain string). Over the shared inline cap, fall back to literal.
        if !embed && base + total_depth(frames) >= MAX_INLINE_DEPTH {
            return fallback(frames);
        }
        if let Some((target, end)) = lex_target(chars, closes.parens[k + 1], k + 2) {
            let node = if embed {
                Node::Embed { target, alt: resolve_escapes(&interior()) }
            } else {
                let depth = base + total_depth(frames) + 1;
                Node::Link { target, children: parse_inlines_at(&interior(), depth) }
            };
            frames.last_mut().unwrap().children.push(node);
            return end;
        }
        return fallback(frames);
    }

    // Span closer: `[/name]` must name the innermost open span.
    if chars.get(open + 1) == Some(&'/') {
        if is_name_at(chars, open + 2, k) {
            let name: String = chars[open + 2..k].iter().collect();
            if embed {
                push_str(frames, "!"); // the ! belongs to links/embeds, not spans
            }
            if frames.len() > 1 && frames.last().unwrap().name == name {
                let frame = frames.pop().unwrap();
                let children = normalize(revert_delims(frame.children, frame.delims));
                frames.last_mut().unwrap().children.push(Node::Span {
                    name: frame.name,
                    attrs: frame.attrs,
                    children,
                });
            } else {
                // Well-formed but mismatched or orphan: the characters back.
                push_str(frames, &format!("[/{name}]"));
            }
            return k + 1;
        }
        return fallback(frames);
    }

    // Span opener: `[name ...]`, with the BBCode default-parameter idiom
    // (`[color=red]` puts `color=red` in the span's own attrs).
    let opener = if maybe_span_opener(chars, open + 1, k) {
        parse_span_opener(&interior())
    } else {
        None
    };
    if let Some((name, attrs)) = opener {
        if embed {
            push_str(frames, "!"); // the ! belongs to links/embeds, not spans
        }
        if base + total_depth(frames) >= MAX_INLINE_DEPTH {
            let raw: String = chars[open..=k].iter().collect();
            push_str(frames, &raw);
        } else {
            frames.push(Frame {
                opener_raw: chars[open..=k].iter().collect(),
                name,
                attrs,
                children: Vec::new(),
                delims: Vec::new(),
            });
        }
        return k + 1;
    }

    fallback(frames)
}

fn is_name_start(c: Option<&char>) -> bool {
    c.is_some_and(|c| c.is_ascii_lowercase())
}

fn is_name_char(c: char) -> bool {
    c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '_' | '-')
}

/// `is_name` over `chars[from..to]` in place: it stops at the first
/// non-name char, so a failed closer (`[/[/[/`...) costs no copy of its
/// interior.
fn is_name_at(chars: &[char], from: usize, to: usize) -> bool {
    from < to
        && is_name_start(chars.get(from))
        && chars[from + 1..to].iter().all(|&c| is_name_char(c))
}

/// `parse_span_opener`'s early rejections, checked in place: a name, then
/// `=`, a space or tab, or the end. Spares `[a[a[a`... a copy of each
/// interior only to fail on its second char. And the opener cap: nested
/// openers each re-parse the attribute lists inside them, so an uncapped
/// interior made `[b a=`... quadratic.
fn maybe_span_opener(chars: &[char], from: usize, to: usize) -> bool {
    if from >= to || !is_name_start(chars.get(from)) {
        return false;
    }
    let mut bytes = 0;
    for c in &chars[from..to] {
        bytes += c.len_utf8();
        if bytes > MAX_SPAN_OPENER_BYTES {
            return false;
        }
    }
    let mut k = from + 1;
    while k < to && is_name_char(chars[k]) {
        k += 1;
    }
    k == to || matches!(chars[k], '=' | ' ' | '\t')
}

fn parse_span_opener(interior: &str) -> Option<(String, Attrs)> {
    let nlen = name_len(interior);
    if nlen == 0 {
        return None;
    }
    let name = &interior[..nlen];
    let mut attrs = Attrs::new();
    let mut rest = &interior[nlen..];
    if rest.starts_with('=') {
        let (value, after) = parse_value(&rest[1..]).ok()?;
        if !(after.is_empty() || after.starts_with(' ') || after.starts_with('\t')) {
            return None;
        }
        attrs.insert(name.to_string(), value);
        rest = after;
    } else if !(rest.is_empty() || rest.starts_with(' ') || rest.starts_with('\t')) {
        return None;
    }
    for (key, value) in parse_attrs(rest).ok()? {
        attrs.entry(key).or_insert(value);
    }
    Some((name.to_string(), attrs))
}

/// Lex a link/embed target from `chars[from]`: no whitespace, balanced
/// parens, an unbalanced `)` ends it. `close` is that `)` (the match of the
/// `(` before `from`), if any. Returns (target, position after `)`).
fn lex_target(chars: &[char], close: Option<usize>, from: usize) -> Option<(String, usize)> {
    // Every char is at least a byte: a target longer than the cap in chars
    // fails without a look, so no failed target costs more than the cap.
    let close = close.filter(|&close| close - from <= MAX_TARGET_BYTES)?;
    let target = &chars[from..close];
    if target.iter().any(|&c| is_ws(c)) {
        return None;
    }
    if target.iter().map(|c| c.len_utf8()).sum::<usize>() > MAX_TARGET_BYTES {
        return None;
    }
    Some((target.iter().collect(), close + 1))
}

fn resolve_escapes(s: &str) -> String {
    let mut out = String::new();
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.next() {
                Some(n) if n.is_ascii() && n.is_ascii_punctuation() => out.push(n),
                Some(n) => {
                    out.push('\\');
                    out.push(n);
                }
                None => out.push('\\'),
            }
        } else {
            out.push(c);
        }
    }
    out
}

/// An unclosed span reverts: its opener text, then its children, flattened
/// into the parent (its own unmatched delimiters reverting first).
fn revert_frame(frame: Frame) -> Vec<Node> {
    let mut out = vec![Node::Text { value: frame.opener_raw }];
    out.extend(revert_delims(frame.children, frame.delims));
    out
}

fn revert_delims(mut children: Vec<Node>, delims: Vec<Delim>) -> Vec<Node> {
    for d in delims.into_iter().rev() {
        children.insert(d.idx, Node::Text { value: d.raw.to_string() });
    }
    children
}

/// Canonical text: adjacent literals merge, empty text nodes vanish.
fn normalize(children: Vec<Node>) -> Vec<Node> {
    let mut out: Vec<Node> = Vec::new();
    for node in children {
        match node {
            Node::Text { value } if value.is_empty() => {}
            Node::Text { value } => {
                if let Some(Node::Text { value: prev }) = out.last_mut() {
                    prev.push_str(&value);
                } else {
                    out.push(Node::Text { value });
                }
            }
            other => out.push(other),
        }
    }
    out
}
