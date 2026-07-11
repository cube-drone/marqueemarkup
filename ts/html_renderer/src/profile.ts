// Embedder profiles (SPEC.md, "Embedder profiles"): the language defines
// meaning, the embedder defines policy. Every render-time capability
// decision routes through here; the renderer itself never fetches, never
// guesses trust, never widens a scheme allowlist.

import type { Attrs } from "@cube-drone/marquee-parser";

export interface MediaResolution {
  kind: "image" | "audio" | "video";
  url: string;
}

export type TurbolinkLevel = "full" | "title" | "bare";

/** What an emoji slug becomes: replacement text, or a custom-emoji image. */
export type EmojiResolution = string | { image: string; alt?: string };

export interface Profile {
  /** May this target become a hyperlink? Disallowed links render their
   * children without an anchor (content survives, capability doesn't). */
  linkAllowed(target: string): boolean;
  /** Resolve an embed target to a media kind, or null for the inert
   * fallback. The kind is resolved at render time (SPEC.md, "Media"). */
  media(target: string): MediaResolution | null;
  /** Resolve an emoji slug: replacement text, or an image (the spec's
   * custom-emoji map is named indirection over an inline image), or null →
   * literal `:slug:`. The image URL is embedder-supplied configuration,
   * trusted like `directive` - author bytes only ever supply the slug. */
  emoji(slug: string): EmojiResolution | null;
  /** Rendered turbolink content for a target, or null → the plain-link
   * floor. Embedders compose this from plugins (see marquee-turbolink: an
   * image in a box, play controls, a YouTube embed, Ringtome-native
   * displays). Trusted embedder code, like `directive`: author bytes only
   * enter as the target string. MUST be sync and fetchless - gathering
   * happens in a plugin's resolve() phase, never mid-render. */
  turbolink(target: string, level: TurbolinkLevel): string | null;
  /** The default enrichment level for a target (spec: per-scheme embedder
   * policy); an explicit `level=` on `:::turbolink` wins over this. */
  turbolinkLevel(target: string): TurbolinkLevel;
  /** Embedder directive vocabulary (widgets, includes, computed). Return
   * rendered HTML, or null to fall through to the built-in handling. */
  directive(name: string, attrs: Attrs, renderedChildren: string): string | null;
  /** Embedder span vocabulary. Same contract as `directive`. */
  span(name: string, attrs: Attrs, renderedChildren: string): string | null;
}

const MEDIA_KINDS: Record<string, MediaResolution["kind"]> = {
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image",
  avif: "image", svg: "image",
  mp3: "audio", ogg: "audio", wav: "audio", flac: "audio", m4a: "audio",
  mp4: "video", webm: "video",
};

function scheme(target: string): string | null {
  const m = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(target);
  return m ? m[1]!.toLowerCase() : null;
}

/** The bare-web default: https links, extension-sniffed media, no widgets,
 * no emoji table, no enrichment. Everything an embedder doesn't decide
 * degrades inert. */
export const bareWebProfile: Profile = {
  linkAllowed(target) {
    const s = scheme(target);
    return s === null || s === "http" || s === "https" || s === "mailto";
  },
  media(target) {
    if (!this.linkAllowed(target)) {
      return null;
    }
    const path = target.split(/[?#]/, 1)[0]!;
    const ext = path.includes(".") ? path.slice(path.lastIndexOf(".") + 1).toLowerCase() : "";
    const kind = MEDIA_KINDS[ext];
    return kind === undefined ? null : { kind, url: target };
  },
  emoji: () => null,
  turbolink: () => null,
  turbolinkLevel: () => "full",
  directive: () => null,
  span: () => null,
};
