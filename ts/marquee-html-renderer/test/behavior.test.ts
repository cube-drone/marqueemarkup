// The behavioral suite: the spec's renderer obligations as renderer-agnostic
// checks, run over the whole vector corpus. These are the thoughtful tests
// written once - a future renderer (or the Rust port) passes these without
// matching this renderer's markup byte-for-byte.
//
// Obligations checked:
//   1. Never eat content: every text/code value in the AST appears in output.
//   2. The anti-shrug: comment content NEVER appears in output.
//   3. Fail closed, visibly: one placeholder per invalid_directive.
//   4. Escaping: author bytes cannot become markup.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Node } from "@cube-drone/marquee-parser";
import { bareWebProfile, escapeText, render, renderMarquee } from "../src/index.ts";

interface Collected {
  visible: string[];
  comments: string[];
  invalids: number;
}

function collect(node: Node, out: Collected): void {
  switch (node.type) {
    case "text":
      out.visible.push(node.value);
      break;
    case "code_block":
    case "code_span":
      out.visible.push(node.text);
      break;
    case "comment":
      out.comments.push(node.text);
      break;
    case "invalid_directive":
      out.invalids += 1;
      break;
    default:
      break;
  }
  if ("children" in node) {
    for (const child of node.children) {
      collect(child, out);
    }
  }
}

const vectorsDir = fileURLToPath(new URL("../../../vectors/", import.meta.url));
for (const file of readdirSync(vectorsDir).filter((f) => f.endsWith(".json")).sort()) {
  const cases = JSON.parse(readFileSync(join(vectorsDir, file), "utf8")) as Array<{
    name: string;
    ast: unknown;
  }>;
  for (const c of cases) {
    test(`obligations: ${c.name}`, () => {
      const ast = c.ast as Node;
      const html = render(ast);
      const got: Collected = { visible: [], comments: [], invalids: 0 };
      collect(ast, got);
      // Never-eat is about CHARACTERS surviving, not element boundaries:
      // per-unit effects (typewriter, by=letter) legitimately interleave
      // markup between characters, so check the tag-stripped text.
      const textOnly = html.replace(/<[^>]*>/g, "");
      for (const value of got.visible) {
        if (value !== "") {
          assert.ok(
            textOnly.includes(escapeText(value)),
            `authored content eaten: ${JSON.stringify(value)}\nhtml: ${html}`,
          );
        }
      }
      for (const value of got.comments) {
        if (value !== "") {
          assert.ok(
            !html.includes(escapeText(value)),
            `comment leaked into reader view: ${JSON.stringify(value)}`,
          );
        }
      }
      const placeholders = html.split('class="mq-invalid"').length - 1;
      assert.equal(placeholders, got.invalids, "one visible placeholder per invalid construct");
    });
  }
}

test("escaping: author bytes cannot become markup", () => {
  const source = [
    "# <script>alert(1)</script>",
    "",
    '<img onerror=x> & "quotes" &amp; entities',
    "",
    "[click](javascript:alert(1))",
    "",
    "![<b>bold alt</b>](https://e.x/pic.png)",
    "",
    "```html",
    "<script>boom</script>",
    "```",
    "",
    ':::x k="<script>injected</script>":::',
    "",
    "%% secret <script>comment</script>",
    "",
  ].join("\n");
  const html = renderMarquee(source);
  assert.ok(!html.includes("<script"), "script tag survived escaping");
  assert.ok(!html.includes('href="javascript:'), "javascript: URL became a link");
  assert.ok(!html.includes("secret"), "comment content leaked");
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), "escaped text present");
});

test("blocked links keep their children", () => {
  const html = renderMarquee("[the words](weird://scheme)\n");
  assert.ok(html.includes("the words"));
  assert.ok(!html.includes("weird://scheme"));
});

test("media sizing: knobs land in slots, invalid values degrade", () => {
  const sized = renderMarquee(":::media width=200 height=300\n![x](https://e.x/p.png)\n:::\n");
  assert.ok(sized.includes('<div class="mq-media" style="--mq-media-w:200px;--mq-media-h:300px">'));
  const full = renderMarquee(":::media width=full\n![x](https://e.x/s.mp3)\n:::\n");
  assert.ok(full.includes("--mq-media-w:100%"));
  const bogus = renderMarquee(':::media width=69420 height="12px"\n![x](https://e.x/p.png)\n:::\n');
  assert.ok(bogus.includes('<div class="mq-media">'), "invalid values -> unsized wrapper");
  assert.ok(!bogus.includes("69420") && !bogus.includes("12px"), "invalid values never emitted");
});

