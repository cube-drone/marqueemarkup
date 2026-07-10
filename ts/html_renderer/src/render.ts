// AST -> HTML string. The safety contract: author bytes reach the output
// only through escapeText/escapeAttr, targets only through the profile's
// allowlist, and attribute *names* are never author-controlled. Unknown
// vocabulary shrugs (children survive, effect doesn't); comments render
// nothing; invalid constructs render inert placeholders.

import type { Attrs, Node } from "../../parser/src/index.ts";
import { bareWebProfile, type Profile } from "./profile.ts";

export function render(node: Node, profile: Profile = bareWebProfile): string {
  switch (node.type) {
    case "document":
      return `<div class="mq-doc">${children(node.children, profile)}</div>`;
    case "paragraph":
      return `<p>${children(node.children, profile)}</p>`;
    case "heading":
      return `<h${node.level}>${children(node.children, profile)}</h${node.level}>`;
    case "code_block": {
      const lang = infoToken(node.info);
      const cls = lang === null ? "" : ` class="language-${escapeAttr(lang)}"`;
      const text = node.text === "" ? "" : `${escapeText(node.text)}\n`;
      return `<pre class="mq-code"><code${cls}>${text}</code></pre>`;
    }
    case "blockquote":
      return `<blockquote>${children(node.children, profile)}</blockquote>`;
    case "list": {
      const tag = node.ordered ? "ol" : "ul";
      return `<${tag}>${children(node.children, profile)}</${tag}>`;
    }
    case "list_item":
      return `<li>${children(node.children, profile)}</li>`;
    case "thematic_break":
      return "<hr>";
    case "directive":
      return directive(node.name, node.attrs, node.children, profile);
    case "invalid_directive":
      return `<div class="mq-invalid" data-reason="${escapeAttr(node.reason)}"></div>`;
    case "comment":
      return ""; // the anti-shrug: correct rendering is absence
    case "text":
      return escapeText(node.value);
    case "emphasis":
      return `<em>${children(node.children, profile)}</em>`;
    case "strong":
      return `<strong>${children(node.children, profile)}</strong>`;
    case "strikethrough":
      return `<del>${children(node.children, profile)}</del>`;
    case "code_span":
      return `<code>${escapeText(node.text)}</code>`;
    case "link": {
      const inner = children(node.children, profile);
      return profile.linkAllowed(node.target)
        ? `<a href="${escapeAttr(node.target)}">${inner}</a>`
        : `<span class="mq-blocked">${inner}</span>`;
    }
    case "embed":
      return embed(node.target, node.alt, profile);
    case "turbolink":
      return turbolink(node.target, profile);
    case "span":
      return span(node.name, node.attrs, node.children, profile);
    case "emoji": {
      const resolved = profile.emoji(node.slug);
      return escapeText(resolved ?? `:${node.slug}:`);
    }
    case "hard_break":
      return "<br>";
  }
}

function children(nodes: Node[], profile: Profile): string {
  return nodes.map((n) => render(n, profile)).join("");
}

// -- validation gates (closed value grammars; failures degrade, never emit)

const HEX_OR_TOKEN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$|^[a-z][a-z0-9-]{0,31}$/;
const TOKEN = /^[a-z][a-z0-9-]{0,31}$/;
const COUNT = /^[0-9]{1,4}$/;

function isColorValue(v: string | undefined): v is string {
  return v !== undefined && HEX_OR_TOKEN.test(v);
}

function isToken(v: string | undefined): v is string {
  return v !== undefined && TOKEN.test(v);
}

const MEDIA_SIZE_TOKENS: Record<string, string> = {
  small: "10rem",
  medium: "20rem",
  large: "32rem",
  full: "100%",
};

/** Media width/height: a size token or a capped integer of pixels (SPEC.md,
 * "Media"). Anything else degrades to natural sizing. */
function mediaSize(v: string | undefined): string | null {
  if (v === undefined) {
    return null;
  }
  const token = MEDIA_SIZE_TOKENS[v];
  if (token !== undefined) {
    return token;
  }
  if (/^[0-9]{1,4}$/.test(v)) {
    const n = Number(v);
    if (n >= 1 && n <= 4096) {
      return `${n}px`;
    }
  }
  return null;
}

