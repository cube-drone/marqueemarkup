import { test } from "node:test";
import assert from "node:assert/strict";
import { standardEmoji } from "../src/index.ts";

const SLUG = /^[a-z0-9_+-]{1,64}$/;

test("standard table: gemoji's shortcodes, characters as values", () => {
  assert.equal(standardEmoji["sparkles"], "✨");
  assert.equal(standardEmoji["tophat"], "🎩");
  assert.equal(standardEmoji["+1"], "👍");
  assert.ok(Object.keys(standardEmoji).length > 1800, "the whole table, not a sample");
});

test("every slug conforms to the spec's slug grammar", () => {
  for (const slug of Object.keys(standardEmoji)) {
    assert.ok(SLUG.test(slug), `non-conforming slug: ${slug}`);
  }
});
