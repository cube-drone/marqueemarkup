// { output: "xhtml" }: every page an XML parser will accept, as an ePub
// reader needs - checked by parsing, not by eye - and the same words and
// classes as the HTML spelling. Plus Profile.linkTarget, which an ePub needs
// to point a link at a chapter. Mirror of rust/html_renderer/tests/xhtml.rs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { parse } from "@cube-drone/marquee-parser";
import { bareWebProfile, render, renderMarquee, type Profile } from "../src/index.ts";

// saxes is the strict parser (jsdom's), but its .d.ts doesn't survive
// exactOptionalPropertyTypes; this is the sliver of it the test uses.
interface Sax {
  on(event: "error", handler: (e: Error) => void): void;
  write(chunk: string): Sax;
  close(): void;
}
const { SaxesParser } = createRequire(import.meta.url)("saxes") as {
  SaxesParser: new (options: { xmlns: boolean }) => Sax;
};

/** Parse as a page body the way a strict reader would: XHTML namespace, no
 * DTD, so only XML's own five entities exist. Returns the first error. */
function wellFormed(xhtml: string): string | null {
  let error: string | null = null;
  const parser = new SaxesParser({ xmlns: true });
  parser.on("error", (e) => {
    error ??= e.message;
  });
  parser.write(`<html xmlns="http://www.w3.org/1999/xhtml"><body>${xhtml}</body></html>`).close();
  return error;
}

/** Every embed kind, emoji as images - the branches the bare-web profile
 * never reaches. */
const everything: Profile = {
  ...bareWebProfile,
  media: (target) => ({
    kind: target.endsWith(".mp3") ? "audio" : target.endsWith(".mp4") || target.endsWith(".gif") ? "video" : "image",
    url: target,
    loop: target.endsWith(".gif"),
  }),
  emoji: (slug) => ({ image: `emoji/${slug}.png` }),
};

test("the vector corpus is well-formed XML", () => {
  const vectorsDir = fileURLToPath(new URL("../../../vectors/", import.meta.url));
  const failures: string[] = [];
  for (const file of readdirSync(vectorsDir).filter((f) => f.endsWith(".json")).sort()) {
    const cases = JSON.parse(readFileSync(join(vectorsDir, file), "utf8")) as Array<{ name: string; marquee: string }>;
    for (const c of cases) {
      const doc = parse(c.marquee);
      for (const profile of [bareWebProfile, everything]) {
        const error = wellFormed(render(doc, profile, { output: "xhtml" }));
        if (error !== null) {
          failures.push(`${c.name}: ${error}`);
        }
      }
    }
  }
  assert.deepEqual(failures, []);
});

const KITCHEN_SINK = [
  "one\\\ntwo\n\n",
  "---\n\n",
  "![a picture](p.png) ![a song](s.mp3) ![a clip](c.mp4) ![a loop](l.gif) :horse:\n\n",
  "![two\nlines](p.png)\n\n",
  '&nbsp; &copy; &amp; <br> "quoted"\n\n',
  "nul\u0000bell\u0007tab\there ￿ \uD800\n\n",
  "[rainbow by=letter]co\u0001lor[/rainbow]\n",
].join("");

test("void elements close and boolean attributes carry values", () => {
  const html = renderMarquee(KITCHEN_SINK, everything);
  assert.notEqual(wellFormed(html), null, "the HTML spelling should not pass as XML");
  assert.notEqual(wellFormed("<p>bell\u0007</p>"), null, "the checker itself refuses what XML forbids");

  const xhtml = renderMarquee(KITCHEN_SINK, everything, { output: "xhtml" });
  assert.equal(wellFormed(xhtml), null, xhtml);
  for (const spelling of [
    "<br/>",
    "<hr/>",
    '<img class="mq-embed" src="p.png" alt="a picture" loading="lazy"/>',
    '<img class="mq-emoji" src="emoji/horse.png" alt=":horse:" loading="lazy"/>',
    '<audio class="mq-embed" controls="controls" src="s.mp3"',
    '<video class="mq-embed" controls="controls" src="c.mp4"',
    '<video class="mq-embed" autoplay="autoplay" loop="loop" muted="muted" playsinline="playsinline" src="l.gif"',
    'alt="two&#10;lines"',
    '&amp;nbsp; &amp;copy; &amp;amp; &lt;br&gt; "quoted"',
    "nul�bell�tab\there � �",
  ]) {
    assert.ok(xhtml.includes(spelling), `missing ${JSON.stringify(spelling)}:\n${xhtml}`);
  }
});

test("xhtml is the same document spelled differently", () => {
  // Without voids, flags, or awkward characters the two spellings agree
  // byte for byte.
  const src = "# Hi\n\n*a* **b** [link](https://e.x)\n\n:::section scheme=noir\n[rainbow by=word]some words[/rainbow]\n:::\n";
  assert.equal(renderMarquee(src), renderMarquee(src, bareWebProfile, { output: "xhtml" }));
});

/** Notes in a book: a link to another note points at its chapter. */
const book: Profile = {
  ...bareWebProfile,
  linkTarget: (target) => {
    const id = target.startsWith("https://app.example/note/") ? target.slice("https://app.example/note/".length) : null;
    return id === null ? null : `chapter-${id}.xhtml`;
  },
};

test("linkTarget rewrites where an allowed link points", () => {
  const html = renderMarquee(
    "[the other note](https://app.example/note/07) and [elsewhere](https://e.x)\n\n" +
      "https://app.example/note/08\n\n" +
      "![a document](https://app.example/note/09)\n\n" +
      "[refused](javascript:alert(1))\n",
    book,
  );
  assert.ok(html.includes('<a href="chapter-07.xhtml">the other note</a>'), html);
  assert.ok(html.includes('<a href="https://e.x">elsewhere</a>'), `null keeps the target: ${html}`);
  assert.ok(html.includes('<a href="chapter-08.xhtml">https://app.example/note/08</a>'), `a turbolink's text stays the author's: ${html}`);
  assert.ok(html.includes('<a class="mq-embed-fallback" href="chapter-09.xhtml">[a document]</a>'), html);
  assert.ok(html.includes('<span class="mq-blocked">refused</span>'), `a refused link stays refused: ${html}`);
});

test("linkTarget is escaped like any target", () => {
  const html = renderMarquee("[x](https://e.x)\n", { ...bareWebProfile, linkTarget: () => 'a"b&c<d' });
  assert.ok(html.includes('href="a&quot;b&amp;c&lt;d"'), html);
});
