// parseWithPositions: the editor-tooling extra, outside the AST contract.
// Three layers of proof:
//   1. Over the WHOLE vector corpus: the positioned parse is structurally
//      identical to the plain parse (positions can never change the AST),
//      every node has a span, spans are in bounds, and children sit inside
//      their parents.
//   2. Hand cases with exact source slices, because "the span covers the
//      construct" is only checkable against real offsets.
//   3. Normalization cases: CRLF input and the shebang line both shift the
//      offset space, and the returned `source` is what offsets refer to.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, parseWithPositions, type Node, type Span } from "../src/index.ts";

function walk(node: Node, fn: (n: Node, parents: Node[]) => void, parents: Node[] = []): void {
  fn(node, parents);
  if ("children" in node) {
    for (const child of node.children) {
      walk(child, fn, [...parents, node]);
    }
  }
}

const vectorsDir = fileURLToPath(new URL("../../../vectors/", import.meta.url));

test("corpus: positions never change the parse; spans are total, bounded, nested", () => {
  for (const file of readdirSync(vectorsDir).filter((f) => f.endsWith(".json")).sort()) {
    const cases = JSON.parse(readFileSync(join(vectorsDir, file), "utf8")) as Array<{
      name: string;
      marquee: string;
    }>;
    for (const c of cases) {
      const plain = parse(c.marquee);
      const { doc, spans, source } = parseWithPositions(c.marquee);
      assert.deepStrictEqual(doc, plain, `${c.name}: positioned parse differs from plain parse`);
      walk(doc, (node, parents) => {
        const span = spans.get(node);
        assert.ok(span !== undefined, `${c.name}: node without a span: ${node.type}`);
        assert.ok(
          span.start >= 0 && span.start <= span.end && span.end <= source.length,
          `${c.name}: span out of bounds for ${node.type}: [${span.start}, ${span.end})`,
        );
        const parent = parents[parents.length - 1];
        if (parent !== undefined) {
          const pspan = spans.get(parent)!;
          assert.ok(
            span.start >= pspan.start && span.end <= pspan.end,
            `${c.name}: ${node.type} [${span.start},${span.end}) escapes ${parent.type} [${pspan.start},${pspan.end})`,
          );
        }
      });
    }
  }
});

/** The span's source text, for exact assertions. */
function sliceOf(source: string, spans: WeakMap<Node, Span>, node: Node): string {
  const span = spans.get(node)!;
  return source.slice(span.start, span.end);
}

function firstOfType(doc: Node, type: string): Node {
  let found: Node | undefined;
  walk(doc, (n) => {
    if (found === undefined && n.type === type) {
      found = n;
    }
  });
  assert.ok(found, `no ${type} node`);
  return found!;
}

test("hand spans: blocks cover marker through end", () => {
  const src = ":::section scheme=noir\nwords here\n::: section\n\n# Hi *there*\n\n> *hi*\n> there\n";
  const { doc, spans, source } = parseWithPositions(src);
  assert.equal(sliceOf(source, spans, firstOfType(doc, "directive")), ":::section scheme=noir\nwords here\n::: section");
  assert.equal(sliceOf(source, spans, firstOfType(doc, "heading")), "# Hi *there*");
  assert.equal(sliceOf(source, spans, firstOfType(doc, "emphasis")), "*there*");
  assert.equal(sliceOf(source, spans, firstOfType(doc, "blockquote")), "> *hi*\n> there");
});

test("hand spans: quote-stripped inline offsets map back to the source", () => {
  const { doc, spans, source } = parseWithPositions("> *hi*\n> there\n");
  const em = firstOfType(doc, "emphasis");
  assert.equal(sliceOf(source, spans, em), "*hi*");
  const para = firstOfType(doc, "paragraph");
  assert.equal(sliceOf(source, spans, para), "*hi*\n> there");
});

test("hand spans: inline constructs, including across soft wraps", () => {
  const src = "See [the hats](https://e.x/h(1))! and `co de` and :tophat: yes\n\n*a\nb*\n";
  const { doc, spans, source } = parseWithPositions(src);
  assert.equal(sliceOf(source, spans, firstOfType(doc, "link")), "[the hats](https://e.x/h(1))");
  assert.equal(sliceOf(source, spans, firstOfType(doc, "code_span")), "`co de`");
  assert.equal(sliceOf(source, spans, firstOfType(doc, "emoji")), ":tophat:");
  assert.equal(sliceOf(source, spans, firstOfType(doc, "emphasis")), "*a\nb*");
});

test("hand spans: spans, embeds, escapes, reverted openers", () => {
  const src = "[color=#f06]hot[/color] ![alt text](pic.jpg) a\\*b [blink]oops\n";
  const { doc, spans, source } = parseWithPositions(src);
  assert.equal(sliceOf(source, spans, firstOfType(doc, "span")), "[color=#f06]hot[/color]");
  assert.equal(sliceOf(source, spans, firstOfType(doc, "embed")), "![alt text](pic.jpg)");
  // The escaped star and the reverted unclosed opener both merge into one
  // canonical text node (value " a*b [blink]oops") whose span covers the
  // RAW source - backslash and bracket included.
  const texts: Node[] = [];
  walk(doc, (n) => {
    if (n.type === "text") {
      texts.push(n);
    }
  });
  const merged = texts.find((t) => t.type === "text" && t.value.includes("a*b"))!;
  assert.equal(merged.type === "text" && merged.value, " a*b [blink]oops");
  assert.equal(sliceOf(source, spans, merged), " a\\*b [blink]oops");
});

test("hand spans: lists, items, fences, turbolinks", () => {
  const src = "- a\n- b\n\n```js\ncode\n```\n\nhttps://e.x/hi\n";
  const { doc, spans, source } = parseWithPositions(src);
  assert.equal(sliceOf(source, spans, firstOfType(doc, "list")), "- a\n- b");
  assert.equal(sliceOf(source, spans, firstOfType(doc, "list_item")), "- a");
  assert.equal(sliceOf(source, spans, firstOfType(doc, "code_block")), "```js\ncode\n```");
  assert.equal(sliceOf(source, spans, firstOfType(doc, "turbolink")), "https://e.x/hi");
});

test("normalization: shebang and CRLF shift the offset space, source says so", () => {
  const withShebang = parseWithPositions("#!marquee 0\n# Hi\n");
  assert.equal(sliceOf(withShebang.source, withShebang.spans, firstOfType(withShebang.doc, "heading")), "# Hi");
  const crlf = parseWithPositions("# Hi\r\nyo\r\n");
  assert.equal(crlf.source, "# Hi\nyo\n", "offsets refer to the normalized source");
  assert.equal(sliceOf(crlf.source, crlf.spans, firstOfType(crlf.doc, "heading")), "# Hi");
  assert.equal(sliceOf(crlf.source, crlf.spans, firstOfType(crlf.doc, "paragraph")), "yo");
});

test("astral characters: offsets are UTF-16 code units, as JS strings are", () => {
  const src = "𝄞𝄞 *hi*\n";
  const { doc, spans, source } = parseWithPositions(src);
  const em = firstOfType(doc, "emphasis");
  assert.equal(sliceOf(source, spans, em), "*hi*");
  assert.equal(spans.get(em)!.start, 5, "two astral chars = four UTF-16 units, plus the space");
});
