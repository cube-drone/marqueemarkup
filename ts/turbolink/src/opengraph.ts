// The OpenGraph fallback: the one default plugin that touches the network,
// and only ever in its resolve() phase - never during render. Compose it
// LAST so the shaped plugins (YouTube, media) win their own kinds.

import { renderCard, type TurbolinkSummary } from "./card.ts";
import type { TurbolinkPlugin } from "./index.ts";

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

function decodeEntities(s: string): string {
  return s
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
}

/** Pure and separately testable: html text in, summary out. */
export function parseOpenGraph(html: string): TurbolinkSummary | null {
  const head = html.slice(0, 65536); // metadata lives up top; stay bounded
  const meta = (prop: string): string | undefined => {
    const tag = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*>`, "i").exec(
      head,
    )?.[0];
    if (tag === undefined) {
      return undefined;
    }
    const content = /content=["']([^"']*)["']/i.exec(tag)?.[1];
    return content === undefined || content === "" ? undefined : decodeEntities(content);
  };
  const summary: TurbolinkSummary = {};
  const title = meta("og:title") ?? /<title[^>]*>([^<]*)<\/title>/i.exec(head)?.[1]?.trim();
  if (title !== undefined && title !== "") {
    summary.title = decodeEntities(title);
  }
  const description = meta("og:description") ?? meta("description");
  if (description !== undefined) {
    summary.description = description;
  }
  const image = meta("og:image");
  if (image !== undefined) {
    summary.image = image;
  }
  const site = meta("og:site_name");
  if (site !== undefined) {
    summary.site = site;
  }
  return summary.title === undefined ? null : summary;
}

export const opengraphPlugin: TurbolinkPlugin = {
  name: "opengraph",
  match: (t) => /^https?:\/\//.test(t),
  async resolve(target) {
    const res = await fetch(target, { headers: { "user-agent": UA } });
    if (!res.ok) {
      return null;
    }
    return parseOpenGraph(await res.text());
  },
  render(target, { level, data }) {
    if (data === undefined || data === null) {
      return null; // nothing resolved: decline to the plain-link floor
    }
    return renderCard(target, data as TurbolinkSummary, level);
  },
};
