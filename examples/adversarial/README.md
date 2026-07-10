# Adversarial examples

Torture documents: inputs chosen to be confusing, near-miss, or hostile, where the *interesting*
output is the degradation. The friendly examples one directory up prove the language is pleasant
to write; these prove that confusing input degrades **deterministically and legibly** - total
prose, strict constructs, nothing eaten.

They live in their own directory because, unlike the friendly examples, several deliberately
contain malformed constructs (`invalid_directive` nodes are the *expected* output), so the
examples-parse-clean test excludes them. They are blessed into `vectors/adversarial.json` the
same way as everything else, which makes every case here a cross-implementation differential
test.

| file | torments |
|---|---|
| `delimiter-soup.mq` | wrong-kind closers, 3+ runs, intraword stars, code spans guarding stars, span-boundary non-crossing, escaped delimiters, trailing lone backslash |
| `fence-fakeout.mq` | directives/lists/comments as fence *content*, four-backtick fences quoting three, close lines with trailing spaces, an unclosed fence auto-closing at EOF |
| `directive-maze.mq` | every `invalid_directive` reason on display: mismatched/stray closes, bad names, unterminated quotes, empty bare values, depth 5, plus `__proto__`/`constructor` as ordinary attr keys |
| `bracket-bedlam.mq` | balanced/unbalanced paren targets, whitespace-killed links, escaped brackets in alt text, orphan/mismatched span closers, the `[color=]` near-miss, emoji edge cases, six turbolink candidates (two qualify) |
| `list-labyrinth.mq` | floor-rule indents (1 and 3 spaces), kind switches, visible numbering restarts, fenced code inside items, lists inside blockquotes, dash lines that aren't markers, thematic-break impostors |