test("by=letter splits into offset units; spaces ride along", () => {
  const html = renderMarquee("[wave by=letter]hi there[/wave]\n");
  assert.ok(html.includes('class="mq-wave mq-split"'));
  assert.equal(html.split('class="mq-l"').length - 1, 7, "7 letters wrapped, space not");
  assert.ok(html.includes("--mq-o:0.125"), "sequential offsets present");
  const again = renderMarquee("[wave by=letter]hi there[/wave]\n");
  assert.equal(html, again, "offsets are deterministic");
});

test("by=word wraps word-like segments only", () => {
  const html = renderMarquee("[bounce by=word]each word bounces![/bounce]\n");
  assert.equal(html.split('class="mq-l"').length - 1, 3, "3 words wrapped, punctuation not");
  assert.ok(html.includes(">each</span>"));
});

test("phase knob: scatter scrambles, ramp smooths, both deterministic", () => {
  const ramp = renderMarquee("[rainbow by=letter]abcd[/rainbow]\n");
  const scatter = renderMarquee("[rainbow by=letter phase=scatter]abcd[/rainbow]\n");
  assert.notEqual(ramp, scatter, "scatter must differ from the default sweep");
  assert.equal(
    scatter,
    renderMarquee("[rainbow by=letter phase=scatter]abcd[/rainbow]\n"),
    "scatter is deterministic",
  );
  const jitterRamp = renderMarquee("[jitter by=letter phase=ramp]abcd[/jitter]\n");
  assert.ok(jitterRamp.includes("--mq-o:0.125"), "ramped jitter sweeps sequentially");
  const bogus = renderMarquee("[wave by=letter phase=chaos]abcd[/wave]\n");
  assert.equal(bogus, renderMarquee("[wave by=letter]abcd[/wave]\n"), "invalid phase -> default");
});

test("size dial: seven steps, presentational floor, off-dial degrades", () => {
  const html = renderMarquee("[size=6]loud[/size] [big]up[/big] [size=12]off the dial[/size]\n");
  assert.ok(html.includes('<font class="mq-size-6" size="6">loud</font>'));
  assert.ok(html.includes("<big>up</big>"));
  assert.ok(html.includes("off the dial") && !html.includes("12"), "invalid size degrades");
  const named = renderMarquee("[enormous]yes[/enormous] [tiny]no[/tiny]\n");
  assert.ok(named.includes('<font class="mq-size-7" size="7">yes</font>'));
  assert.ok(named.includes('<font class="mq-size-2" size="2">no</font>'));
});

test("font list: closed names render floor+ceiling, off-list degrades", () => {
  const html = renderMarquee("[font=orbitron]go[/font] [font=papyrus]nope[/font]\n");
  assert.ok(html.includes('<font class="mq-font-orbitron" face="Orbitron">go</font>'));
  assert.ok(html.includes("nope") && !html.includes("papyrus"), "off-list name degrades");
  const block = renderMarquee(":::section font=vt323\nwords\n:::\n");
  assert.ok(block.includes("mq-font-vt323"), "block knob lands as a class");
  const bogus = renderMarquee(":::section font=wingdings\nwords\n:::\n");
  assert.ok(!bogus.includes("mq-font-"), "off-list block knob emits nothing");
});

test("turbolink socket: rich plugins wrap, the floor is always reachable", () => {
  const profile = {
    ...bareWebProfile,
    turbolink: (_t: string, level: string) => (level === "full" ? "<b>RICH</b>" : null),
  };
  const full = renderMarquee("https://e.x/post\n", profile);
  assert.ok(full.includes('<div class="mq-turbolink mq-turbolink-rich"><b>RICH</b>'));
  assert.ok(
    full.includes('<a class="mq-turbolink-source" href="https://e.x/post">https://e.x/post</a></div>'),
    "the wrapper always carries the original link - augment, never replace",
  );
  const title = renderMarquee(":::turbolink target=https://e.x/post level=title:::\n", profile);
  assert.ok(title.includes('<p class="mq-turbolink"><a'), "plugin declined title: the floor");
  const bare = renderMarquee(":::turbolink target=https://e.x/post level=bare:::\n", profile);
  assert.ok(!bare.includes("mq-turbolink-rich"), "bare never consults plugins");
  const floor = renderMarquee("https://e.x/post\n");
  assert.ok(floor.includes('<p class="mq-turbolink"><a href="https://e.x/post">'), "no plugins: the floor");
});

