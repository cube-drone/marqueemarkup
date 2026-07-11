// The inline algorithm (SPEC.md, "The inline algorithm"): a faithful port of
// rust/parser/src/inlines.rs. One left-to-right pass per container; escape >
// code span > bracket > emoji > delimiter run; top-of-stack delimiter
// matching; everything unmatched reverts to literal.
//
// Works on code points (Array.from), mirroring Rust's Vec<char>, so the two
// implementations scan identical units.

import type { Attrs, Node } from "./ast.ts";
import { isName, nameLen, parseAttrs, parseValue, utf8Len } from "./attrs.ts";
import { MAX_TARGET_BYTES } from "./blocks.ts";

export const MAX_INLINE_DEPTH = 16;
export const MAX_EMOJI_SLUG_BYTES = 64;

type DelimKind = "em" | "strong" | "strike";

interface Delim {
  kind: DelimKind;
  idx: number;
  raw: string;
}

interface Frame {
  /** Raw span opener text (`[color=red]`), for reverting if never closed. */
  openerRaw: string;
  name: string;
  attrs: Attrs;
  children: Node[];
  delims: Delim[];
}

function rootFrame(): Frame {
  return { openerRaw: "", name: "", attrs: {}, children: [], delims: [] };
}

const ASCII_PUNCT = new Set("!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~");

/** Grammar whitespace is ASCII only (SPEC.md, front-door normalization):
 * Unicode spaces are content, not structure. */
function isWs(c: string): boolean {
  return c === " " || c === "\t" || c === "\n";
}

function isSlugChar(c: string): boolean {
  return /^[a-z0-9_+-]$/.test(c);
}

export function parseInlines(text: string): Node[] {
  return parseInlinesAt(text, 0);
}

/** `base` is the inline depth already spent by enclosing link text: spans,
 * delimiters, and link nesting share the one <= 16 cap (a per-construct cap
 * would let composition multiply past it). */
function parseInlinesAt(text: string, base: number): Node[] {
  const chars = Array.from(text);
  const frames: Frame[] = [rootFrame()];
  let i = 0;

  while (i < chars.length) {
    const c = chars[i]!;
    if (c === "\\") {
      const n = chars[i + 1];
      if (n === "\n") {
        top(frames).children.push({ type: "hard_break" });
        i += 2;
      } else if (n !== undefined && ASCII_PUNCT.has(n)) {
        pushStr(frames, n);
        i += 2;
      } else {
        pushStr(frames, "\\");
        i += 1;
      }
    } else if (c === "`") {
      const n = runLen(chars, i, "`");
      const k = findBacktickCloser(chars, i + n, n);
      if (k !== null) {
        top(frames).children.push({ type: "code_span", text: chars.slice(i + n, k).join("") });
        i = k + n;
      } else {
        pushStr(frames, "`".repeat(n));
        i += n;
      }
    } else if (c === "[") {
      i = bracket(chars, i, false, frames, base);
    } else if (c === "!" && chars[i + 1] === "[") {
      i = bracket(chars, i + 1, true, frames, base);
    } else if (c === ":") {
      let k = i + 1;
      while (k < chars.length && isSlugChar(chars[k]!)) {
        k += 1;
      }
      const slugLen = k - (i + 1);
      if (slugLen >= 1 && slugLen <= MAX_EMOJI_SLUG_BYTES && chars[k] === ":") {
        top(frames).children.push({ type: "emoji", slug: chars.slice(i + 1, k).join("") });
        i = k + 1;
      } else {
        pushStr(frames, ":");
        i += 1;
      }
    } else if (c === "*") {
      const n = runLen(chars, i, "*");
      if (n === 1) {
        i = delimiter(chars, i, n, "em", "*", frames, base);
      } else if (n === 2) {
        i = delimiter(chars, i, n, "strong", "**", frames, base);
      } else {
        pushStr(frames, "*".repeat(n));
        i += n;
      }
    } else if (c === "~") {
      const n = runLen(chars, i, "~");
      if (n === 2) {
        i = delimiter(chars, i, n, "strike", "~~", frames, base);
      } else {
        pushStr(frames, "~".repeat(n));
        i += n;
      }
    } else {
      pushStr(frames, c);
      i += 1;
    }
  }

  // Container end: unclosed spans and delimiters revert to literal text.
  while (frames.length > 1) {
    const frame = frames.pop()!;
    top(frames).children.push(...revertFrame(frame));
  }
  const root = frames.pop()!;
  return normalize(revertDelims(root.children, root.delims));
}

