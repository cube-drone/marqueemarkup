// @cube-drone/marquee-emoji: the standard emoji shortcode table.
//
// The spec's position (SPEC.md, "Emoji") is that Marquee doesn't own the
// contested 3,000-entry shortcode table - it references the standard one.
// This package IS that reference, made installable: gemoji's slug ->
// character data repackaged verbatim. Custom image emoji stay where they
// belong - in the embedder's own table, layered on top.
//
// Dependency-free on purpose: any embedder (or non-Marquee project) can use
// the table without pulling in a parser or renderer.

import { STANDARD } from "./standard.ts";

/** gemoji's standard shortcode table: slug -> unicode character. */
export const standardEmoji: Readonly<Record<string, string>> = STANDARD;
