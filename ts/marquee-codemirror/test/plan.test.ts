// The planner is pure - no CodeMirror, no DOM - so the whole live-preview
// policy is testable in plain Node. The CM adapter is a thin translation of
// these specs, exercised by the demo in a browser.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { plan, bareWebProfile, type DecoSpec, type Node, type Profile } from "../src/index.ts";

const profile: Partial<Profile> = { emoji: (slug) => (slug === "tophat" ? "🎩" : null) };
const P = { ...bareWebProfile, ...profile };
const cursorAt = (o: number): { from: number; to: number }[] => [{ from: o, to: o }];
const noCursor: { from: number; to: number }[] = [{ from: -5, to: -5 }];
const find = (specs: DecoSpec[], p: (s: DecoSpec) => boolean): DecoSpec | undefined => specs.find(p);

// -- inline: plain paragraphs are augmented source --

test("bold away from the cursor: styled, markers hidden", () => {
  const src = "say **hi** there\n";
  const specs = plan(src, noCursor, P);
  const mark = find(specs, (s) => s.kind === "mark" && s.class === "cm-mq-strong");
  assert.ok(mark && mark.kind === "mark");
  assert.equal(src.slice(mark.from, mark.to), "**hi**");
  assert.equal(specs.filter((s) => s.kind === "hide").length, 2, "both ** markers hidden");
});

test("bold under the cursor: markers dimmed, not hidden", () => {
  const specs = plan("say **hi** there\n", cursorAt(7), P);
  assert.equal(specs.filter((s) => s.kind === "hide").length, 0);
  assert.equal(specs.filter((s) => s.kind === "mark" && s.class === "cm-mq-marker").length, 2);
});

test("heading prefix hides away, dims near; content sized", () => {
  const specs = plan("## A title\n", noCursor, bareWebProfile);
  assert.ok(find(specs, (s) => s.kind === "hide" && "from" in s));
  assert.ok(find(specs, (s) => s.kind === "mark" && s.class === "cm-mq-h2"));
});

test("link text styled, the (target) tail hidden away", () => {
  const src = "see [my site](https://e.x/p) ok\n";
  const specs = plan(src, noCursor, bareWebProfile);
  const m = find(specs, (s) => s.kind === "mark" && s.class === "cm-mq-link");
  assert.ok(m && m.kind === "mark" && src.slice(m.from, m.to) === "my site");
  assert.ok(specs.some((s) => s.kind === "hide" && src.slice(s.from, s.to) === "](https://e.x/p)"));
});

test("inline effect: real animating class away, static while editing", () => {
  const away = plan("[rainbow]hi[/rainbow]\n", noCursor, bareWebProfile);
  assert.ok(find(away, (s) => s.kind === "mark" && s.class === "mq-rainbow"), "animates away");
  const on = plan("[rainbow]hi[/rainbow]\n", cursorAt(10), bareWebProfile);
  assert.ok(!find(on, (s) => s.kind === "mark" && s.class === "mq-rainbow"), "static while editing");
});

test("inline spoiler blurs away, but is readable while you edit it", () => {
  const away = plan("[spoiler]x[/spoiler]\n", noCursor, bareWebProfile);
  assert.ok(find(away, (s) => s.kind === "mark" && s.class === "mq-spoiler"), "blurs away");
  const on = plan("[spoiler]x[/spoiler]\n", cursorAt(9), bareWebProfile);
  assert.ok(!find(on, (s) => s.kind === "mark" && s.class === "mq-spoiler"), "not blurred while editing");
});

test("color span carries inline style", () => {
  const specs = plan("[color=#f06]hot[/color]\n", noCursor, bareWebProfile);
  assert.ok(find(specs, (s) => s.kind === "mark" && s.style === "color:#f06"));
});

test("emoji becomes a glyph widget only when it resolves", () => {
  assert.ok(find(plan(":tophat: hi\n", noCursor, P), (s) => s.kind === "widget"));
  assert.equal(plan(":nope: hi\n", noCursor, P).filter((s) => s.kind === "widget").length, 0);
});

