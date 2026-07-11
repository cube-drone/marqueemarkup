// Local escaping (duplicated from the html renderer on purpose: this
// library stands alone - plugins for other renderers shouldn't drag the
// HTML renderer in as a dependency).

export function escapeText(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function escapeAttr(s: string): string {
  return escapeText(s).replaceAll('"', "&quot;");
}
