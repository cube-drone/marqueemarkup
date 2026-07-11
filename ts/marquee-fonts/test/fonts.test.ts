import { test } from "node:test";
import assert from "node:assert/strict";
import { FONT_MANIFEST, externalFontFaces, fontFilePath, inlineFontFaces } from "../src/index.ts";
import { FONTS } from "@classam/marquee-html-renderer";

const STANDARD = new Set(["sans", "serif", "mono", "comic"]);

test("manifest stays in lockstep with the renderer's font vocabulary", () => {
  const rendererTokens = Object.keys(FONTS).filter((t) => !STANDARD.has(t));
  assert.deepEqual(Object.keys(FONT_MANIFEST).sort(), rendererTokens.sort(), "same tokens");
  for (const [token, family] of Object.entries(FONT_MANIFEST)) {
    assert.equal(family, FONTS[token], `family for ${token} matches`);
  }
});

test("every manifest face has its file and its license beside it", () => {
  for (const token of Object.keys(FONT_MANIFEST)) {
    assert.ok(fontFilePath(token) !== null, `${token}.woff2 present`);
  }
});

test("external faces point at served files; inline faces carry the bytes", () => {
  const external = externalFontFaces(["orbitron", "orbitron", "nonsense"], "../fonts/");
  assert.ok(external.includes('url("../fonts/orbitron.woff2")'));
  assert.ok(external.includes('font-family: "Orbitron"'));
  assert.ok(!external.includes("nonsense"), "unknown tokens skipped");
  const inline = inlineFontFaces(["vt323"]);
  assert.ok(inline.includes("data:font/woff2;base64,"));
  assert.ok(inline.includes('font-family: "VT323"'));
  assert.ok(inline.length > 10000, "the bytes are actually in there");
});
