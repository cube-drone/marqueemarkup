// Denial-of-service regressions: author documents arrive untrusted and are
// re-parsed per keystroke, so no input may cost more than linear time. Each
// shape here was quadratic (seconds to tens of seconds at 100k chars) before
// the bracket matches were precomputed and the trailing-whitespace regexes
// became scans. The bound is generous on purpose - these parse in
// milliseconds now; the old code blew it by an order of magnitude.
// Mirror of rust/parser/tests/complexity.rs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "../src/index.ts";

const N = 100_000;
const BOUND_MS = 1000;

function rep(s: string, chars: number): string {
  return s.repeat(Math.floor(chars / s.length));
}

const SHAPES: Array<[string, string]> = [
  // Every `[` used to scan forward to its balanced `]`.
  ["unclosed brackets", rep("[", N)],
  ["nested brackets", rep("[", N / 2) + rep("]", N / 2)],
  ["unclosed embeds", rep("![", N)],
  ["unclosed closers", rep("[/", N / 2) + rep("]", N / 2)],
  ["unclosed span openers", rep('[b x="', N)],
  ["nested links", rep("[", N / 8) + "a" + rep("](x)", N / 2)],
  // Every `](` used to lex its target to the end of the container.
  ["unclosed link targets", rep("[a](", N)],
  // /[ \t]+$/ retried from every start position in a space run.
  ["paragraph trailing space", "a" + rep(" ", N) + "b"],
  ["thematic break trailing space", "---" + rep(" ", N) + "b"],
  ["fence close trailing space", "```\n```" + rep(" ", N) + "b"],
  ["fence info inner space", "```a" + rep(" ", N) + "b"],
  ["directive trailing space", ":::x" + rep(" ", N) + "b"],
  ["list item trailing space", "- a" + rep(" ", N) + "b"],
];

for (const [name, input] of SHAPES) {
  test(`linear time: ${name}`, () => {
    const start = performance.now();
    parse(input);
    const ms = performance.now() - start;
    assert.ok(ms < BOUND_MS, `${name}: ${Math.round(ms)} ms for ${input.length} chars`);
  });
}
