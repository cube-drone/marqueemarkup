import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { marqueeCss, stripCssComments as strip } from "../src/index.ts";

test("the stylesheet string is the stylesheet", () => {
  assert.ok(marqueeCss.includes(".mq-doc"), "scoping root present");
  assert.ok(marqueeCss.includes("prefers-reduced-motion"), "the exit is contractual");
  assert.ok(marqueeCss.includes(".mq-scheme-hotdog-stand"), "the condiment king endures");
});

test("the game-window schemes are there, and scheme faces yield to font knobs", () => {
  for (const scheme of ["earthbound", "earthbound-mint", "earthbound-strawberry", "earthbound-banana", "earthbound-peanut", "crosscode", "ff6", "chronotrigger"]) {
    assert.ok(marqueeCss.includes(`.mq-scheme-${scheme}`), scheme);
  }
  // A scheme's typeface sits at zero specificity, so font= wins (SPEC: a knob
  // written alongside a scheme overrides it).
  assert.ok(!/\.mq-scheme-[a-z-]+\s*\{[^}]*font-family/.test(marqueeCss), "no scheme sets font-family at class specificity");
  assert.ok(marqueeCss.includes(":where(.mq-scheme-terminal)"));
});

test("the period, message, and OS schemes are there", () => {
  for (const scheme of [
    "newsprint", "typewriter", "bluescreen",
    "pear-message-me", "pear-message-other", "robot-message-me", "robot-message-other",
    "windows", "windows-xp",
  ]) {
    assert.ok(marqueeCss.includes(`.mq-scheme-${scheme}`), scheme);
  }
  // The bare message schemes are matched with the flavors, by prefix.
  assert.ok(marqueeCss.includes('[class*="mq-scheme-pear-message"]'));
  assert.ok(marqueeCss.includes('[class*="mq-scheme-robot-message"]'));
});

test("the OS schemes are scoped, attributed, and carry no baggage", () => {
  // Scoped: 98.css and XP.css restyle bare elements, which must never leak
  // out of the section, and must stop at a nested scheme.
  assert.ok(marqueeCss.includes('@scope (.mq-scheme-windows) to ([class*="mq-scheme-"]:not(.mq-scheme-windows))'));
  assert.ok(marqueeCss.includes('@scope (.mq-scheme-windows-xp) to ([class*="mq-scheme-"]:not(.mq-scheme-windows-xp))'));
  // MIT asks for the notice to travel with substantial portions.
  assert.ok(marqueeCss.includes("Copyright 2020 Jordan Scales"));
  assert.ok(marqueeCss.includes("Copyright 2020 Adam Hammad, Jordan Scales"));
  // Upstream's @font-face is CC-BY-SA and fetches files we don't ship.
  assert.ok(!marqueeCss.includes("@font-face"), "the reference stylesheet declares no faces");
  assert.ok(!/\.woff/.test(marqueeCss), "and points at no font files");
  // Every url() is inline: a stylesheet fetch is a tracking vector.
  // (%23 is an SVG's reference to its own gradient, inside a data: URI.)
  for (const m of marqueeCss.matchAll(/url\(\s*["']?([^"')\s]{0,20})/g)) {
    assert.ok(m[1]!.startsWith("data:") || m[1]!.startsWith("%23"), `non-inline url: ${m[1]}`);
  }
});

// The same cases as the Rust crate's lockstep.rs: both strippers must agree.
test("comment stripping: comments go, strings and notices stay", () => {
  assert.equal(strip("a { color: red; } /* gone */\n"), "a { color: red; }");
  assert.equal(strip("/* whole\n   lines */\n\n  b {\n    top: 0;\n  }\n"), "b {\ntop: 0;\n}");
  assert.equal(strip("/*! keep\n * me */\na{}"), "/*! keep\n* me */\na{}");
  assert.equal(strip("a{b:c/**/d}"), "a{b:c d}", "a comment separates tokens");
  assert.equal(strip('a{background:url("x/*y*/z")}'), 'a{background:url("x/*y*/z")}');
  assert.equal(strip("a{content:'\\'/*k*/'}"), "a{content:'\\'/*k*/'}");
  assert.equal(strip('a{content:"é"}/* é */b{}'), 'a{content:"é"} b{}');
  assert.equal(strip("a{} /* never closed"), "a{}");
});

test("the wire stylesheet is the file minus its comments, every rule intact", () => {
  const file = readFileSync(new URL("../marquee.css", import.meta.url), "utf8");
  assert.ok(marqueeCss.length < file.length);
  assert.ok(!marqueeCss.includes("the reference stylesheet for rendered Marquee"), "ordinary comments go");
  // Ruleset count is the same with and without: nothing but comments left.
  const rules = (css: string) => (css.replace(/\/\*[\s\S]*?\*\//g, "").match(/\{/g) ?? []).length;
  assert.equal(rules(marqueeCss), rules(file));
});