// -- block: rendered widget when away, source when editing --

function blockSpec(specs: DecoSpec[]): (DecoSpec & { kind: "block" }) | undefined {
  return specs.find((s): s is DecoSpec & { kind: "block" } => s.kind === "block");
}

test("a list renders as a block widget when away, source when editing", () => {
  const src = "- one\n- two\n- three\n";
  const b = blockSpec(plan(src, noCursor, bareWebProfile));
  assert.ok(b && b.node.type === "list", "the whole list is one rendered block");
  assert.equal(b.from, 0);
  const editing = plan(src, cursorAt(3), bareWebProfile);
  assert.equal(blockSpec(editing), undefined, "editing shows the source");
  // ...but a dimmed rendered preview is held below it (doesn't just vanish).
  const preview = editing.find((s) => s.kind === "preview");
  assert.ok(preview && preview.kind === "preview" && preview.node.type === "list");
  assert.ok(preview.at > 0 && preview.at <= src.length, "preview anchored at the block's end");
});

test("quotes, code blocks, tables, rules, turbolinks are rendered blocks", () => {
  const has = (src: string, type: string): boolean =>
    blockSpec(plan(src, noCursor, bareWebProfile))?.node.type === type;
  assert.ok(has("> a quote\n", "blockquote"));
  assert.ok(has("```js\ncode\n```\n", "code_block"));
  assert.ok(has("---\n", "thematic_break"));
  assert.ok(has("https://e.x/post\n", "turbolink"));
  assert.ok(has(":::table\n[c]a[/c]\n:::\n", "directive"), "content directives render");
});

test("a paragraph with an image renders (so images flow full-size in a <p>)", () => {
  const b = blockSpec(plan("look ![cat](cat.jpg) here\n", noCursor, bareWebProfile));
  assert.ok(b && b.node.type === "paragraph");
  // A plain-text paragraph does NOT become a block.
  assert.equal(blockSpec(plan("just words here\n", noCursor, bareWebProfile)), undefined);
});

test("a paragraph with an aside renders (so the note shows below)", () => {
  const b = blockSpec(plan("text[sidenote]note[/sidenote] more\n", noCursor, bareWebProfile));
  assert.ok(b && b.node.type === "paragraph");
});

test("meta is quiet source (dimmed), not an empty widget", () => {
  const specs = plan(':::meta title="x":::\n\nhi\n', noCursor, bareWebProfile);
  assert.ok(find(specs, (s) => s.kind === "mark" && s.class === "cm-mq-comment"), "dimmed like a comment");
  assert.ok(!specs.some((s) => s.kind === "block"), "not rendered as a (blank) block");
});

test("layout containers stay source; content inside still previews", () => {
  const src = ":::section\nlook ![cat](cat.jpg)\n:::\n";
  const specs = plan(src, noCursor, bareWebProfile);
  // No block spec for the section itself...
  assert.ok(!specs.some((s) => s.kind === "block" && s.node.type === "directive"));
  // ...but the image-bearing paragraph inside DID become a block.
  assert.ok(specs.some((s) => s.kind === "block" && s.node.type === "paragraph"));
});

test("comments dim; the whole vector corpus plans in-bounds", () => {
  assert.ok(find(plan("%% note\n\nhi\n", noCursor, bareWebProfile), (s) => s.kind === "mark" && s.class === "cm-mq-comment"));
  const dir = fileURLToPath(new URL("../../../vectors/", import.meta.url));
  let cases = 0;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    for (const v of JSON.parse(readFileSync(join(dir, file), "utf8")) as Array<{ marquee: string }>) {
      for (const s of plan(v.marquee, noCursor, bareWebProfile)) {
        if (s.kind === "preview") {
          assert.ok(s.at >= 0 && s.at <= v.marquee.length, `bad anchor in ${file}`);
        } else {
          assert.ok(s.from >= 0 && s.from <= s.to && s.to <= v.marquee.length, `bad range in ${file}`);
        }
      }
      cases += 1;
    }
  }
  assert.ok(cases > 90);
});
