// Reference static HTML renderer for the Marquee markup language.
//
// Emits an HTML *fragment* (one `<div class="mq-doc">` subtree) that the
// embedder places in a page alongside css/marquee.css. Best-effort CSS
// motion; the JS halves of the animation contract (start-on-visibility,
// tap-to-skip) belong to the interactive renderer.

import { parse } from "@cube-drone/marquee-parser";
import { render, type RenderOptions } from "./render.ts";
import type { Profile } from "./profile.ts";

export { render, type RenderOptions, escapeText, escapeAttr, FONTS, usedFontTokens, containerLook } from "./render.ts";
export { bareWebProfile } from "./profile.ts";
export { EFFECT_NAMES, effectLook, splitPieces, type EffectLook, type EffectUnit, type SplitPiece } from "./effects.ts";
export type { EmojiResolution, Profile, MediaResolution, TurbolinkLevel } from "./profile.ts";

/** Parse and render in one step. Throws UnsupportedVersionError for unknown
 * dialect versions, exactly as the parser does. `{ output: "xhtml" }` for a
 * page that must be well-formed XML, like an ePub's. */
export function renderMarquee(source: string, profile?: Profile, options?: RenderOptions): string {
  return render(parse(source), profile, options);
}
