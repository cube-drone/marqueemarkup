// Line-oriented block parser: a faithful port of rust/parser/src/blocks.rs.
// Where this file and that file disagree, one of them has a conformance bug.
//
// Positions (SPEC.md, "Source positions"): when a PosTracker rides along,
// every node gets a [start, end) span - UTF-16 offsets into the normalized
// source - recorded in the side-table. The AST itself never changes; the
// default path pays nothing.

import type { Node, Reason } from "./ast.ts";
import { isName, nameLen, parseAttrs, utf8Len } from "./attrs.ts";
import { parseInlines, type PosCtx } from "./inlines.ts";

export const MAX_LIST_DEPTH = 16;
export const MAX_QUOTE_DEPTH = 16;
export const MAX_DIRECTIVE_DEPTH = 8;
export const MAX_TARGET_BYTES = 4096;

/** A node's source extent: [start, end) in UTF-16 code units over the
 * front-door-normalized source (shebang line included in the count). */
export interface Span {
  start: number;
  end: number;
}

export interface PosTracker {
  spans: WeakMap<Node, Span>;
}

interface Ctx {
  dirDepth: number;
  listDepth: number;
  quoteDepth: number;
}

interface Cursor {
  lines: string[];
  /** Parallel to `lines`: source offset of each line's first character
   * (post any container prefix-stripping). Null when positions are off. */
  starts: number[] | null;
  pos: number;
}

function peek(cur: Cursor): string | undefined {
  return cur.lines[cur.pos];
}

export function parseBlocks(body: string, T: PosTracker | null = null, baseOffset = 0): Node[] {
  const lines = body.split("\n");
  let starts: number[] | null = null;
  if (T !== null) {
    starts = [];
    let off = baseOffset;
    for (const line of lines) {
      starts.push(off);
      off += line.length + 1;
    }
  }
  // A final newline terminates the last line rather than creating an empty
  // one (otherwise every trailing newline leaks a blank into fences).
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
    starts?.pop();
  }
  const cur: Cursor = { lines, starts, pos: 0 };
  return parseContainer(cur, { dirDepth: 0, listDepth: 0, quoteDepth: 0 }, null, T);
}

function lineStartOf(cur: Cursor, i: number): number {
  return cur.starts![i]!;
}

function lineEndOf(cur: Cursor, i: number): number {
  return cur.starts![i]! + cur.lines[i]!.length;
}

function mark(T: PosTracker | null, cur: Cursor, node: Node, startLine: number, endLine: number): Node {
  if (T !== null && cur.starts !== null) {
    T.spans.set(node, { start: lineStartOf(cur, startLine), end: lineEndOf(cur, endLine) });
  }
  return node;
}

/** Build the logical inline text (segments joined by real source newlines)
 * plus the code-point -> source-offset map the inline parser records from. */
function inlineCtx(
  T: PosTracker | null,
  segs: Array<{ text: string; start: number }>,
): { text: string; P: PosCtx | null } {
  const text = segs.map((s) => s.text).join("\n");
  if (T === null) {
    return { text, P: null };
  }
  const map: number[] = [];
  let end = 0;
  for (let s = 0; s < segs.length; s += 1) {
    if (s > 0) {
      map.push(end); // the joining "\n" is the previous line's real newline
    }
    const seg = segs[s]!;
    let off = seg.start;
    for (const ch of seg.text) {
      map.push(off);
      off += ch.length;
    }
    end = off;
  }
  map.push(end);
  return { text, P: { map, spans: T.spans } };
}

/**
 * Parse blocks until the container ends. `openDir` is the name of the
 * directive whose body this is (null at document level and inside
 * blockquotes / list items, which are fresh containers).
 */