function infoToken(info: string | undefined): string | null {
  if (info === undefined) {
    return null;
  }
  const first = info.split(/[ \t]/, 1)[0]!;
  return /^[A-Za-z0-9_+.#-]{1,64}$/.test(first) ? first : null;
}

// -- constructs

function embed(target: string, alt: string, profile: Profile): string {
  const media = profile.media(target);
  if (media !== null) {
    const url = escapeAttr(media.url);
    switch (media.kind) {
      case "image":
        return `<img class="mq-embed" src="${url}" alt="${escapeAttr(alt)}" loading="lazy">`;
      case "audio":
        return `<audio class="mq-embed" controls src="${url}" aria-label="${escapeAttr(alt)}"></audio>`;
      case "video":
        return `<video class="mq-embed" controls src="${url}" aria-label="${escapeAttr(alt)}"></video>`;
    }
  }
  // The contractual shrug applied to media: degrade to a labeled link, or
  // to inert text when the scheme is out of policy.
  const label = escapeText(`[${alt === "" ? target : alt}]`);
  return profile.linkAllowed(target)
    ? `<a class="mq-embed-fallback" href="${escapeAttr(target)}">${label}</a>`
    : `<span class="mq-embed-fallback">${label}</span>`;
}

function turbolink(target: string, profile: Profile): string {
  const enriched = profile.turbolink(target);
  if (enriched !== null) {
    return enriched;
  }
  const text = escapeText(target);
  return profile.linkAllowed(target)
    ? `<p class="mq-turbolink"><a href="${escapeAttr(target)}">${text}</a></p>`
    : `<p class="mq-turbolink">${text}</p>`;
}

/** Style knobs on a block node: validated values into --mq-* slots; the
 * stylesheet owns which CSS property each slot feeds. */
function styleVars(attrs: Attrs): string {
  const vars: string[] = [];
  if (isColorValue(attrs["color"])) {
    vars.push(`--mq-color:${attrs["color"]}`);
  }
  if (isColorValue(attrs["background"])) {
    vars.push(`--mq-bg:${attrs["background"]}`);
  }
  return vars.length === 0 ? "" : ` style="${vars.join(";")}"`;
}

function schemeClass(attrs: Attrs): string {
  return isToken(attrs["scheme"]) ? ` mq-scheme-${attrs["scheme"]}` : "";
}

function directive(name: string, attrs: Attrs, nodes: Node[], profile: Profile): string {
  const inner = children(nodes, profile);
  const custom = profile.directive(name, attrs, inner);
  if (custom !== null) {
    return custom;
  }
  switch (name) {
    case "meta":
      // Carries metadata, renders nothing by default - but never eats an
      // (unconventional) body.
      return inner;
    case "page": {
      const layout = isToken(attrs["layout"]) ? ` mq-layout-${attrs["layout"]}` : "";
      return `<div class="mq-page${layout}${schemeClass(attrs)}"${styleVars(attrs)}>${inner}</div>`;
    }
    case "section": {
      const slot = isToken(attrs["slot"]) ? ` data-slot="${attrs["slot"]}"` : "";
      return `<section class="mq-section${schemeClass(attrs)}"${slot}${styleVars(attrs)}>${inner}</section>`;
    }
    case "turbolink": {
      const target = attrs["target"];
      if (target !== undefined) {
        return turbolink(target, profile);
      }
      break; // malformed use: fall through to the placeholder
    }
    case "media": {
      const vars: string[] = [];
      const w = mediaSize(attrs["width"]);
      const h = mediaSize(attrs["height"]);
      if (w !== null) {
        vars.push(`--mq-media-w:${w}`);
      }
      if (h !== null) {
        vars.push(`--mq-media-h:${h}`);
      }
      const style = vars.length === 0 ? "" : ` style="${vars.join(";")}"`;
      return `<div class="mq-media"${style}>${inner}</div>`;
    }
  }
  // Unknown vocabulary: a container renders its children with an affordance
  // that something wrapped them; a leaf renders the inert placeholder.
  // Never eat authored content.
  return nodes.length > 0
    ? `<div class="mq-unknown" data-directive="${escapeAttr(name)}">${inner}</div>`
    : `<div class="mq-placeholder" data-directive="${escapeAttr(name)}"></div>`;
}

/** Effect/typographic spans. The `<font>` tag is deliberate: presentational
 * attributes are outside CSP's jurisdiction and are implemented by the
 * browser itself, so color survives with no stylesheet and no style
 * attributes - the floor of the degradation ladder. The --mq-color slot is
 * the stylesheet-era ceiling on the same element. */
function span(name: string, attrs: Attrs, nodes: Node[], profile: Profile): string {
  const inner = children(nodes, profile);
  const custom = profile.span(name, attrs, inner);
  if (custom !== null) {
    return custom;
  }
  switch (name) {
    case "sup":
      return `<sup>${inner}</sup>`;
    case "sub":
      return `<sub>${inner}</sub>`;
    case "small":
      return `<small>${inner}</small>`;
    case "color": {
      const value = attrs["color"];
      if (isColorValue(value)) {
        return `<font class="mq-color" color="${value}" style="--mq-color:${value}">${inner}</font>`;
      }
      return inner; // invalid value: the effect degrades, the words survive
    }
    case "sidenote":
      return `<span class="mq-sidenote" role="note">${inner}</span>`;
    case "marquee": {
      const dir = isToken(attrs["direction"]) ? ` data-direction="${attrs["direction"]}"` : "";
      const speed = attrs["speed"] !== undefined && COUNT.test(attrs["speed"])
        ? ` style="--mq-speed:${attrs["speed"]}"`
        : "";
      return `<span class="mq-marquee"${dir}${speed}><span class="mq-marquee-inner">${inner}</span></span>`;
    }
    case "blink": {
      const rate = attrs["rate"] !== undefined && COUNT.test(attrs["rate"])
        ? ` style="--mq-rate:${attrs["rate"]}"`
        : "";
      return `<span class="mq-blink"${rate}>${inner}</span>`;
    }
    case "rainbow":
    case "bounce":
    case "jitter":
    case "wave":
    case "typewriter":
      return `<span class="mq-${name}">${inner}</span>`;
  }
  return inner; // unknown span: pure shrug, children as plain content
}

// -- escaping (the only paths author bytes may take into markup)

export function escapeText(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function escapeAttr(s: string): string {
  return escapeText(s).replaceAll('"', "&quot;");
}
