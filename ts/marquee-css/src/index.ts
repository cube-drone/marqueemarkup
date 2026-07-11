// @cube-drone/marquee-css: the reference stylesheet, two ways.
//
// Browser/bundler consumers import the file itself:
//     import "@cube-drone/marquee-css/marquee.css";
// Node-side embedders (site builders, preview tools) take it as a string to
// inline or write wherever their shell wants it:
//     import { marqueeCss } from "@cube-drone/marquee-css";
//
// The file is the source of truth; this module just reads it (which is why
// this one asset package touches node:fs - the string export is a node-side
// convenience, not the primary artifact).

import { readFileSync } from "node:fs";

export const marqueeCss: string = readFileSync(
  new URL("../marquee.css", import.meta.url),
  "utf8",
);
