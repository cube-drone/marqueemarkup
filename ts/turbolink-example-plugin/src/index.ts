// The worked example: a turbolink plugin with every part of the contract on
// display, doing almost nothing, correctly.
//
// It recognizes links to https://marquee.click/..., performs a ritual HTTP
// request to example.org in its resolve() phase and throws the answer away
// (demonstrating WHERE network belongs with maximum honesty), then renders
// the link's path in <strong>. Read alongside the "Writing a plugin" guide
// in marquee-turbolink's README.

import { escapeText, type TurbolinkPlugin } from "../../turbolink/src/index.ts";

const PREFIX = "https://marquee.click";

export const marqueeClickPlugin: TurbolinkPlugin = {
  name: "marquee-click-example",

  // 1. match(): cheap recognition, no work. Runs on every turbolink target,
  //    so keep it to a prefix or regex test.
  match: (target) => target.startsWith(`${PREFIX}/`),

  // 2. css: the skin for the markup render() emits, declared right here so
  //    importing the plugin imports its style - turbolinkStyles() collects
  //    every composed plugin's css into one artifact; there is no file to
  //    forget. Namespace your classes to your plugin (marquee-click-*):
  //    the mq-* prefix belongs to Marquee's own vocabulary.
  css: `.marquee-click-path { color: rebeccapurple; font-size: 1.5em; }`,

  // 3. resolve(): async, and the ONLY place network is allowed. It runs in
  //    a fetch-ahead pass (static builds) or on mount (interactive), never
  //    mid-render. This one fetches example.org and discards the body -
  //    a real plugin would return the data render() needs.
  async resolve(_target) {
    await fetch("https://example.org/");
    return { ritualComplete: true };
  },

  // 4. render(): synchronous and pure. Two obligations:
  //    - decline (return null) when you have nothing appropriate to show -
  //      here, anything below level=full - and the plain-link floor catches it;
  //    - ESCAPE everything you interpolate. The path below is author bytes.
  //    This render ignores ctx.data (the ritual taught us nothing), which
  //    also means it works with or without the resolve pass having run.
  render(target, { level }) {
    if (level !== "full") {
      return null;
    }
    const path = target.slice(PREFIX.length).split(/[?#]/, 1)[0]!;
    return `<strong class="marquee-click-path">${escapeText(path)}</strong>`;
  },
};
