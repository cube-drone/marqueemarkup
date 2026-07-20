// marquee-turbolink's own tests: plugin recognition, rendering, the compose
// chain, the card's escaping, and the OpenGraph parser - all fetchless
// (resolve() is exercised with a stub; parseOpenGraph with fixtures).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  audioPlugin,
  composeTurbolinks,
  defaultPlugins,
  imagePlugin,
  mapsPlugin,
  opengraphPlugin,
  parseOpenGraph,
  renderCard,
  resolveTargets,
  spotifyPlugin,
  turbolinkStyles,
  turbolinkTargets,
  videoPlugin,
  youtubePlugin,
  type TurbolinkPlugin,
} from "../src/index.ts";
import { parse } from "@cube-drone/marquee-parser";

test("youtube: watch and short URLs become nocookie embeds; title declines", () => {
  for (const url of [
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ",
    "https://www.youtube.com/watch?list=x&v=dQw4w9WgXcQ",
  ]) {
    assert.ok(youtubePlugin.match(url), url);
    const html = youtubePlugin.render(url, { level: "full", data: undefined });
    assert.ok(html!.includes("youtube-nocookie.com/embed/dQw4w9WgXcQ"), url);
    assert.ok(html!.includes("mq-frame-video"));
  }
  assert.equal(youtubePlugin.render("https://youtu.be/dQw4w9WgXcQ", { level: "title", data: undefined }), null);
  assert.ok(!youtubePlugin.match("https://example.org/watch?v=nope"));
});

test("spotify: track height differs from playlist height", () => {
  const track = spotifyPlugin.render("https://open.spotify.com/track/abc123DEF", { level: "full", data: undefined });
  const playlist = spotifyPlugin.render("https://open.spotify.com/playlist/xyz789", { level: "full", data: undefined });
  assert.ok(track!.includes('height="152"') && track!.includes("/embed/track/abc123DEF"));
  assert.ok(playlist!.includes('height="352"') && playlist!.includes("/embed/playlist/xyz789"));
});

test("maps: google link with coordinates becomes an OSM embed; without, declines", () => {
  const url = "https://www.google.com/maps/place/Mulberry+St/@40.7192,-73.9973,17z";
  assert.ok(mapsPlugin.match(url));
  const html = mapsPlugin.render(url, { level: "full", data: undefined });
  assert.ok(html!.includes("openstreetmap.org/export/embed.html"));
  assert.ok(html!.includes("marker=40.71920%2C-73.99730"));
  assert.equal(mapsPlugin.render(url, { level: "title", data: undefined }), null);
  assert.ok(!mapsPlugin.match("https://www.google.com/maps?q=just+a+query"), "no coords: floor");
});

test("media plugins: extension recognition, medium boxes, controls", () => {
  const img = imagePlugin.render("https://e.x/cat.jpg?size=big", { level: "full", data: undefined });
  assert.ok(img!.includes('img class="mq-turbolink-image"') && img!.includes("cat.jpg?size=big"));
  const audio = audioPlugin.render("https://e.x/song.mp3", { level: "full", data: undefined });
  assert.ok(audio!.includes("<audio") && audio!.includes("controls"));
  const video = videoPlugin.render("https://e.x/clip.mp4", { level: "full", data: undefined });
  assert.ok(video!.includes("<video") && video!.includes("controls"));
  assert.ok(!imagePlugin.match("https://e.x/page.html"));
});

test("compose: first matching renderer wins; decliners fall through", () => {
  const chain = composeTurbolinks([youtubePlugin, ...defaultPlugins]);
  assert.ok(chain("https://youtu.be/dQw4w9WgXcQ", "full")!.includes("nocookie"));
  assert.equal(chain("https://e.x/just-a-page", "full"), null, "nothing matches: null (the floor)");
  assert.equal(chain("https://youtu.be/dQw4w9WgXcQ", "title"), null, "all decline title: null");
});

