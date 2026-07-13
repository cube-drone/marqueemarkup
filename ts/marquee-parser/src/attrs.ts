// The attribute grammar (SPEC.md, "The attribute grammar"). Shared by
// directive open lines and span openers; only the failure mode differs
// (blocks get invalid_directive nodes, spans fall back to literal text).

import type { Attrs, Reason } from "./ast.ts";

export const MAX_ATTR_VALUE_BYTES = 2048;

const encoder = new TextEncoder();

/** Caps are byte counts (SPEC.md): measure UTF-8, not UTF-16 units. */
export function utf8Len(s: string): number {
  return encoder.encode(s).length;
}

export function isName(s: string): boolean {
  return /^[a-z][a-z0-9_-]*$/.test(s);
}

/** Length of the leading name in `s`, or 0. (Names are ASCII, so this
 * length is the same in UTF-16 units and bytes.) */
export function nameLen(s: string): number {
  const m = /^[a-z][a-z0-9_-]*/.exec(s);
  return m ? m[0].length : 0;
}

export type ValueResult =
  | { ok: true; value: string; rest: string }
  | { ok: false; reason: Reason };

export type AttrsResult = { ok: true; attrs: Attrs } | { ok: false; reason: Reason };

/**
 * Parse a whitespace-separated `key=value` list. Duplicate keys resolve
 * first-writer-wins. Any deviation from the grammar is an error.
 */
export function parseAttrs(src: string): AttrsResult {
  // A Map sidesteps object-prototype traps (`__proto__` is a legal key);
  // Object.fromEntries defines own properties, so the traps stay closed.
  const attrs = new Map<string, string>();
  let rest = src;
  for (;;) {
    rest = rest.replace(/^[ \t]+/, "");
    if (rest === "") {
      return { ok: true, attrs: Object.fromEntries(attrs) };
    }
    const klen = nameLen(rest);
    if (klen === 0) {
      return { ok: false, reason: "bad_attribute" };
    }
    const key = rest.slice(0, klen);
    rest = rest.slice(klen);
    if (!rest.startsWith("=")) {
      return { ok: false, reason: "bad_attribute" };
    }
    const v = parseValue(rest.slice(1));
    if (!v.ok) {
      return { ok: false, reason: v.reason };
    }
    rest = v.rest;
    // After a value: end of input or whitespace.
    if (!(rest === "" || rest.startsWith(" ") || rest.startsWith("\t"))) {
      return { ok: false, reason: "bad_attribute" };
    }
    if (!attrs.has(key)) {
      attrs.set(key, v.value);
    }
  }
}

/** Parse one attribute value at the start of `s`; returns (value, rest). */
export function parseValue(s: string): ValueResult {
  if (s.startsWith('"')) {
    let value = "";
    let i = 1;
    while (i < s.length) {
      const c = s[i]!;
      if (c === '"') {
        if (utf8Len(value) > MAX_ATTR_VALUE_BYTES) {
          return { ok: false, reason: "attribute_too_long" };
        }
        return { ok: true, value, rest: s.slice(i + 1) };
      }
      if (c === "\\") {
        const n = s[i + 1];
        if (n === '"' || n === "\\") {
          value += n;
          i += 2;
          continue;
        }
        return { ok: false, reason: "bad_attribute" };
      }
      value += c;
      i += 1;
    }
    return { ok: false, reason: "bad_attribute" }; // unterminated quote
  }
  let end = 0;
  while (end < s.length && s[end] !== " " && s[end] !== "\t" && s[end] !== '"') {
    end += 1;
  }
  if (end === 0) {
    return { ok: false, reason: "bad_attribute" }; // empty bare value
  }
  const rest = s.slice(end);
  if (rest.startsWith('"')) {
    return { ok: false, reason: "bad_attribute" }; // quote inside a bare value
  }
  const value = s.slice(0, end);
  if (utf8Len(value) > MAX_ATTR_VALUE_BYTES) {
    return { ok: false, reason: "attribute_too_long" };
  }
  return { ok: true, value, rest };
}
