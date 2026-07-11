import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSite, marquee, marqueeBody, marqueeFragment, marqueeHead } from "../src/index.ts";

test("marquee(): source in, complete self-contained page out", () => {
  const page = marquee("# Hello *world*\n");
  assert.ok(page.startsWith("<!doctype html>"));
  assert.ok(page.includes("<h1>Hello <em>world</em></h1>"));
  assert.ok(page.includes(".mq-doc"), "stylesheet inlined");
  assert.ok(page.includes("<title>Marquee</title>"), "default title");
});

test("marquee(): meta title wins, fonts inline only when worn", () => {
  const plain = marquee(':::meta title="My Page":::\n\nwords\n');
  assert.ok(plain.includes("<title>My Page</title>"));
  assert.ok(!plain.includes("data:font/woff2"), "no fonts worn, no fonts carried");
  const fancy = marquee("[font=orbitron]SPACE[/font]\n");
  assert.ok(fancy.includes("data:font/woff2"), "worn face inlined");
  const bare = marquee("[font=orbitron]SPACE[/font]\n", { fonts: "none" });
  assert.ok(!bare.includes("data:font/woff2"), "fonts: none opts out");
});

test("marqueeFragment(): the pieces, for embedders", () => {
  const { body, css, title, fontTokens } = marqueeFragment("# Piece\n");
  assert.ok(body.startsWith('<div class="mq-doc">'));
  assert.ok(!body.includes("<!doctype"), "fragment is not a page");
  assert.ok(css.includes(".mq-turbolink-card"), "plugin skins collected");
  assert.equal(title, "Marquee");
  assert.deepEqual(fontTokens, [], "no faces worn");
});

test("marqueeBody/marqueeHead: just the body, just the head", () => {
  const source = ':::meta title="Halves":::\n\n# Hi\n';
  const body = marqueeBody(source);
  assert.ok(body.startsWith('<div class="mq-doc">') && !body.includes("<style"));
  const head = marqueeHead(source);
  assert.ok(head.startsWith("<title>Halves</title>\n<style>"));
  assert.ok(head.includes(".mq-doc"), "head carries the stylesheet");
});

test("emoji: the standard table is implicitly loaded", () => {
  const page = marquee("hats :tophat: off, :sparkles: and :+1:\n");
  assert.ok(page.includes("hats 🎩 off, ✨ and 👍"), "gemoji shortcodes just work");
  assert.ok(marquee(":thisoneisnotreal:\n").includes(":thisoneisnotreal:"), "unknown: literal");
});

test("emoji: user entries override defaults; emojiDefaults: false opts out", () => {
  const overridden = marquee("hats :tophat: off\n", { emoji: { tophat: "🤠" } });
  assert.ok(overridden.includes("hats 🤠 off"), "user entry wins over the standard table");
  const bare = marquee("hats :tophat: off\n", { emojiDefaults: false });
  assert.ok(bare.includes("hats :tophat: off"), "no defaults: literal slug");
  const own = marquee(":tophat: :bespoke:\n", { emojiDefaults: false, emoji: { bespoke: "🛠️" } });
  assert.ok(own.includes(":tophat: 🛠️"), "own table without defaults underneath");
  const custom = marquee("look :blobcat:\n", {
    emoji: { blobcat: { image: "https://e.x/blob.png", alt: "blobcat" } },
  });
  assert.ok(
    custom.includes('<img class="mq-emoji" src="https://e.x/blob.png" alt="blobcat" loading="lazy">'),
    "image values become character-sized inline images",
  );
});

test("fonts: external mode emits urls and names the tokens", () => {
  const { css, fontTokens } = marqueeFragment("[font=orbitron]GO[/font]\n", {
    fonts: "external",
    fontBase: "assets/f/",
  });
  assert.ok(css.includes('url("assets/f/orbitron.woff2")'));
  assert.ok(!css.includes("data:font"), "external mode carries no bytes");
  assert.deepEqual(fontTokens, ["orbitron"]);
});

test("buildSite(): the whole borsalino, one call", () => {
  const site = fileURLToPath(new URL("../../../examples/borsalino", import.meta.url));
  const out = mkdtempSync(join(tmpdir(), "marquee-site-"));
  try {
    const report = buildSite(site, out);
    assert.deepEqual(report.pages.sort(), ["gallery", "index", "map", "menu"]);
    assert.equal(report.mediaFiles, 5);
    assert.ok(report.fontFaces.includes("playfair-display"));
    const index = readFileSync(join(out, "index.html"), "utf8");
    assert.ok(index.includes("BORSALINO"), "shared nav included");
    assert.ok(index.includes('href="menu.html"'), "doc-id links resolved");
    assert.ok(readdirSync(join(out, "fonts")).length === report.fontFaces.length);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