test("renderCard: fields escaped, levels respected", () => {
  const card = renderCard(
    "https://e.x/p",
    { title: "T <script>", description: "D & d", image: "https://e.x/i.png", site: "e.x" },
    "full",
  );
  assert.ok(card.includes("T &lt;script&gt;") && card.includes("D &amp; d"));
  assert.ok(card.includes("mq-turbolink-thumb"));
  const titleOnly = renderCard("https://e.x/p", { title: "T", description: "D" }, "title");
  assert.ok(!titleOnly.includes("mq-turbolink-desc"), "title level omits description");
  const bareSummary = renderCard("https://e.x/p", {}, "full");
  assert.ok(bareSummary.includes(">https://e.x/p</a>"), "no title: target is the title");
});

test("parseOpenGraph: og tags, entity decoding, title fallback, no-title null", () => {
  const og = parseOpenGraph(`<html><head>
    <title>Fallback</title>
    <meta property="og:title" content="Real &amp; True">
    <meta property="og:description" content="About stuff">
    <meta property="og:image" content="https://e.x/og.png">
    <meta property="og:site_name" content="Example">
  </head></html>`);
  assert.deepEqual(og, {
    title: "Real & True",
    description: "About stuff",
    image: "https://e.x/og.png",
    site: "Example",
  });
  const fallback = parseOpenGraph("<title>Just a Title</title>");
  assert.equal(fallback!.title, "Just a Title");
  assert.equal(parseOpenGraph("<p>nothing here</p>"), null);
});

test("turbolinkStyles: skins collected once, shared chunks deduped", () => {
  const css = turbolinkStyles(defaultPlugins);
  assert.equal(css.split(".mq-turbolink-frame {").length - 1, 1, "youtube+spotify share one chunk");
  assert.equal(css.split(".mq-turbolink-image {").length - 1, 1, "three media plugins, one chunk");
  assert.ok(css.includes(".mq-turbolink-card"), "the card baseline is always included");
  assert.ok(turbolinkStyles([]).includes(".mq-turbolink-card"), "even with no plugins");
});

test("resolveTargets feeds compose; opengraph renders resolved data", async () => {
  const fake: TurbolinkPlugin = {
    ...opengraphPlugin,
    resolve: async () => ({ title: "Fetched Ahead", site: "e.x" }),
  };
  const resolved = await resolveTargets(["https://e.x/post"], [fake]);
  const chain = composeTurbolinks([fake], resolved);
  const html = chain("https://e.x/post", "full");
  assert.ok(html!.includes("Fetched Ahead"), "resolve phase data reaches render phase");
  assert.equal(composeTurbolinks([fake])("https://e.x/post", "full"), null, "no resolve pass: floor");
});

test("resolveTargets: targets resolve concurrently, plugin order per target holds", async () => {
  let active = 0;
  let maxActive = 0;
  const order: string[] = [];
  const slow = (name: string, data: unknown): TurbolinkPlugin => ({
    name,
    match: () => true,
    resolve: async (target) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 20));
      active -= 1;
      order.push(`${name}:${target}`);
      return data;
    },
    render: () => null,
  });
  const first = slow("first", { won: true });
  const second = slow("second", { won: false });
  const resolved = await resolveTargets(["t://a", "t://b", "t://c"], [first, second]);
  assert.equal(maxActive, 3, "all targets in flight at once");
  assert.ok(resolved.has("first\nt://a") && !resolved.has("second\nt://a"), "first resolver wins per target");
  assert.equal(order.filter((o) => o.startsWith("second")).length, 0, "the winner short-circuits the chain");
});

test("resolveTargets: concurrency bounds simultaneous resolves", async () => {
  let active = 0;
  let maxActive = 0;
  const slow: TurbolinkPlugin = {
    name: "slow",
    match: () => true,
    resolve: async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 15));
      active -= 1;
      return { ok: true };
    },
    render: () => null,
  };
  const many = ["a", "b", "c", "d", "e", "f"].map((t) => `t://${t}`);
  await resolveTargets(many, [slow], { concurrency: 2 });
  assert.equal(maxActive, 2, "never more than the limit in flight at once");
});

test("turbolinkTargets: the fetch-ahead shopping list from a real document", () => {
  const doc = parse("https://e.x/one\n\n:::turbolink target=https://e.x/two level=title:::\n\nprose\n");
  assert.deepEqual(turbolinkTargets(doc), ["https://e.x/one", "https://e.x/two"]);
});
