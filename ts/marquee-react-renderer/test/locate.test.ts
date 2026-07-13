// nodeAt vs nodeNear: containment has holes, and an editor's cursor lives
// in them. These are pure functions over (doc, spans, offset), so they test
// without a DOM.

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWithPositions } from "@cube-drone/marquee-parser";
import { nodeAt, nodeNear } from "../src/index.ts";

/** `[1,2,3] 4, 5` in Marquee: a three-item list, then two paragraphs. */
const SOURCE = "- one\n- two\n- three\n\nfour\n\nfive\n";

function locate(offset: number): { at: string; near: string } {
  const { doc, spans } = parseWithPositions(SOURCE);
  const describe = (n: ReturnType<typeof nodeAt>): string => {
    if (n === null) {
      return "null";
    }
    const span = spans.get(n)!;
    return `${n.type}(${JSON.stringify(SOURCE.slice(span.start, span.end))})`;
  };
  return { at: describe(nodeAt(doc, spans, offset)), near: describe(nodeNear(doc, spans, offset)) };
}

test("inside a construct, nodeAt and nodeNear agree", () => {
  const onOne = SOURCE.indexOf("one") + 1;
  const { at, near } = locate(onOne);
  assert.ok(at.startsWith("text"), `containment finds the text: ${at}`);
  assert.equal(at, near, "no gap, no disagreement");
});

test("in the blank line between blocks in a container, containment answers the CONTAINER", () => {
  // The [1,2,3] case: three blocks in a section, cursor parked in the blank
  // line between two of them. No child contains that offset, so strict
  // containment climbs to the section - and centering the section means
  // centering all three. (Item boundaries in a list have no such hole:
  // spans have inclusive ends, so the newline still belongs to the item
  // before it. The holes are blank lines, and only blank lines.)
  const src = ":::section\none\n\ntwo\n\nthree\n:::\n";
  const { doc, spans } = parseWithPositions(src);
  const blank = src.indexOf("two") - 1;
  const at = nodeAt(doc, spans, blank)!;
  const near = nodeNear(doc, spans, blank)!;
  assert.equal(at.type, "directive", "strict containment: the whole section");
  assert.equal(near.type === "text" || near.type === "paragraph", true, "nearest: a block beside it");
  const nearSpan = spans.get(near)!;
  const nearText = src.slice(nearSpan.start, nearSpan.end);
  assert.ok(nearText === "one" || nearText === "two", `an adjacent block, not the container: ${nearText}`);
});

test("on the blank line between two paragraphs, containment answers the DOCUMENT", () => {
  // ... which is why scrolling to it centered the entire tour.
  const blank = SOURCE.indexOf("four") - 1;
  const { at, near } = locate(blank);
  assert.ok(at.startsWith("document("), `the whole document contains it: ${at}`);
  assert.ok(near.includes("four") || near.includes("three"), `nearest answers a block: ${near}`);
  assert.ok(!near.startsWith("document("), "not the document");
});

test("past the end of the document, nearest still lands somewhere useful", () => {
  const { near } = locate(SOURCE.length + 50);
  assert.ok(near.includes("five"), `the last block, not null: ${near}`);
});

test("ties go to the earlier node (deterministic, not arbitrary)", () => {
  const src = "a\n\nb\n";
  const { doc, spans } = parseWithPositions(src);
  // offset 2: the blank line, equidistant from "a" (ends at 1) and "b" (starts at 3)
  const near = nodeNear(doc, spans, 2)!;
  const span = spans.get(near)!;
  assert.equal(src.slice(span.start, span.end), "a");
});
