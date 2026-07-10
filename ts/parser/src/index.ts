// Reference parser for the Marquee markup language (TypeScript).
//
// Parse is total: any byte sequence yields a document. The one refusal is an
// unknown dialect version (SPEC.md, "Conformance"), surfaced as a thrown
// error rather than a guessed parse.

import { parseBlocks } from "./blocks.ts";
import type { Node } from "./ast.ts";

export type { Attrs, Node, Reason } from "./ast.ts";

export class UnsupportedVersionError extends Error {
  readonly version: number;

  constructor(version: number) {
    super(`unsupported marquee version ${version}`);
    this.name = "UnsupportedVersionError";
    this.version = version;
  }
}

const U64_MAX = 2n ** 64n - 1n;

export function parse(input: string): Node {
  // Front-door normalization: \r\n and \r become \n before anything else.
  const normalized = input.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const [version, body] = stripVersion(normalized);
  if (version !== 0) {
    throw new UnsupportedVersionError(version);
  }
  return { type: "document", version, children: parseBlocks(body) };
}

/** The in-band version declaration: line 1, exactly `#!marquee <integer>`.
 * The default is version 0, forever. */
function stripVersion(s: string): [number, string] {
  const nl = s.indexOf("\n");
  const first = nl === -1 ? s : s.slice(0, nl);
  const m = /^#!marquee ([0-9]+)$/.exec(first);
  // Digits past u64 are not a version (mirrors the Rust parse failing):
  // the line is prose.
  if (m !== null && BigInt(m[1]!) <= U64_MAX) {
    const body = s.slice(first.length);
    return [Number(m[1]), body.startsWith("\n") ? body.slice(1) : body];
  }
  return [0, s];
}
