#!/usr/bin/env python3
"""Differential fuzzer: generate documents, parse with both reference
implementations, and demand byte-identical ASTs. "One input, one parse,
everywhere" as an executable property.

Usage:
    python3 tools/diff_fuzz.py [--n 20000] [--seed 0] [--batch 2000]

Prereqs: `cargo build --release` in rust/parser (the driver invokes
target/release/ast directly) and node on PATH (runs scripts/ast.ts).

Exit code 0 = no divergence. On divergence, prints a minimized repro and
writes the full input to tools/failures/.
"""

import argparse
import json
import pathlib
import random
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
RUST_BIN = ROOT / "rust/parser/target/release/ast"
TS_SCRIPT = ROOT / "ts/parser/scripts/ast.ts"
FAILURES = ROOT / "tools/failures"

# Grammar-shaped shrapnel: biased toward the characters where the two
# implementations could plausibly disagree.
FRAGMENTS = [
    # inline machinery
    "*", "**", "***", "~~", "~", "\\", "`", "``", "```", "[", "]", "(", ")",
    "[blink]", "[/blink]", "[color=red]", "[/color]", "[x](t)", "![a](b)",
    ":", "::", ":smile:", ":no", "=", '"', '\\"', "[/", "![",
    # block machinery
    ":::", "::: ", ":::x", ":::x:::", ":::x k=v", "::: x", "\n:::\n",
    "%%", "%% raw", "# ", "## h", "#x", "> ", ">> ", "- ", "* ", "+ ", "1. ",
    "12. ", "---", "----", "#!marquee 0\n", "#!marquee 2\n",
    "#!marquee 99999999999999999999\n",
    # targets / turbolinks
    "https://e.x/", "a://b", "Note:this", "blob:h", "../up", "k=\":::\"",
    # text, whitespace, unicode
    "a", "b", "word", " ", "  ", "\t", "\n", "\n\n", " ", "é", "𝄞",
    "中", "​", "…",
]


def load_corpus():
    corpus = []
    for path in sorted((ROOT / "vectors").glob("*.json")):
        for case in json.loads(path.read_text()):
            corpus.append(case["marquee"])
    return corpus


def gen_doc(rng, corpus):
    roll = rng.random()
    if roll < 0.45:  # fragment soup
        return "".join(rng.choice(FRAGMENTS) for _ in range(rng.randint(1, 60)))
    if roll < 0.75:  # line soup
        lines = [
            "".join(rng.choice(FRAGMENTS) for _ in range(rng.randint(0, 8)))
            for _ in range(rng.randint(1, 20))
        ]
        return "\n".join(lines) + rng.choice(["\n", ""])
    # corpus mutation
    chars = list(rng.choice(corpus))
    for _ in range(rng.randint(1, 8)):
        if not chars:
            break
        op, i = rng.randrange(3), rng.randrange(len(chars))
        if op == 0:
            del chars[i]
        elif op == 1:
            chars.insert(i, rng.choice(FRAGMENTS))
        else:
            chars[i] = rng.choice(FRAGMENTS)
    return "".join(chars)


def run_side(cmd, inputs):
    proc = subprocess.run(
        cmd, input=json.dumps(inputs), capture_output=True, text=True, cwd=ROOT
    )
    if proc.returncode != 0:
        sys.exit(f"harness process died: {cmd}\n{proc.stderr[-2000:]}")
    return json.loads(proc.stdout)


def run_both(inputs):
    rust = run_side([str(RUST_BIN)], inputs)
    ts = run_side(["node", str(TS_SCRIPT)], inputs)
    return rust, ts


def diverges(doc):
    rust, ts = run_both([doc])
    return rust[0] != ts[0]


def minimize(doc):
    # Greedy line-drop, then char-drop, keeping the divergence alive.
    lines = doc.split("\n")
    i = 0
    while i < len(lines) and len(lines) > 1:
        trial = lines[:i] + lines[i + 1 :]
        if diverges("\n".join(trial)):
            lines = trial
        else:
            i += 1
    doc = "\n".join(lines)
    i = 0
    while i < len(doc):
        trial = doc[:i] + doc[i + 1 :]
        if trial and diverges(trial):
            doc = trial
        else:
            i += 1
    return doc


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=20000)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--batch", type=int, default=2000)
    args = ap.parse_args()

    if not RUST_BIN.exists():
        sys.exit("build first: cd rust/parser && cargo build --release")

    corpus = load_corpus()
    rng = random.Random(args.seed)
    tested = 0
    failures = []

    while tested < args.n:
        batch = [gen_doc(rng, corpus) for _ in range(min(args.batch, args.n - tested))]
        rust, ts = run_both(batch)
        for doc, r, t in zip(batch, rust, ts):
            if r != t:
                failures.append((doc, r, t))
        tested += len(batch)
        print(f"  {tested}/{args.n} tested, {len(failures)} divergence(s)", flush=True)
        if failures:
            break

    if not failures:
        print(f"OK: {tested} documents, zero divergence (seed {args.seed})")
        return

    FAILURES.mkdir(exist_ok=True)
    doc, r, t = failures[0]
    small = minimize(doc)
    rust, ts = run_both([small])
    (FAILURES / "input.mq").write_text(doc)
    (FAILURES / "minimized.mq").write_text(small)
    print("DIVERGENCE (minimized):")
    print(f"  input: {small!r}")
    print(f"  rust:  {json.dumps(rust[0], sort_keys=True)[:500]}")
    print(f"  ts:    {json.dumps(ts[0], sort_keys=True)[:500]}")
    print(f"full input saved to {FAILURES}/")
    sys.exit(1)


if __name__ == "__main__":
    main()
