import { test } from "node:test";
import assert from "node:assert/strict";
import { marqueeCss } from "../src/index.ts";

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