test("background tiles: media policy applies, URLs are CSS-sanitized", () => {
  const tiled = renderMarquee(":::section background=tile:https://e.x/stars.gif\nwords\n:::\n");
  assert.ok(tiled.includes("--mq-bg-tile:url('https://e.x/stars.gif')"), "in-policy image tiles");
  const blocked = renderMarquee(":::section background=tile:weird://x.gif\nwords\n:::\n");
  assert.ok(!blocked.includes("mq-bg-tile"), "out-of-policy scheme: no background, words survive");
  assert.ok(blocked.includes("words"), "the words survive the lost wallpaper");
  const notImage = renderMarquee(":::section background=tile:https://e.x/song.mp3\nwords\n:::\n");
  assert.ok(!notImage.includes("mq-bg-tile"), "non-image target: no background");
  const sly = renderMarquee(
    `:::section background="tile:https://e.x/x.png?a=') ; background:url(//evil"\nwords\n:::\n`,
  );
  const token = sly.match(/--mq-bg-tile:url\('([^']*)'\)/);
  assert.ok(token !== null, "sly url still lands in exactly one url token");
  assert.ok(!/[()'"\\]/.test(token![1]!), "quotes, parens, backslashes never survive into it");
});

test("typewriter: per-letter reveal ordinals, speed knob, word mode, cap fallback", () => {
  const html = renderMarquee("[typewriter speed=20]hi[/typewriter]\n");
  assert.ok(html.includes('class="mq-typewriter mq-split" style="--mq-tw-step:0.05s"'));
  assert.ok(html.includes('--mq-o:0') && html.includes('--mq-o:1'), "sequential integer ordinals");
  const dflt = renderMarquee("[typewriter]hi[/typewriter]\n");
  assert.ok(dflt.includes("--mq-tw-step:0.071s"), "invalid/absent speed: the default");
  const words = renderMarquee("[typewriter by=word]two words[/typewriter]\n");
  assert.equal((words.match(/mq-l/g) ?? []).length, 2, "by=word reveals word-at-a-time");
  const long = renderMarquee(`[typewriter]${"x".repeat(500)}[/typewriter]\n`);
  assert.ok(long.includes("mq-split"), "typewriter's cap is high: long text is the use case");
  const past = renderMarquee(`[typewriter]${"x".repeat(2500)}[/typewriter]\n`);
  assert.ok(!past.includes("mq-split"), "past 2000 units: whole and static, words first");
  // scatter is a permutation of 0..total-1 and never a mirror: the fixed
  // prime stride once typed 40-unit runs in backwards.
  const scattered = renderMarquee(`[typewriter phase=scatter]${"ab ".repeat(20).trim()}[/typewriter]\n`);
  const ordinals = [...scattered.matchAll(/--mq-o:(\d+)/g)].map((m) => Number(m[1]));
  assert.equal(new Set(ordinals).size, ordinals.length, "a true permutation, no collisions");
  const reversed = [...ordinals].every((o, i) => o === ordinals.length - 1 - i);
  const ascending = [...ordinals].every((o, i) => o === i);
  assert.ok(!reversed && !ascending, "scrambled, not a mirror or a no-op");
});

test("fadein: whole-run by default, per-unit with by=, blink splits too", () => {
  const whole = renderMarquee("[fadein]a ghost[/fadein]\n");
  assert.ok(whole.includes('<span class="mq-fadein">a ghost</span>'), "bare fadein: one fade");
  const split = renderMarquee("[fadein by=letter speed=20]boo[/fadein]\n");
  assert.ok(split.includes('mq-fadein mq-split" style="--mq-fi-step:0.05s"'));
  assert.ok(split.includes("--mq-o:2"), "sequential reveal ordinals");
  const chase = renderMarquee("[blink by=letter rate=2]OPEN[/blink]\n");
  assert.ok(chase.includes('mq-blink mq-split" style="--mq-rate:2"'), "rate rides the container");
  assert.equal((chase.match(/mq-l/g) ?? []).length, 4, "chase lights, one per letter");
});

test("alignment trio: center reborn, right for symmetry, left un-aligns", () => {
  const html = renderMarquee(":::center\nhi\n\n:::left\nrail[/left]\n:::\n:::\n\n:::right\nbye\n:::\n");
  assert.ok(html.includes('<div class="mq-center"><p>hi</p>'));
  assert.ok(html.includes('<div class="mq-left">'), "left nests inside center as the un-aligner");
  assert.ok(html.includes('<div class="mq-right"><p>bye</p></div>'));
});

test("spoiler: content present and never eaten, just withheld", () => {
  const html = renderMarquee("who dies? [spoiler]everyone[/spoiler] eventually\n");
  assert.ok(html.includes('<span class="mq-spoiler" tabindex="0">everyone</span>'));
  assert.ok(html.includes("everyone"), "the words are in the DOM, only visually blurred");
  const rich = renderMarquee("[spoiler]the *twist* is [color=#f06]red[/color][/spoiler]\n");
  assert.ok(rich.includes("<em>twist</em>") && rich.includes("mq-color"), "rich content inside");
  // Block form: hide a whole region (an image, a paragraph).
  const block = renderMarquee(":::spoiler\n![the ending](end.jpg)\n:::\n");
  assert.ok(block.includes('<div class="mq-spoiler mq-spoiler-block" tabindex="0">'));
  assert.ok(block.includes("<img") && block.includes("end.jpg"), "the image survives, just blurred");
});

test("tables: paragraph-rows, [c] cells, header promotion, nothing eaten", () => {
  const html = renderMarquee(
    ":::table header=row\n[c]dish[/c] [c]price[/c]\n\n[c]*Spaghetti*[/c] [c]$12[/c]\n:::\n",
  );
  assert.ok(html.includes('<table class="mq-table">'));
  assert.ok(html.includes('<th scope="col">dish</th><th scope="col">price</th>'));
  assert.ok(html.includes("<td><em>Spaghetti</em></td><td>$12</td>"));
  const col = renderMarquee(":::table header=column\n[c]sun[/c] [c]warm[/c]\n:::\n");
  assert.ok(col.includes('<th scope="row">sun</th><td>warm</td>'));
  const loose = renderMarquee(":::table\nloose [c]celled[/c]\n:::\n");
  assert.ok(loose.includes("loose") && loose.includes("<td>celled</td>"), "implicit cells never eat");
  const noHead = renderMarquee(":::table\n[c]a[/c]\n:::\n");
  assert.ok(!noHead.includes("<th"), "no header attr: all data cells");
});

test("headings 7 and 8: ARIA heading blocks past HTML's ladder", () => {
  const html = renderMarquee("####### seven\n\n######## eight\n\n######### nine\n");
  assert.ok(html.includes('<p class="mq-h7" role="heading" aria-level="7">seven</p>'));
  assert.ok(html.includes('<p class="mq-h8" role="heading" aria-level="8">eight</p>'));
  assert.ok(html.includes("######### nine"), "nine hashes degrade to prose");
});

test("emoji socket: text escapes, images wear mq-emoji, null stays literal", () => {
  const profile = {
    ...bareWebProfile,
    emoji: (slug: string) =>
      slug === "cat" ? "🐱" : slug === "blobcat" ? { image: "https://e.x/blob.png" } : null,
  };
  const html = renderMarquee(":cat: :blobcat: :dog:\n", profile);
  assert.ok(html.includes("🐱"));
  assert.ok(
    html.includes('<img class="mq-emoji" src="https://e.x/blob.png" alt=":blobcat:" loading="lazy">'),
    "image resolution becomes a character-sized img, alt defaults to the slug",
  );
  assert.ok(html.includes(":dog:"), "unresolved slug stays literal");
  const sly = {
    ...bareWebProfile,
    emoji: () => ({ image: '"><script>alert(1)</script>', alt: "<b>" }),
  };
  const escaped = renderMarquee(":x:\n", sly);
  assert.ok(!escaped.includes("<script"), "src and alt are attribute-escaped");
  assert.ok(escaped.includes("&lt;b&gt;"));
});

test("asides: numbered marks, notes flush below the triggering block", () => {
  const html = renderMarquee(
    "First[sidenote]note one[/sidenote] paragraph.\n\nSecond[sidenote]note two[/sidenote] here.\n",
  );
  assert.ok(html.includes('<sup class="mq-noteref">1</sup> paragraph.</p><aside class="mq-notes">'));
  assert.ok(html.includes('<span class="mq-note-num">1</span>note one'));
  assert.ok(html.includes('<sup class="mq-noteref">2</sup>'), "numbering runs through the document");
  assert.ok(html.includes('<span class="mq-note-num">2</span>note two'));
  const heading = renderMarquee("# Title[sidenote]on a heading[/sidenote]\n");
  assert.ok(heading.includes("</h1><aside"), "headings flush their notes too");
  const synonyms = renderMarquee("a[aside]one[/aside] b[footnote]two[/footnote]\n");
  assert.equal(
    (synonyms.match(/mq-noteref/g) ?? []).length,
    2,
    "aside and footnote are permanent synonyms for sidenote",
  );
});

test("unknown span shrugs but children survive styled context", () => {
  const html = renderMarquee("[spiral]still here[/spiral]\n");
  assert.ok(html.includes("still here"));
  assert.ok(!html.includes("spiral"), "unknown span name should not reach output");
});
