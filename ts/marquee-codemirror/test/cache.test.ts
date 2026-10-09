// The block cache, through a real EditorState: an unedited block must never
// re-render, wherever the edit happened.

import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { marquee } from "../src/index.ts";

test("typing above a block doesn't re-render it", () => {
  let renders = 0;
  // Fifty separate quote blocks, each holding a link: one render of one
  // block asks linkAllowed once.
  const profile = { linkAllowed: () => (renders++, true) };
  const doc = "top\n\n" + Array.from({ length: 50 }, (_, i) => `> quote [link ${i}](https://e.x/${i})`).join("\n\n") + "\n";
  let state = EditorState.create({ doc, selection: { anchor: 0 }, extensions: [marquee({ profile })] });
  assert.equal(renders, 50, "first paint renders every block");
  renders = 0;
  state = state.update({ changes: { from: 0, insert: "x" }, selection: { anchor: 1 } }).state;
  assert.equal(renders, 0, "every block below the caret moved, none changed");
  state = state.update({ changes: { from: state.doc.length - 2, insert: "!" } }).state;
  assert.equal(renders, 1, "editing a block re-renders that block alone");
});
