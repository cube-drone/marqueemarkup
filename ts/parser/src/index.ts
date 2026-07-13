// Reference parser for the Marquee markup language (TypeScript).
//
// Parse is total: any byte sequence yields a document. The one refusal is an
// unknown dialect version (SPEC.md, "Conformance"), surfaced as a thrown
// error rather than a guessed parse.

import { parseBlocks, type PosTracker, type Span } from "./blocks.ts";
import type { Node } from "./ast.ts";

export type { Attrs, Node, Reason } from "./ast.ts";
export type { Span } from "./blocks.ts";

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

/** parse() plus source positions - the editor-tooling extra, deliberately
 * OUTSIDE the AST wire contract (SPEC.md, "Source positions"):
 *
 * - `doc` is byte-identical to what parse() returns: nodes carry no
 *   position fields, so serialization, vectors, and goldens are untouched.
 * - `spans` maps each node object to its [start, end) source extent, in
 *   UTF-16 code units (what JavaScript strings and CodeMirror speak) over
 *   `source` - the front-door-NORMALIZED input (\r\n -> \n; the shebang
 *   line, when present, is included in the offset space).
 * - Node-level extents are the guarantee (a span covers its opener through
 *   its closer); the interiors of canonicalized text (merged literals,
 *   resolved escapes) are covered but not subdivided.
 */
export function parseWithPositions(input: string): {
  doc: Node;
  spans: WeakMap<Node, Span>;
  source: string;
} {
  const normalized = input.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const [version, body] = stripVersion(normalized);
  if (version !== 0) {
    throw new UnsupportedVersionError(version);
  }
  const tracker: PosTracker = { spans: new WeakMap() };
  const doc: Node = {
    type: "document",
    version,
    children: parseBlocks(body, tracker, normalized.length - body.length),
  };
  tracker.spans.set(doc, { start: 0, end: normalized.length });
  return { doc, spans: tracker.spans, source: normalized };
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
