// marquee-turbolink: link expanders as plugins.
//
// A plugin owns the *presentation* of the link kinds it recognizes - an
// image in a medium box, audio controls, a playable YouTube embed, a Spotify
// widget, a host platform's native content, the Binglebongle plugin of 2035.
// The
// Marquee renderer owns only the floor (a plain link, always) and the socket
// (Profile.turbolink). Embedders compose the chain they trust.
//
// Two phases, deliberately split:
//   resolve() - async, MAY touch the network (OpenGraph fetches). Runs in a
//               fetch-ahead pass (static rendering) or on mount (interactive).
//   render()  - sync, pure, deterministic given resolved data. This is what
//               the renderer calls; nothing fetches mid-render, ever.
//
// Plugins are embedder-trusted code (like Profile.directive): author bytes
// only ever enter as the `target` string - escape everything you interpolate
// (escapeText/escapeAttr are exported for exactly that).

import type { Node } from "@cube-drone/marquee-parser";

export type TurbolinkLevel = "full" | "title" | "bare";

export interface TurbolinkContext {
  level: TurbolinkLevel;
  /** Whatever this plugin's resolve() produced for this target, if it ran. */
  data: unknown;
}

export interface TurbolinkPlugin {
  name: string;
  /** Cheap recognition; render()/resolve() run only when this is true. */
  match(target: string): boolean;
  /** Optional async gathering - the ONLY place network is allowed. */
  resolve?(target: string): Promise<unknown>;
  /** Sync and pure. Return HTML, or null to decline (the chain continues;
   * the renderer's plain-link floor catches everything). */
  render(target: string, ctx: TurbolinkContext): string | null;
  /** The stylesheet for the markup render() emits, as a string - collected
   * by turbolinkStyles(), so importing a plugin imports its skin and no
   * per-plugin file scavenger hunt exists. Plugins sharing rules assign the
   * same string constant (aggregation dedupes by content). */
  css?: string;
}

/** Everything the composed chain needs styled, once: the standard card's
 * skin (renderCard is the library's keyhole, so its skin is baseline) plus
 * each plugin's declared css, deduplicated. Emit it in a <style> block or
 * write it to a bundle file at build time - either way it's one artifact
 * derived from the same list you composed. */
export function turbolinkStyles(plugins: TurbolinkPlugin[]): string {
  const chunks = new Set<string>([cardCss]);
  for (const plugin of plugins) {
    if (plugin.css !== undefined) {
      chunks.add(plugin.css);
    }
  }
  return [...chunks].join("\n");
}

/** Compose a plugin chain into the shape Profile.turbolink wants. First
 * plugin that matches AND renders wins. */
export function composeTurbolinks(
  plugins: TurbolinkPlugin[],
  resolved?: Map<string, unknown>,
): (target: string, level: TurbolinkLevel) => string | null {
  return (target, level) => {
    for (const plugin of plugins) {
      if (!plugin.match(target)) {
        continue;
      }
      const data = resolved?.get(`${plugin.name}\n${target}`);
      const html = plugin.render(target, { level, data });
      if (html !== null) {
        return html;
      }
    }
    return null;
  };
}

/** The fetch-ahead pass: run every matching plugin's resolve() over a
 * target list, yielding the map composeTurbolinks() consumes. */
export async function resolveTargets(
  targets: string[],
  plugins: TurbolinkPlugin[],
): Promise<Map<string, unknown>> {
  const resolved = new Map<string, unknown>();
  for (const target of new Set(targets)) {
    for (const plugin of plugins) {
      if (plugin.resolve === undefined || !plugin.match(target)) {
        continue;
      }
      try {
        const data = await plugin.resolve(target);
        if (data !== null && data !== undefined) {
          resolved.set(`${plugin.name}\n${target}`, data);
          break; // first resolver wins, like first renderer
        }
      } catch {
        // a failed fetch is a plain link, not a failed render
      }
    }
  }
  return resolved;
}

/** Every turbolink target in a parsed document (bare-paragraph nodes and
 * explicit :::turbolink directives) - the fetch-ahead pass's shopping list. */
export function turbolinkTargets(node: Node): string[] {
  const targets: string[] = [];
  (function walk(n: Node): void {
    if (n.type === "turbolink") {
      targets.push(n.target);
    }
    if (n.type === "directive" && n.name === "turbolink" && n.attrs["target"] !== undefined) {
      targets.push(n.attrs["target"]);
    }
    if ("children" in n) {
      for (const child of n.children) {
        walk(child);
      }
    }
  })(node);
  return targets;
}

import { cardCss } from "./card.ts";

export { escapeAttr, escapeText } from "./escape.ts";
export { cardCss, renderCard, type TurbolinkSummary } from "./card.ts";
export {
  audioPlugin,
  defaultPlugins,
  imagePlugin,
  mapsPlugin,
  spotifyPlugin,
  videoPlugin,
  youtubePlugin,
} from "./plugins.ts";
export { opengraphPlugin, parseOpenGraph } from "./opengraph.ts";
