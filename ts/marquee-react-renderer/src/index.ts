// @cube-drone/marquee-react: the interactive renderer.
//
// Pair it with @cube-drone/marquee-css (the mq-* class contract, shared with
// the static renderer) and, optionally, @cube-drone/marquee-fonts. This
// package renders; it does not ship stylesheets, because the stylesheet is a
// shared artifact rather than this renderer's private business.

export { Marquee } from "./Marquee.ts";
export type { MarqueeHandle, MarqueeProps } from "./Marquee.ts";
export type { ReactHooks } from "./render.ts";
// Locating a cursor in the tree - pure, and useful to any host doing its
// own DOM work (the component uses exactly these).
export { nodeAt, nodeNear } from "./locate.ts";

// The toolbox underneath, re-exported: the same parser, the same Profile
// socket, so an embedder's policy is written once and honored by both
// renderers.
export { parse, parseWithPositions, UnsupportedVersionError } from "@cube-drone/marquee-parser";
export type { Attrs, Node, Reason, Span } from "@cube-drone/marquee-parser";
export { bareWebProfile, FONTS } from "@cube-drone/marquee-html-renderer";
export type {
  EmojiResolution,
  MediaResolution,
  Profile,
  TurbolinkLevel,
} from "@cube-drone/marquee-html-renderer";
