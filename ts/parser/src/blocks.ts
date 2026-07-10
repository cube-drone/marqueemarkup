// Line-oriented block parser: a faithful port of rust/parser/src/blocks.rs.
// Where this file and that file disagree, one of them has a conformance bug.

import type { Node, Reason } from "./ast.ts";
import { isName, nameLen, parseAttrs, utf8Len } from "./attrs.ts";
import { parseInlines } from "./inlines.ts";

export const MAX_LIST_DEPTH = 8;
export const MAX_QUOTE_DEPTH = 8;
export const MAX_DIRECTIVE_DEPTH = 4;
export const MAX_TARGET_BYTES = 2048;

interface Ctx {
  dirDepth: number;
  listDepth: number;
  quoteDepth: number;
}

interface Cursor {
  lines: string[];
  pos: number;
}

function peek(cur: Cursor): string | undefined {
  return cur.lines[cur.pos];
}

export function parseBlocks(body: string): Node[] {
  const lines = body.split("\n");
  // A final newline terminates the last line rather than creating an empty
  // one (otherwise every trailing newline leaks a blank into fences).
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  const cur: Cursor = { lines, pos: 0 };
  return parseContainer(cur, { dirDepth: 0, listDepth: 0, quoteDepth: 0 }, null);
}

/**
 * Parse blocks until the container ends. `openDir` is the name of the
 * directive whose body this is (null at document level and inside
 * blockquotes / list items, which are fresh containers).
 */
function parseContainer(cur: Cursor, ctx: Ctx, openDir: string | null): Node[] {
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
      cur.pos += 1;
      const dir = classifyDirective(line);
      if (dir.kind === "close") {
        if (openDir !== null && dir.name === null) {
          return out;
        }
        if (openDir !== null && dir.name === openDir) {
          return out;
        }
        out.push(invalid(openDir !== null ? "mismatched_close" : "stray_close"));
      } else if (dir.kind === "open") {
        if (ctx.dirDepth >= MAX_DIRECTIVE_DEPTH) {
          out.push(invalid("depth_exceeded"));
          continue;
        }
        const attrs = parseAttrs(dir.attrsSrc);
        if (!attrs.ok) {
          out.push(invalid(attrs.reason));
        } else {
          const children = dir.leaf
            ? []
            : parseContainer(cur, { ...ctx, dirDepth: ctx.dirDepth + 1 }, dir.name);
          out.push({ type: "directive", name: dir.name, attrs: attrs.attrs, children });
        }
      } else {
        out.push(invalid(dir.reason));
      }
      continue;
    }

    // Comment block: consecutive `%%` lines, raw content.
    if (line.startsWith("%%")) {
      const texts: string[] = [];
      for (let l = peek(cur); l !== undefined && l.startsWith("%%"); l = peek(cur)) {
        const rest = l.slice(2);
        texts.push(rest.startsWith(" ") ? rest.slice(1) : rest);
        cur.pos += 1;
      }
      out.push({ type: "comment", text: texts.join("\n") });
      continue;
    }

    const heading = headingLine(line);
    if (heading !== null) {
      cur.pos += 1;
      out.push({
        type: "heading",
        level: heading.level,
        children: parseInlines(trimSpaceTab(heading.content)),
      });
      continue;
    }

    const fence = fenceOpen(line);
    if (fence !== null) {
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
        fence.info === null
          ? { type: "code_block", text }
          : { type: "code_block", info: fence.info, text },
      );
      continue;
    }

    if (line.startsWith(">") && ctx.quoteDepth < MAX_QUOTE_DEPTH) {
      const innerLines: string[] = [];
      for (let l = peek(cur); l !== undefined && l.startsWith(">"); l = peek(cur)) {
        const rest = l.slice(1);
        innerLines.push(rest.startsWith(" ") ? rest.slice(1) : rest);
        cur.pos += 1;
      }
      const sub: Cursor = { lines: innerLines, pos: 0 };
      out.push({
        type: "blockquote",
        children: parseContainer(sub, { ...ctx, quoteDepth: ctx.quoteDepth + 1 }, null),
      });
      continue;
    }

    if (line.replace(/[ \t]+$/, "") === "---") {
      cur.pos += 1;
      out.push({ type: "thematic_break" });
      continue;
    }

    if (ctx.listDepth < MAX_LIST_DEPTH) {
      const m = marker(line);
      if (m !== null) {
        out.push(parseList(cur, ctx, m));
        continue;
      }
    }

    // Paragraph: plain lines until blank / container end / block start.
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
        out.push({ type: "turbolink", target });
        continue;
      }
    }
    out.push({ type: "paragraph", children: parseInlines(plines.join("\n")) });
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
  if (n >= 1 && n <= 6 && line[n] === " ") {
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
function parseList(cur: Cursor, ctx: Ctx, first: Marker): Node {
  const ordered = first.ordered;
  const items: Node[] = [];
  let buf: string[] = [peek(cur)!.slice(first.contentIdx)];
  cur.pos += 1;

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
      cur.pos += 1;
      continue;
    }
    if (indentOf(line) >= 2) {
      // Content (or a deeper marker) inside the current item; strip the
      // content column. Off-grid extra spaces ride along (floor rule).
      buf.push(line.slice(2));
      cur.pos += 1;
      continue;
    }
    // Column 0 or 1 (floors to 0).
    const m = marker(line);
    if (m !== null && m.ordered === ordered) {
      items.push(finishItem(buf, ctx));
      buf = [line.slice(m.contentIdx)];
      cur.pos += 1;
      continue;
    }
    break; // column-0 block, or a kind switch
  }
  items.push(finishItem(buf, ctx));
  return { type: "list", ordered, children: items };
}

function finishItem(buf: string[], ctx: Ctx): Node {
  const sub: Cursor = { lines: buf, pos: 0 };
  return {
    type: "list_item",
    children: parseContainer(sub, { ...ctx, listDepth: ctx.listDepth + 1 }, null),
  };
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