function top(frames: Frame[]): Frame {
  return frames[frames.length - 1]!;
}

function pushStr(frames: Frame[], s: string): void {
  const frame = top(frames);
  // An open delimiter sits (invisibly, until it closes) at its recorded
  // index: text on its far side must not merge into text before it.
  const barrier = frame.delims.length > 0 ? frame.delims[frame.delims.length - 1]!.idx : 0;
  const children = frame.children;
  if (children.length > barrier) {
    const last = children[children.length - 1]!;
    if (last.type === "text") {
      last.value += s;
      return;
    }
  }
  children.push({ type: "text", value: s });
}

function runLen(chars: string[], i: number, c: string): number {
  let n = 0;
  while (i + n < chars.length && chars[i + n] === c) {
    n += 1;
  }
  return n;
}

function findBacktickCloser(chars: string[], from: number, n: number): number | null {
  let k = from;
  while (k < chars.length) {
    if (chars[k] === "`") {
      const m = runLen(chars, k, "`");
      if (m === n) {
        return k;
      }
      k += m;
    } else {
      k += 1;
    }
  }
  return null;
}

function totalDepth(frames: Frame[]): number {
  let depth = frames.length - 1;
  for (const f of frames) {
    depth += f.delims.length;
  }
  return depth;
}

function delimiter(
  chars: string[],
  i: number,
  n: number,
  kind: DelimKind,
  raw: string,
  frames: Frame[],
  base: number,
): number {
  const canClose = i > 0 && !isWs(chars[i - 1]!);
  const next = chars[i + n];
  const canOpen = next !== undefined && !isWs(next);
  const deep = base + totalDepth(frames) >= MAX_INLINE_DEPTH;
  const frame = top(frames);
  const innermost = frame.delims[frame.delims.length - 1];
  if (canClose && innermost !== undefined && innermost.kind === kind) {
    frame.delims.pop();
    const inner = normalize(frame.children.splice(innermost.idx));
    frame.children.push(
      kind === "em"
        ? { type: "emphasis", children: inner }
        : kind === "strong"
          ? { type: "strong", children: inner }
          : { type: "strikethrough", children: inner },
    );
  } else if (canOpen && !deep) {
    frame.delims.push({ kind, idx: frame.children.length, raw });
  } else {
    pushStr(frames, raw);
  }
  return i + n;
}

/** Handle a bracket construct starting at `chars[open]` (which is `[`).
 * `embed` means a `!` sits just before it. Returns the new position. */
function bracket(
  chars: string[],
  open: number,
  embed: boolean,
  frames: Frame[],
  base: number,
): number {
  const bang = embed ? open - 1 : open;
  const fallback = (): number => {
    pushStr(frames, chars[bang]!);
    return bang + 1;
  };

  // Find the matching `]` (balanced, escape-aware).
  let depth = 1;
  let k = open + 1;
  while (k < chars.length) {
    const c = chars[k]!;
    if (c === "\\") {
      k += 1;
    } else if (c === "[") {
      depth += 1;
    } else if (c === "]") {
      depth -= 1;
      if (depth === 0) {
        break;
      }
    }
    k += 1;
  }
  if (k >= chars.length) {
    return fallback();
  }
  const interior = chars.slice(open + 1, k).join("");

  // Link / embed: `](` with a lexable target.
  if (chars[k + 1] === "(") {
    // A link's text is one nesting level (embeds don't recurse: alt is a
    // plain string). Over the shared inline cap, fall back to literal.
    if (!embed && base + totalDepth(frames) >= MAX_INLINE_DEPTH) {
      return fallback();
    }
    const lexed = lexTarget(chars, k + 2);
    if (lexed !== null) {
      const depth = base + totalDepth(frames) + 1;
      top(frames).children.push(
        embed
          ? { type: "embed", target: lexed.target, alt: resolveEscapes(interior) }
          : { type: "link", target: lexed.target, children: parseInlinesAt(interior, depth) },
      );
      return lexed.end;
    }
    return fallback();
  }

  // Span closer: `[/name]` must name the innermost open span.
  if (interior.startsWith("/")) {
    const name = interior.slice(1);
    if (isName(name)) {
      if (embed) {
        pushStr(frames, "!"); // the ! belongs to links/embeds, not spans
      }
      if (frames.length > 1 && top(frames).name === name) {
        const frame = frames.pop()!;
        const children = normalize(revertDelims(frame.children, frame.delims));
        top(frames).children.push({ type: "span", name: frame.name, attrs: frame.attrs, children });
      } else {
        // Well-formed but mismatched or orphan: the characters back.
        pushStr(frames, `[/${name}]`);
      }
      return k + 1;
    }
    return fallback();
  }

  // Span opener: `[name ...]`, with the BBCode default-parameter idiom
  // (`[color=red]` puts `color=red` in the span's own attrs).
  const opener = parseSpanOpener(interior);
  if (opener !== null) {
    if (embed) {
      pushStr(frames, "!"); // the ! belongs to links/embeds, not spans
    }
    if (base + totalDepth(frames) >= MAX_INLINE_DEPTH) {
      pushStr(frames, chars.slice(open, k + 1).join(""));
    } else {
      frames.push({
        openerRaw: chars.slice(open, k + 1).join(""),
        name: opener.name,
        attrs: opener.attrs,
        children: [],
        delims: [],
      });
    }
    return k + 1;
  }

  return fallback();
}

