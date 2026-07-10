// The behavioral suite: the spec's renderer obligations as renderer-agnostic
// checks, run over the whole vector corpus. These are the thoughtful tests
// written once - a future renderer (or the Rust port) passes these without
// matching this renderer's markup byte-for-byte.
//
// Obligations checked:
//   1. Never eat content: every text/code value in the AST appears in output.
//   2. The anti-shrug: comment content NEVER appears in output.
//   3. Fail closed, visibly: one placeholder per invalid_directive.
//   4. Escaping: author bytes cannot become markup.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Node } from "../../parser/src/index.ts";
import { escapeText, render, renderMarquee } from "../src/index.ts";

interface Collected {
  visible: string[];
  comments: string[];
  invalids: number;
}

function collect(node: Node, out: Collected): void {
  switch (node.type) {
    case "text":
      out.visible.push(node.value);
      break;
    case "code_block":
    case "code_span":
      out.visible.push(node.text);
      break;
    case "comment":
      out.comments.push(node.text);
      break;
    case "invalid_directive":
      out.invalids += 1;
      break;
    default:
      break;
  }
  if ("children" in node) {
    for (const child of node.children) {
      collect(child, out);
    }
  }
}

const vectorsDir = fileURLToPath(new URL("../../../vectors/", import.meta.url));
for (const file of readdirSync(vectorsDir).filter((f) => f.endsWith(".json")).sort()) {
  const cases = JSON.parse(readFileSync(join(vectorsDir, file), "utf8")) as Array<{
    name: string;
    ast: unknown;
  }>;
  for (const c of cases) {
    test(`obligations: ${c.name}`, () => {
      const ast = c.ast as Node;
      const html = render(ast);
      const got: Collected = { visible: [], comments: [], invalids: 0 };
      collect(ast, got);
      for (const value of got.visible) {
        if (value !== "") {
          assert.ok(
            html.includes(escapeText(value)),
            `authored content eaten: ${JSON.stringify(value)}\nhtml: ${html}`,
          );
        }
      }
      for (const value of got.comments) {
        if (value !== "") {
          assert.ok(
            !html.includes(escapeText(value)),
            `comment leaked into reader view: ${JSON.stringify(value)}`,
          );
        }
      }
      const placeholders = html.split('class="mq-invalid"').length - 1;
      assert.equal(placeholders, got.invalids, "one visible placeholder per invalid construct");
    });
  }
}

test("escaping: author bytes cannot become markup", () => {
  const source = [
    "# <script>alert(1)</script>",
    "",
    '<img onerror=x> & "quotes" &amp; entities',
    "",
    "[click](javascript:alert(1))",
    "",
    "![<b>bold alt</b>](https://e.x/pic.png)",
    "",
    "```html",
    "<script>boom</script>",
    "```",
    "",
    ':::x k="<script>injected</script>":::',
    "",
    "%% secret <script>comment</script>",
    "",
  ].join("\n");
  const html = renderMarquee(source);
  assert.ok(!html.includes("<script"), "script tag survived escaping");
  assert.ok(!html.includes('href="javascript:'), "javascript: URL became a link");
  assert.ok(!html.includes("secret"), "comment content leaked");
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), "escaped text present");
});

test("blocked links keep their children", () => {
  const html = renderMarquee("[the words](weird://scheme)\n");
  assert.ok(html.includes("the words"));
  assert.ok(!html.includes("weird://scheme"));
});

test("unknown span shrugs but children survive styled context", () => {
  const html = renderMarquee("[spiral]still here[/spiral]\n");
  assert.ok(html.includes("still here"));
  assert.ok(!html.includes("spiral"), "unknown span name should not reach output");
});
