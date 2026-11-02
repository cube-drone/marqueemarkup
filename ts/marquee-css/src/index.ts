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
// convenience, not the primary artifact). The string goes out over the wire,
// often inlined into every page, so it leaves the file's comments behind.

import { readFileSync } from "node:fs";

/** Strip CSS comments and indentation, keeping `/*!` notices (a license has to
 * travel with the code). A comment becomes a space, because in CSS it separates
 * tokens; quoted strings are skipped whole, because a data: URI can say anything.
 * Kept in lockstep with the Rust crate's copy. */
export function stripCssComments(css: string): string {
  let out = "";
  let i = 0;
  let quote = "";
  while (i < css.length) {
    const c = css[i]!;
    if (quote !== "") {
      out += c;
      if (c === "\\" && i + 1 < css.length) {
        out += css[i + 1]!;
        i += 1;
      } else if (c === quote) {
        quote = "";
      }
      i += 1;
    } else if (c === '"' || c === "'") {
      quote = c;
      out += c;
      i += 1;
    } else if (c === "/" && css[i + 1] === "*") {
      const close = css.indexOf("*/", i + 2);
      const end = close === -1 ? css.length : close + 2;
      out += css[i + 2] === "!" ? css.slice(i, end) : " ";
      i = end;
    } else {
      out += c;
      i += 1;
    }
  }
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .join("\n");
}

export const marqueeCss: string = stripCssComments(
  readFileSync(new URL("../marquee.css", import.meta.url), "utf8"),
);
