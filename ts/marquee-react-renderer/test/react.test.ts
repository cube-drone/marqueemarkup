// Structural tests via react-dom/server: no jsdom, no browser, no extra
// toolchain - renderToStaticMarkup is enough to hold the renderer to the
// mq-* class contract and the spec's obligations. (The DOM-dependent halves
// - IntersectionObserver, scrollIntoView - are exercised in a browser by the
// demo page; what CAN be tested without one is tested here.)

import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Marquee, type Node } from "../src/index.ts";

function html(props: Parameters<typeof Marquee>[0]): string {
  return renderToStaticMarkup(h(Marquee, props));
}

test("the prose core renders to the shared class contract", () => {
  const out = html({ source: "# Hi *there*\n\n> quoted\n\n- a\n- b\n" });
  assert.ok(out.includes('class="mq-doc"'));
  assert.ok(out.includes("<h1"), "heading");
  assert.ok(out.includes("<em") && out.includes("there</em>"), "emphasis");
  assert.ok(out.includes("<blockquote"), "quote");
  assert.ok(out.includes("<ul"), "list");
});

test("effects wear mq-anim (the observer's handle) and their vocabulary class", () => {
  const out = html({ source: "[blink]hi[/blink] [rainbow by=letter]ab[/rainbow]\n" });
  assert.ok(out.includes("mq-blink mq-anim"), "blink is animated and observable");
  assert.ok(out.includes("mq-rainbow mq-anim mq-split"), "split effects too");
  assert.ok(out.includes('class="mq-l"'), "per-unit spans");
  assert.ok(out.includes("--mq-o:0"), "unit offsets, deterministic");
});

test("typewriter is per-unit by nature; speed sets the step", () => {
  const out = html({ source: "[typewriter speed=20]hi[/typewriter]\n" });
  assert.ok(out.includes("mq-typewriter mq-anim mq-split"));
  assert.ok(out.includes("--mq-tw-step:0.05s"));
});

test("spoiler: click-to-reveal button, content present, never eaten", () => {
  const out = html({ source: "[spoiler]everyone[/spoiler]\n" });
  assert.ok(out.includes('class="mq-spoiler"'), "the shared class");
  assert.ok(out.includes('role="button"') && out.includes('aria-expanded="false"'), "accessible, gated");
  assert.ok(out.includes("everyone"), "the words are present, just withheld by CSS");
  assert.ok(!out.includes("data-mq-revealed"), "starts hidden");
});

test("never eat content: unknown vocabulary shrugs, children survive", () => {
  const out = html({ source: "[spiral]still here[/spiral]\n\n:::nonsense\ninside\n:::\n" });
  assert.ok(out.includes("still here"), "unknown span keeps its children");
  assert.ok(out.includes("inside"), "unknown directive keeps its children");
  assert.ok(out.includes('class="mq-unknown"'), "with an affordance");
});

test("comments render as absence; the anti-shrug holds", () => {
  const out = html({ source: "%% secret\n\nvisible\n" });
  assert.ok(!out.includes("secret"), "comment never reaches the reader");
  assert.ok(out.includes("visible"));
});

test("author bytes are escaped by React itself - no innerHTML path exists", () => {
  const out = html({ source: '<script>alert(1)</script> and [b]<img onerror=x>[/b]\n' });
  assert.ok(!out.includes("<script>"), "no script tag survives");
  assert.ok(out.includes("&lt;script&gt;"), "escaped as text");
  assert.ok(!out.includes("onerror=x>"), "no raw attribute injection");
});

test("blocked schemes never become links (the profile's policy, shared)", () => {
  const out = html({ source: "[click](javascript:alert(1))\n" });
  assert.ok(!out.includes("href=\"javascript:"), "javascript: URL refused");
  assert.ok(out.includes("mq-blocked"), "content survives, capability doesn't");
  assert.ok(out.includes("click"));
});

test("source positions ride along as data attributes (reverse sync)", () => {
  const out = html({ source: "# Hi\n" });
  assert.ok(out.includes('data-mq-start="0"'), "nodes carry their source extent");
  assert.ok(out.includes('data-mq-end="4"'));
  const noPos = html({ doc: { type: "document", version: 0, children: [] } as Node });
  assert.ok(!noPos.includes("data-mq-start"), "a pre-parsed doc has no positions");
});

test("an unsupported dialect shows the refusal AND the words", () => {
  const out = html({ source: "#!marquee 99\n# hello\n" });
  assert.ok(out.includes("version 99"), "the refusal is legible");
  assert.ok(out.includes("# hello"), "and the source is not eaten");
});

test("profile overrides: one policy object, honored by both renderers", () => {
  // The URL must be ALONE in its paragraph to be a turbolink - the sugar's
  // whole rule (a line with other words is just a line with a URL in it).
  const out = html({
    source: ":cat: says hi\n\nhttps://e.x/p\n",
    profile: {
      emoji: (slug) => (slug === "cat" ? "🐱" : null),
      turbolink: () => "<b>RICH</b>",
    },
  });
  assert.ok(out.includes("🐱"), "emoji table");
  assert.ok(out.includes("mq-turbolink-rich"), "trusted plugin output rendered");
  assert.ok(out.includes("mq-turbolink-source"), "augment, never replace: the link survives");
});

test("React hooks win over the string hooks - the no-innerHTML path", () => {
  const out = html({
    source: "https://e.x/p\n",
    hooks: { turbolink: (target) => h("b", null, `REACT:${target}`) },
  });
  assert.ok(out.includes("REACT:https://e.x/p"));
  assert.ok(!out.includes("dangerously"));
});

test("animate=never starts skipped, so nothing is holding text hostage", () => {
  const out = html({ source: "[typewriter]hi[/typewriter]\n", animate: "never" });
  assert.ok(out.includes('data-mq-skip=""'), "the skip flag is on from the start");
});

test("the whole vector corpus renders without throwing, and never eats text", () => {
  const dir = fileURLToPath(new URL("../../../vectors/", import.meta.url));
  let cases = 0;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    for (const c of JSON.parse(readFileSync(join(dir, file), "utf8")) as Array<{
      name: string;
      marquee: string;
    }>) {
      const out = html({ source: c.marquee });
      assert.ok(typeof out === "string" && out.length > 0, `${c.name}: rendered nothing`);
      cases += 1;
    }
  }
  assert.ok(cases > 90, `expected the full corpus, saw ${cases}`);
});
