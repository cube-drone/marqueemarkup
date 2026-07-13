// The planner is a pure function - no CodeMirror, no DOM - so the whole
// live-preview policy is testable in plain Node. The CM adapter is a thin
// translation of these specs, exercised by the demo in a browser.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { plan, bareWebProfile, type DecoSpec, type Profile } from "../src/index.ts";

/** A profile that resolves a demo emoji and images, so widget cases fire. */
const profile: Partial<Profile> = {
  emoji: (slug) => (slug === "tophat" ? "🎩" : null),
};

const cursorAt = (offset: number): { from: number; to: number }[] => [{ from: offset, to: offset }];
const noCursor: { from: number; to: number }[] = [{ from: -5, to: -5 }];

function find(specs: DecoSpec[], pred: (s: DecoSpec) => boolean): DecoSpec | undefined {
  return specs.find(pred);
}

test("bold away from the cursor: styled, markers hidden", () => {
  const src = "say **hi** there\n";
  const specs = plan(src, noCursor, { ...bareWebProfile, ...profile });
  const mark = find(specs, (s) => s.kind === "mark" && s.class === "cm-mq-strong");
  assert.ok(mark && mark.kind === "mark");
  assert.equal(src.slice(mark.from, mark.to), "**hi**", "the whole run is the styled range");
  const hides = specs.filter((s) => s.kind === "hide");
  assert.equal(hides.length, 2, "both ** markers hidden");
  assert.deepEqual(
    hides.map((h) => src.slice(h.from, h.to)),
    ["**", "**"],
  );
});

test("bold under the cursor: markers shown, dimmed (not hidden)", () => {
  const src = "say **hi** there\n";
  const onIt = plan(src, cursorAt(src.indexOf("hi")), { ...bareWebProfile, ...profile });
  assert.equal(onIt.filter((s) => s.kind === "hide").length, 0, "nothing hidden while editing");
  const dimmed = onIt.filter((s) => s.kind === "mark" && s.class === "cm-mq-marker");
  assert.equal(dimmed.length, 2, "both markers dimmed instead");
});

test("heading: prefix hidden away, dimmed near; content sized", () => {
  const src = "## A title\n";
  const away = plan(src, noCursor, bareWebProfile);
  assert.ok(find(away, (s) => s.kind === "hide" && src.slice(s.from, s.to) === "## "));
  assert.ok(find(away, (s) => s.kind === "mark" && s.class === "cm-mq-h2"));
});

test("code span with a multi-backtick fence: markers sized right", () => {
  const src = "before ``a ` b`` after\n";
  const specs = plan(src, noCursor, bareWebProfile);
  const hides = specs.filter((s) => s.kind === "hide").map((h) => src.slice(h.from, h.to));
  assert.deepEqual(hides, ["``", "``"], "two backticks each side, not one");
});

test("link: text styled, the (target) tail hidden away from cursor", () => {
  const src = "see [my site](https://e.x/p) ok\n";
  const specs = plan(src, noCursor, bareWebProfile);
  const linkMark = find(specs, (s) => s.kind === "mark" && s.class === "cm-mq-link");
  assert.ok(linkMark && linkMark.kind === "mark");
  assert.equal(src.slice(linkMark.from, linkMark.to), "my site");
  assert.ok(
    specs.some((s) => s.kind === "hide" && src.slice(s.from, s.to) === "](https://e.x/p)"),
    "the target is hidden, leaving just the styled text",
  );
});

test("image: a widget when away, raw source when the cursor is on it", () => {
  const src = "![a cat](https://e.x/cat.png)\n";
  const away = plan(src, noCursor, bareWebProfile);
  const w = find(away, (s) => s.kind === "widget");
  assert.ok(w && w.kind === "widget" && w.widget.type === "image");
  const on = plan(src, cursorAt(4), bareWebProfile);
  assert.equal(on.filter((s) => s.kind === "widget").length, 0, "editing shows the source");
});

test("emoji: glyph widget only when it resolves", () => {
  const known = plan(":tophat: hi\n", noCursor, { ...bareWebProfile, ...profile });
  assert.ok(find(known, (s) => s.kind === "widget" && s.widget.type === "emoji"));
  const unknown = plan(":nope: hi\n", noCursor, { ...bareWebProfile, ...profile });
  assert.equal(unknown.filter((s) => s.kind === "widget").length, 0, "unresolved stays literal");
});

test("styled spans carry inline style, effects just get the span class", () => {
  const color = plan("[color=#f06]hot[/color]\n", noCursor, bareWebProfile);
  assert.ok(find(color, (s) => s.kind === "mark" && s.style === "color:#f06"));
  const blink = plan("[blink]x[/blink]\n", noCursor, bareWebProfile);
  assert.ok(find(blink, (s) => s.kind === "mark" && s.class === "cm-mq-span"), "no animation in the editor");
});

test("comments dim; the whole vector corpus plans without throwing", () => {
  const c = plan("%% a note\n\nvisible\n", noCursor, bareWebProfile);
  assert.ok(find(c, (s) => s.kind === "mark" && s.class === "cm-mq-comment"));

  const dir = fileURLToPath(new URL("../../../vectors/", import.meta.url));
  let cases = 0;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    for (const v of JSON.parse(readFileSync(join(dir, file), "utf8")) as Array<{ marquee: string }>) {
      const specs = plan(v.marquee, noCursor, bareWebProfile);
      // Every spec must be an in-bounds, non-inverted range.
      for (const s of specs) {
        assert.ok(s.from >= 0 && s.from <= s.to && s.to <= v.marquee.length, `bad range in ${file}`);
      }
      cases += 1;
    }
  }
  assert.ok(cases > 90, `planned the corpus (${cases} cases)`);
});
