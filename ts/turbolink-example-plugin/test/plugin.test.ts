// A plugin's own tests - fetchless by construction: match() and render()
// are pure, and resolve() is exactly the part we don't exercise here
// (its network behavior is its own business; render works without it).

import { test } from "node:test";
import assert from "node:assert/strict";
import { composeTurbolinks, defaultPlugins, turbolinkStyles } from "../../turbolink/src/index.ts";
import { marqueeClickPlugin } from "../src/index.ts";

test("recognizes marquee.click links and nothing else", () => {
  assert.ok(marqueeClickPlugin.match("https://marquee.click/path/to/output"));
  assert.ok(!marqueeClickPlugin.match("https://marquee.click"));
  assert.ok(!marqueeClickPlugin.match("https://example.org/marquee.click/nope"));
});

test("renders the path in strong, escaped, at full level only", () => {
  const html = marqueeClickPlugin.render("https://marquee.click/path/to/output", {
    level: "full",
    data: undefined,
  });
  assert.equal(html, '<strong class="marquee-click-path">/path/to/output</strong>');
  const sneaky = marqueeClickPlugin.render("https://marquee.click/<b>bold</b>?q=1", {
    level: "full",
    data: undefined,
  });
  assert.equal(
    sneaky,
    '<strong class="marquee-click-path">/&lt;b&gt;bold&lt;/b&gt;</strong>',
    "author bytes escaped, query dropped",
  );
  assert.equal(
    marqueeClickPlugin.render("https://marquee.click/x", { level: "title", data: undefined }),
    null,
    "declines below full: the plain-link floor takes over",
  );
});

test("its skin travels with it through turbolinkStyles", () => {
  const css = turbolinkStyles([marqueeClickPlugin, ...defaultPlugins]);
  assert.ok(css.includes("rebeccapurple"), "the plugin's declared css is collected");
  assert.ok(css.includes(".mq-turbolink-card"), "the card baseline is always present");
});

test("composes ahead of the default set", () => {
  const chain = composeTurbolinks([marqueeClickPlugin, ...defaultPlugins]);
  assert.equal(
    chain("https://marquee.click/hello", "full"),
    '<strong class="marquee-click-path">/hello</strong>',
  );
  assert.ok(chain("https://youtu.be/dQw4w9WgXcQ", "full")!.includes("nocookie"), "others still work");
});