function parseContainer(cur: Cursor, ctx: Ctx, openDir: string | null, T: PosTracker | null): Node[] {
  const out: Node[] = [];
  for (;;) {
    const line = peek(cur);
    if (line === undefined) {
      break;
    }
    if (isBlank(line)) {
      cur.pos += 1;
      continue;
    }

    // Directive open / close / error lines.
    if (line.startsWith(":::")) {
      const li = cur.pos;
      cur.pos += 1;
      const dir = classifyDirective(line);
      if (dir.kind === "close") {
        if (openDir !== null && dir.name === null) {
          return out;
        }
        if (openDir !== null && dir.name === openDir) {
          return out;
        }
        out.push(mark(T, cur, invalid(openDir !== null ? "mismatched_close" : "stray_close"), li, li));
      } else if (dir.kind === "open") {
        if (ctx.dirDepth >= MAX_DIRECTIVE_DEPTH) {
          out.push(mark(T, cur, invalid("depth_exceeded"), li, li));
          continue;
        }
        const attrs = parseAttrs(dir.attrsSrc);
        if (!attrs.ok) {
          out.push(mark(T, cur, invalid(attrs.reason), li, li));
        } else {
          const children = dir.leaf
            ? []
            : parseContainer(cur, { ...ctx, dirDepth: ctx.dirDepth + 1 }, dir.name, T);
          // A container's close line (or EOF auto-close) has been consumed
          // by the child parse: the span runs to the last consumed line.
          const endLi = dir.leaf ? li : Math.max(li, cur.pos - 1);
          out.push(
            mark(T, cur, { type: "directive", name: dir.name, attrs: attrs.attrs, children }, li, endLi),
          );
        }
      } else {
        out.push(mark(T, cur, invalid(dir.reason), li, li));
      }
      continue;
    }

    // Comment block: consecutive `%%` lines, raw content.
    if (line.startsWith("%%")) {
      const li = cur.pos;
      const texts: string[] = [];
      for (let l = peek(cur); l !== undefined && l.startsWith("%%"); l = peek(cur)) {
        const rest = l.slice(2);
        texts.push(rest.startsWith(" ") ? rest.slice(1) : rest);
        cur.pos += 1;
      }
      out.push(mark(T, cur, { type: "comment", text: texts.join("\n") }, li, cur.pos - 1));
      continue;
    }

    const heading = headingLine(line);
    if (heading !== null) {
      const li = cur.pos;
      cur.pos += 1;
      const content = trimSpaceTab(heading.content);
      let P: PosCtx | null = null;
      let text = content;
      if (T !== null && cur.starts !== null) {
        // Content offset: past the #s and their space, plus leading trim
        // (all ASCII, so char counts are UTF-16 counts).
        const lead = heading.content.length - heading.content.replace(/^[ \t]+/, "").length;
        const start = lineStartOf(cur, li) + heading.level + 1 + lead;
        const built = inlineCtx(T, [{ text: content, start }]);
        text = built.text;
        P = built.P;
      }
      out.push(
        mark(
          T,
          cur,
          { type: "heading", level: heading.level, children: parseInlines(text, P) },
          li,
          li,
        ),
      );
      continue;
    }

    const fence = fenceOpen(line);
    if (fence !== null) {
      const li = cur.pos;
      cur.pos += 1;
      const content: string[] = [];
      for (let l = peek(cur); l !== undefined; l = peek(cur)) {
        cur.pos += 1;
        if (fenceClose(l, fence.len)) {
          break;
        }
        content.push(l);
      }
      const text = content.join("\n");
      out.push(
        mark(
          T,
          cur,
          fence.info === null
            ? { type: "code_block", text }
            : { type: "code_block", info: fence.info, text },
          li,
          cur.pos - 1,
        ),
      );
      continue;
    }

    if (line.startsWith(">") && ctx.quoteDepth < MAX_QUOTE_DEPTH) {
      const li = cur.pos;
      const innerLines: string[] = [];
      const innerStarts: number[] | null = T !== null && cur.starts !== null ? [] : null;
      for (let l = peek(cur); l !== undefined && l.startsWith(">"); l = peek(cur)) {
        const rest = l.slice(1);
        const stripped = rest.startsWith(" ") ? 2 : 1;
        innerLines.push(l.slice(stripped));
        innerStarts?.push(lineStartOf(cur, cur.pos) + stripped);
        cur.pos += 1;
      }
      const sub: Cursor = { lines: innerLines, starts: innerStarts, pos: 0 };
      out.push(
        mark(
          T,
          cur,
          {
            type: "blockquote",
            children: parseContainer(sub, { ...ctx, quoteDepth: ctx.quoteDepth + 1 }, null, T),
          },
          li,
          cur.pos - 1,
        ),
      );
      continue;
    }

    if (line.replace(/[ \t]+$/, "") === "---") {
      const li = cur.pos;
      cur.pos += 1;
      out.push(mark(T, cur, { type: "thematic_break" }, li, li));
      continue;
    }

    if (ctx.listDepth < MAX_LIST_DEPTH) {
      const m = marker(line);
      if (m !== null) {
        out.push(parseList(cur, ctx, m, T));
        continue;
      }
    }

    // Paragraph: plain lines until blank / container end / block start.
    const li = cur.pos;
    const plines = [line];
    cur.pos += 1;
    for (let l = peek(cur); l !== undefined; l = peek(cur)) {
      if (isBlank(l) || isBlockStart(l, ctx)) {
        break;
      }
      plines.push(l);
      cur.pos += 1;
    }
    if (plines.length === 1) {
      const target = turbolink(plines[0]!);
      if (target !== null) {
        out.push(mark(T, cur, { type: "turbolink", target }, li, li));
        continue;
      }
    }
    let P: PosCtx | null = null;
    let text = plines.join("\n");
    if (T !== null && cur.starts !== null) {
      const segs = plines.map((t, idx) => ({ text: t, start: lineStartOf(cur, li + idx) }));
      const built = inlineCtx(T, segs);
      text = built.text;
      P = built.P;
    }
    out.push(mark(T, cur, { type: "paragraph", children: parseInlines(text, P) }, li, cur.pos - 1));
  }
  return out;
}

