import { test } from "node:test";
import assert from "node:assert/strict";
import { marqueeCss } from "../src/index.ts";

test("the stylesheet string is the stylesheet", () => {
  assert.ok(marqueeCss.includes(".mq-doc"), "scoping root present");
  assert.ok(marqueeCss.includes("prefers-reduced-motion"), "the exit is contractual");
  assert.ok(marqueeCss.includes(".mq-scheme-hotdog-stand"), "the condiment king endures");
});
