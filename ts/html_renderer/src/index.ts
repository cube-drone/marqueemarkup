// Reference static HTML renderer for the Marquee markup language.
//
// Emits an HTML *fragment* (one `<div class="mq-doc">` subtree) that the
// embedder places in a page alongside css/marquee.css. Best-effort CSS
// motion; the JS halves of the animation contract (start-on-visibility,
// tap-to-skip) belong to the interactive renderer.

import { parse } from "@cube-drone/marquee-parser";
import { render } from "./render.ts";
import type { Profile } from "./profile.ts";

export { render, escapeText, escapeAttr, FONTS, usedFontTokens } from "./render.ts";
export { bareWebProfile } from "./profile.ts";
export type { Profile, MediaResolution, TurbolinkLevel } from "./profile.ts";

/** Parse and render in one step. Throws UnsupportedVersionError for unknown
 * dialect versions, exactly as the parser does. */
export function renderMarquee(source: string, profile?: Profile): string {
  return render(parse(source), profile);
}
