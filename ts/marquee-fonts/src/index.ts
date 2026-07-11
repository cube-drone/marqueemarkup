// @classam/marquee-fonts: the grab bag, deliverable two ways.
//
// This package is OPTIONAL. The renderer works fully without it - every
// font name degrades to its fallback stack, readable always. Install it
// when you want the actual faces, then pick a delivery:
//
//   external files (a real site: cacheable, shared across pages)
//     copy fontFilePath(token) for each used token; emit externalFontFaces()
//
//   inline base64 (a self-contained single-file page, "near-magically")
//     const styles = inlineFontFaces(usedFontTokens(html))
//
// usedFontTokens() comes from @classam/marquee-html-renderer, which owns the
// mq-font-* class contract. Fonts are never fetched from a third-party CDN;
// that is the point of this package existing.

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Token -> family for every face this package ships. Must stay consistent
 * with the renderer's FONTS vocabulary (a test enforces it). The four
 * standard stacks (sans/serif/mono/comic) are deliberately absent: they are
 * fallback stacks, not files. */
export const FONT_MANIFEST: Record<string, string> = {
  "radio-canada": "Radio Canada",
  "atkinson-hyperlegible": "Atkinson Hyperlegible",
  lexend: "Lexend",
  "zilla-slab": "Zilla Slab",
  "playfair-display": "Playfair Display",
  cormorant: "Cormorant",
  "im-fell-english": "IM Fell English",
  "uncial-antiqua": "Uncial Antiqua",
  unifraktur: "UnifrakturMaguntia",
  "jetbrains-mono": "JetBrains Mono",
  vt323: "VT323",
  "press-start": "Press Start 2P",
  silkscreen: "Silkscreen",
  "major-mono": "Major Mono Display",
  orbitron: "Orbitron",
  bungee: "Bungee",
  monoton: "Monoton",
  creepster: "Creepster",
  "special-elite": "Special Elite",
  fredericka: "Fredericka the Great",
  lobster: "Lobster",
  pacifico: "Pacifico",
  caveat: "Caveat",
  "comic-neue": "Comic Neue",
  audiowide: "Audiowide",
  kablammo: "Kablammo",
  "henny-penny": "Henny Penny",
  oi: "Oi",
  rye: "Rye",
  bitcount: "Bitcount",
  quicksand: "Quicksand",
};

/** Absolute path to a face's WOFF2 within this package, for copiers
 * (site builders shipping fonts/ next to their pages). Null for unknown
 * tokens or faces that haven't been fetched. */
export function fontFilePath(token: string): string | null {
  if (FONT_MANIFEST[token] === undefined) {
    return null;
  }
  const path = fileURLToPath(new URL(`../fonts/${token}.woff2`, import.meta.url));
  return existsSync(path) ? path : null;
}

function face(token: string, src: string): string {
  return `@font-face {\n  font-family: "${FONT_MANIFEST[token]}";\n  src: ${src};\n  font-display: swap;\n}`;
}

/** @font-face rules pointing at files you serve yourself, `${base}<token>.woff2`.
 * Unknown or unfetched tokens are skipped - fallback stacks handle them. */
export function externalFontFaces(tokens: Iterable<string>, base = "fonts/"): string {
  const rules: string[] = [];
  for (const token of [...new Set(tokens)].sort()) {
    if (fontFilePath(token) !== null) {
      rules.push(face(token, `url("${base}${token}.woff2") format("woff2")`));
    }
  }
  return rules.join("\n\n");
}

/** @font-face rules with the WOFF2 bytes inlined as base64 data URIs: a
 * fully self-contained page, no font files to host. Costs ~1.33x the font
 * size per face used - only the faces you pass are paid for. */
export function inlineFontFaces(tokens: Iterable<string>): string {
  const rules: string[] = [];
  for (const token of [...new Set(tokens)].sort()) {
    const path = fontFilePath(token);
    if (path !== null) {
      const data = readFileSync(path).toString("base64");
      rules.push(face(token, `url(data:font/woff2;base64,${data}) format("woff2")`));
    }
  }
  return rules.join("\n\n");
}
