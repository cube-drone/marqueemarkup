// The standard summary card - the safe keyhole. Plugins that just have
// facts (title, description, image, site) call this and inherit the shared
// mq-turbolink-* look and its escaping; plugins with richer ideas write
// their own markup and own their own escaping.

import { escapeAttr, escapeText } from "./escape.ts";
import type { TurbolinkLevel } from "./index.ts";

export interface TurbolinkSummary {
  title?: string;
  description?: string;
  image?: string;
  site?: string;
}

function siteOf(target: string): string | undefined {
  const m = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/([^/]+)/.exec(target);
  return m?.[1];
}

/** The card's skin. Always included by turbolinkStyles() - the keyhole's
 * look is the library baseline, whichever plugins use it. */
export const cardCss = `.mq-turbolink-card {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 0.15rem 0.75rem;
  border: 1px solid rgba(136, 136, 136, 0.33);
  border-left-width: 4px;
  border-radius: 0.375rem;
  padding: 0.5rem 0.75rem;
}
.mq-turbolink-site { font-size: 0.8em; opacity: 0.6; }
.mq-turbolink-title { font-weight: 600; text-decoration: none; }
.mq-turbolink-desc { font-size: 0.9em; opacity: 0.85; }
.mq-turbolink-thumb {
  grid-column: 2;
  grid-row: 1 / span 3;
  width: 6rem;
  height: 6rem;
  object-fit: cover;
  border-radius: 0.25rem;
}`;

export function renderCard(
  target: string,
  summary: TurbolinkSummary,
  level: TurbolinkLevel,
): string {
  const href = escapeAttr(target);
  const site = summary.site ?? siteOf(target);
  let card = "";
  if (site !== undefined) {
    card += `<span class="mq-turbolink-site">${escapeText(site)}</span>`;
  }
  card += `<a class="mq-turbolink-title" href="${href}">${escapeText(summary.title ?? target)}</a>`;
  if (level === "full" && summary.description !== undefined) {
    card += `<span class="mq-turbolink-desc">${escapeText(summary.description)}</span>`;
  }
  if (level === "full" && summary.image !== undefined) {
    card += `<img class="mq-turbolink-thumb" src="${escapeAttr(summary.image)}" alt="" loading="lazy">`;
  }
  return `<span class="mq-turbolink-card">${card}</span>`;
}