function parseSpanOpener(interior: string): { name: string; attrs: Attrs } | null {
  const nlen = nameLen(interior);
  if (nlen === 0) {
    return null;
  }
  const name = interior.slice(0, nlen);
  const pairs = new Map<string, string>();
  let rest = interior.slice(nlen);
  if (rest.startsWith("=")) {
    const v = parseValue(rest.slice(1));
    if (!v.ok) {
      return null;
    }
    if (!(v.rest === "" || v.rest.startsWith(" ") || v.rest.startsWith("\t"))) {
      return null;
    }
    pairs.set(name, v.value);
    rest = v.rest;
  } else if (!(rest === "" || rest.startsWith(" ") || rest.startsWith("\t"))) {
    return null;
  }
  const parsed = parseAttrs(rest);
  if (!parsed.ok) {
    return null;
  }
  for (const [key, value] of Object.entries(parsed.attrs)) {
    if (!pairs.has(key)) {
      pairs.set(key, value);
    }
  }
  return { name, attrs: Object.fromEntries(pairs) };
}

/** Lex a link/embed target from `chars[from]`: no whitespace, balanced
 * parens, an unbalanced `)` ends it. Returns the position after `)`. */
function lexTarget(chars: string[], from: number): { target: string; end: number } | null {
  let depth = 0;
  let k = from;
  while (k < chars.length) {
    const c = chars[k]!;
    if (c === ")" && depth === 0) {
      const target = chars.slice(from, k).join("");
      if (utf8Len(target) > MAX_TARGET_BYTES) {
        return null;
      }
      return { target, end: k + 1 };
    }
    if (c === ")") {
      depth -= 1;
    } else if (c === "(") {
      depth += 1;
    } else if (isWs(c)) {
      return null;
    }
    k += 1;
  }
  return null;
}

function resolveEscapes(s: string): string {
  let out = "";
  const chars = Array.from(s);
  let i = 0;
  while (i < chars.length) {
    const c = chars[i]!;
    if (c === "\\") {
      const n = chars[i + 1];
      if (n !== undefined && ASCII_PUNCT.has(n)) {
        out += n;
        i += 2;
        continue;
      }
      out += "\\";
      if (n !== undefined) {
        out += n;
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/** An unclosed span reverts: its opener text, then its children, flattened
 * into the parent (its own unmatched delimiters reverting first). */
function revertFrame(frame: Frame): Node[] {
  const out: Node[] = [{ type: "text", value: frame.openerRaw }];
  out.push(...revertDelims(frame.children, frame.delims));
  return out;
}

function revertDelims(children: Node[], delims: Delim[]): Node[] {
  for (let d = delims.length - 1; d >= 0; d -= 1) {
    children.splice(delims[d]!.idx, 0, { type: "text", value: delims[d]!.raw });
  }
  return children;
}

/** Canonical text: adjacent literals merge, empty text nodes vanish. */
function normalize(children: Node[]): Node[] {
  const out: Node[] = [];
  for (const node of children) {
    if (node.type === "text") {
      if (node.value === "") {
        continue;
      }
      const last = out[out.length - 1];
      if (last !== undefined && last.type === "text") {
        last.value += node.value;
        continue;
      }
    }
    out.push(node);
  }
  return out;
}