function invalid(reason: Reason): Node {
  return { type: "invalid_directive", reason, children: [] };
}

function isBlank(line: string): boolean {
  return /^[ \t]*$/.test(line);
}

function indentOf(line: string): number {
  let i = 0;
  while (i < line.length && line[i] === " ") {
    i += 1;
  }
  return i;
}

function trimSpaceTab(s: string): string {
  return s.replace(/^[ \t]+|[ \t]+$/g, "");
}

/** Would this line start a non-paragraph block in this context? (Used both
 * by the dispatcher and to end paragraphs: any block construct interrupts.) */
function isBlockStart(line: string, ctx: Ctx): boolean {
  return (
    line.startsWith(":::") ||
    line.startsWith("%%") ||
    headingLine(line) !== null ||
    fenceOpen(line) !== null ||
    (line.startsWith(">") && ctx.quoteDepth < MAX_QUOTE_DEPTH) ||
    line.replace(/[ \t]+$/, "") === "---" ||
    (ctx.listDepth < MAX_LIST_DEPTH && marker(line) !== null)
  );
}

function headingLine(line: string): { level: number; content: string } | null {
  let n = 0;
  while (n < line.length && line[n] === "#") {
    n += 1;
  }
  if (n >= 1 && n <= 8 && line[n] === " ") {
    return { level: n, content: line.slice(n + 1) };
  }
  return null;
}

function fenceOpen(line: string): { len: number; info: string | null } | null {
  let n = 0;
  while (n < line.length && line[n] === "`") {
    n += 1;
  }
  if (n < 3) {
    return null;
  }
  const info = trimSpaceTab(line.slice(n));
  return { len: n, info: info === "" ? null : info };
}

