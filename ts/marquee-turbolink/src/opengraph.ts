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

const MAX_OG_BYTES = 128 * 1024;

/** Read at most maxBytes of the body, then cancel the stream. The metadata we
 * want lives in the first N KiB (parseOpenGraph caps its parse there too);
 * this bounds the *download*, so a hostile or merely huge page can't blow up a
 * build's memory before the parse cap ever applies. */
async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (res.body === null) {
    return "";
  }
  const reader = res.body.getReader();
  const buf = new Uint8Array(maxBytes);
  let len = 0;
  try {
    while (len < maxBytes) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      const take = Math.min(value.length, maxBytes - len);
      buf.set(value.subarray(0, take), len);
      len += take;
    }
  } finally {
    await reader.cancel().catch(() => undefined); // stop the transfer early
  }
  return new TextDecoder().decode(buf.subarray(0, len));
}

/** Resolve a possibly-relative URL against a base, keeping only http(s). An
 * og:image is relative to the page it came from, not our output; and a
 * `javascript:`/`data:` image src should never reach a reader's card. */
function absoluteHttp(url: string, base: string): string | undefined {
  try {
    const u = new URL(url, base);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : undefined;
  } catch {
    return undefined;
  }
}

export const opengraphPlugin: TurbolinkPlugin = {
  name: "opengraph",
  match: (t) => /^https?:\/\//.test(t),
  async resolve(target) {
    // Generous but finite: a hung server costs ten seconds, never a hung
    // build. (A timed-out fetch throws; resolveTargets already treats a
    // failed fetch as a plain link.)
    const res = await fetch(target, {
      headers: { "user-agent": UA },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      return null;
    }
    // A linked image/PDF/zip has no OpenGraph to find - don't stream a binary
    // body just to parse nothing. (Empty/absent type: allow, and let the
    // parse decide.)
    const type = res.headers.get("content-type") ?? "";
    if (type !== "" && !/text\/html|application\/xhtml|text\/plain/i.test(type)) {
      return null;
    }
    const summary = parseOpenGraph(await readCapped(res, MAX_OG_BYTES));
    if (summary !== null && summary.image !== undefined) {
      // res.url is the post-redirect URL: the right base for a relative image.
      const abs = absoluteHttp(summary.image, res.url || target);
      if (abs === undefined) {
        delete summary.image;
      } else {
        summary.image = abs;
      }
    }
    return summary;
  },
  render(target, { level, data }) {
    if (data === undefined || data === null) {
      return null; // nothing resolved: decline to the plain-link floor
    }
    return renderCard(target, data as TurbolinkSummary, level);
  },
};