function fenceClose(line: string, openLen: number): boolean {
  const t = line.replace(/[ \t]+$/, "");
  return t.length >= openLen && /^`+$/.test(t);
}

interface Marker {
  indent: number;
  ordered: boolean;
  contentIdx: number;
}

function marker(line: string): Marker | null {
  const indent = indentOf(line);
  const rest = line.slice(indent);
  if (rest.length >= 2 && "-*+".includes(rest[0]!) && rest[1] === " ") {
    return { indent, ordered: false, contentIdx: indent + 2 };
  }
  const m = /^([0-9]+)\. /.exec(rest);
  if (m !== null) {
    return { indent, ordered: true, contentIdx: indent + m[1]!.length + 2 };
  }
  return null;
}

/** One list of one kind. A same-column marker of the other kind ends this
 * list (the dispatcher immediately starts the next one). */
function parseList(cur: Cursor, ctx: Ctx, first: Marker, T: PosTracker | null): Node {
  const tracking = T !== null && cur.starts !== null;
  const ordered = first.ordered;
  const items: Node[] = [];
  const listLi = cur.pos;
  let itemStart = tracking ? lineStartOf(cur, cur.pos) + first.indent : 0;
  let buf: string[] = [peek(cur)!.slice(first.contentIdx)];
  let bufStarts: number[] | null = tracking ? [lineStartOf(cur, cur.pos) + first.contentIdx] : null;
  cur.pos += 1;

  const finish = (): void => {
    items.push(finishItem(buf, bufStarts, ctx, T, itemStart));
  };

  for (;;) {
    const line = peek(cur);
    if (line === undefined) {
      break;
    }
    if (isBlank(line)) {
      // The list continues past blanks only into indented content or a
      // same-kind column-0/1 marker; anything else ends it here.
      let j = cur.pos + 1;
      while (j < cur.lines.length && isBlank(cur.lines[j]!)) {
        j += 1;
      }
      const next = cur.lines[j];
      let continues = false;
      if (next !== undefined) {
        if (indentOf(next) >= 2) {
          continues = true;
        } else {
          const m = marker(next);
          continues = m !== null && m.ordered === ordered && m.indent < 2;
        }
      }
      if (!continues) {
        break;
      }
      buf.push("");
      bufStarts?.push(tracking ? lineStartOf(cur, cur.pos) : 0);
      cur.pos += 1;
      continue;
    }
    if (indentOf(line) >= 2) {
      // Content (or a deeper marker) inside the current item; strip the
      // content column. Off-grid extra spaces ride along (floor rule).
      buf.push(line.slice(2));
      bufStarts?.push(tracking ? lineStartOf(cur, cur.pos) + 2 : 0);
      cur.pos += 1;
      continue;
    }
    // Column 0 or 1 (floors to 0).
    const m = marker(line);
    if (m !== null && m.ordered === ordered) {
      finish();
      itemStart = tracking ? lineStartOf(cur, cur.pos) + m.indent : 0;
      buf = [line.slice(m.contentIdx)];
      bufStarts = tracking ? [lineStartOf(cur, cur.pos) + m.contentIdx] : null;
      cur.pos += 1;
      continue;
    }
    break; // column-0 block, or a kind switch
  }
  finish();
  const list: Node = { type: "list", ordered, children: items };
  if (tracking) {
    T!.spans.set(list, {
      start: lineStartOf(cur, listLi) + first.indent,
      end: lineEndOf(cur, cur.pos - 1),
    });
  }
  return list;
}

function finishItem(
  buf: string[],
  bufStarts: number[] | null,
  ctx: Ctx,
  T: PosTracker | null,
  itemStart: number,
): Node {
  const sub: Cursor = { lines: buf, starts: bufStarts, pos: 0 };
  const item: Node = {
    type: "list_item",
    children: parseContainer(sub, { ...ctx, listDepth: ctx.listDepth + 1 }, null, T),
  };
  if (T !== null && bufStarts !== null) {
    let end = itemStart;
    for (let i = 0; i < buf.length; i += 1) {
      end = Math.max(end, bufStarts[i]! + buf[i]!.length);
    }
    T.spans.set(item, { start: itemStart, end });
  }
  return item;
}

type DirLine =
  | { kind: "open"; name: string; attrsSrc: string; leaf: boolean }
  | { kind: "close"; name: string | null }
  | { kind: "bad"; reason: Reason };

function classifyDirective(line: string): DirLine {
  const rest = line.slice(3).replace(/[ \t]+$/, "");
  if (rest === "") {
    return { kind: "close", name: null };
  }
  if (rest.startsWith(" ") || rest.startsWith("\t")) {
    // `::: name` - a named close.
    const name = trimSpaceTab(rest);
    return isName(name)
      ? { kind: "close", name }
      : { kind: "bad", reason: "bad_name" };
  }
  // Open line. The leaf closer token is stripped before attribute parsing.
  const leaf = rest.endsWith(":::");
  const body = leaf ? rest.slice(0, -3) : rest;
  const nlen = nameLen(body);
  if (nlen === 0) {
    return { kind: "bad", reason: "bad_name" };
  }
  const after = body.slice(nlen);
  if (!(after === "" || after.startsWith(" ") || after.startsWith("\t"))) {
    return { kind: "bad", reason: "bad_name" };
  }
  return { kind: "open", name: body.slice(0, nlen), attrsSrc: after, leaf };
}

/**
 * A paragraph that is exactly one authority-form absolute URI is a
 * turbolink. Every bare word is a valid relative URI reference, so the
 * sugar demands `scheme://`; everything else uses `:::turbolink`.
 */
function turbolink(line: string): string | null {
  const t = trimSpaceTab(line);
  if (t === "" || utf8Len(t) > MAX_TARGET_BYTES) {
    return null;
  }
  if (t.includes(" ") || t.includes("\t")) {
    return null;
  }
  const m = /^[A-Za-z][A-Za-z0-9+.-]*/.exec(t);
  if (m === null) {
    return null;
  }
  const after = t.slice(m[0].length);
  return after.startsWith("://") && after.length > 3 ? t : null;
}
