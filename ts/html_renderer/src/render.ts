// AST -> HTML string. The safety contract: author bytes reach the output
// only through escapeText/escapeAttr, targets only through the profile's
// allowlist, and attribute *names* are never author-controlled. Unknown
// vocabulary shrugs (children survive, effect doesn't); comments render
// nothing; invalid constructs render inert placeholders.

import type { Attrs, Node } from "../../parser/src/index.ts";
import { bareWebProfile, type Profile, type TurbolinkLevel } from "./profile.ts";

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
      return turbolink(node.target, undefined, profile);
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

/** The font vocabulary (closed, two tiers): four standard stacks that need
 * no files, and the grab bag - SIL OFL faces the embedder serves itself
 * (never a third-party CDN: fonts are a tracking vector, care-modes apply).
 * Values are the `face` presentational attribute - the no-stylesheet floor;
 * the mq-font-* class is the ceiling, where the real @font-face lives. */
export const FONTS: Record<string, string> = {
  // standard stacks
  sans: "sans-serif",
  serif: "serif",
  mono: "monospace",
  comic: "Comic Sans MS",
  // the grab bag
  "radio-canada": "Radio Canada",
  "atkinson-hyperlegible": "Atkinson Hyperlegible",
  lexend: "Lexend",
  "zilla-slab": "Zilla Slab",
  "playfair-display": "Playfair Display",
  cormorant: "Cormorant",
  "im-fell-english": "IM Fell English",
  "uncial-antiqua": "Uncial Antiqua",
  unifraktur: "UnifrakturMaguntia",
  "jetbrains-mono": "JetBrains Mono",
  vt323: "VT323",
  "press-start": "Press Start 2P",
  silkscreen: "Silkscreen",
  "major-mono": "Major Mono Display",
  orbitron: "Orbitron",
  bungee: "Bungee",
  monoton: "Monoton",
  creepster: "Creepster",
  "special-elite": "Special Elite",
  fredericka: "Fredericka the Great",
  lobster: "Lobster",
  pacifico: "Pacifico",
  caveat: "Caveat",
  "comic-neue": "Comic Neue",
  audiowide: "Audiowide",
  kablammo: "Kablammo",
  "henny-penny": "Henny Penny",
  oi: "Oi",
  rye: "Rye",
  bitcount: "Bitcount",
  quicksand: "Quicksand",
};

/** One rung of the font-element seven-step dial: presentational floor
 * (works with no stylesheet, under any CSP), stylesheet class as ceiling.
 * The named rungs - miniscule, tiny, huge, enormous - are unnecessary
 * given the dial, and yet. */
function sizeRung(value: string, inner: string): string {
  return `<font class="mq-size-${value}" size="${value}">${inner}</font>`;
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

const TURBOLINK_LEVELS = new Set<TurbolinkLevel>(["full", "title", "bare"]);

function turbolink(target: string, levelAttr: string | undefined, profile: Profile): string {
  if (!profile.linkAllowed(target)) {
    return `<p class="mq-turbolink">${escapeText(target)}</p>`;
  }
  const level =
    levelAttr !== undefined && TURBOLINK_LEVELS.has(levelAttr as TurbolinkLevel)
      ? (levelAttr as TurbolinkLevel)
      : profile.turbolinkLevel(target);
  if (level !== "bare") {
    const rich = profile.turbolink(target, level);
    if (rich !== null) {
      // Enrichment augments, never replaces: the wrapper itself carries the
      // original link, so no plugin can eat it - not even by accident.
      return `<div class="mq-turbolink mq-turbolink-rich">${rich}<a class="mq-turbolink-source" href="${escapeAttr(target)}">${escapeText(target)}</a></div>`;
    }
  }
  // The contractual floor: a plain link, always reachable.
  return `<p class="mq-turbolink"><a href="${escapeAttr(target)}">${escapeText(target)}</a></p>`;
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

function fontClass(attrs: Attrs): string {
  const value = attrs["font"];
  return value !== undefined && FONTS[value] !== undefined ? ` mq-font-${value}` : "";
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
      return `<div class="mq-page${layout}${schemeClass(attrs)}${fontClass(attrs)}"${styleVars(attrs)}>${inner}</div>`;
    }
    case "section": {
      const slot = isToken(attrs["slot"]) ? ` data-slot="${attrs["slot"]}"` : "";
      return `<section class="mq-section${schemeClass(attrs)}${fontClass(attrs)}"${slot}${styleVars(attrs)}>${inner}</section>`;
    }
    case "turbolink": {
      const target = attrs["target"];
      if (target !== undefined) {
        return turbolink(target, attrs["level"], profile);
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
    case "big":
      return `<big>${inner}</big>`; // obsolete and eternal, like <font>
    case "size": {
      const value = attrs["size"];
      if (value !== undefined && /^[1-7]$/.test(value)) {
        return sizeRung(value, inner);
      }
      return inner; // off the dial: the effect degrades, the words survive
    }
    case "font": {
      const value = attrs["font"];
      const face = value !== undefined ? FONTS[value] : undefined;
      if (face !== undefined) {
        return `<font class="mq-font-${value}" face="${escapeAttr(face)}">${inner}</font>`;
      }
      return inner; // not on the list: the words survive in their own clothes
    }
    case "miniscule":
      return sizeRung("1", inner);
    case "tiny":
      return sizeRung("2", inner);
    case "huge":
      return sizeRung("6", inner);
    case "enormous":
      return sizeRung("7", inner);
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
      if (attrs["by"] === "letter" || attrs["by"] === "word") {
        return bySegments(name, attrs["by"], attrs["phase"], nodes, profile);
      }
      return `<span class="mq-${name}">${inner}</span>`;
    case "typewriter":
      return `<span class="mq-${name}">${inner}</span>`;
  }
  return inner; // unknown span: pure shrug, children as plain content
}

// -- per-unit effects (by=letter / by=word): each unit in its own span with
// a phase offset in --mq-o; the stylesheet replays the effect's keyframes
// through a negative animation-delay. Pure markup - the document stays a
// document. Locale pinned so segmentation (and thus output) is stable.

const SEGMENTERS = {
  letter: new Intl.Segmenter("en", { granularity: "grapheme" }),
  word: new Intl.Segmenter("en", { granularity: "word" }),
};

type SplitBy = keyof typeof SEGMENTERS;

/** DOM-weight discipline: past this many units, the run animates whole. */
const MAX_SPLIT_UNITS = 400;

type Phase = "ramp" | "scatter";

interface SplitState {
  effect: string;
  by: SplitBy;
  phase: Phase;
  i: number;
  total: number;
}

function bySegments(
  effect: string,
  by: SplitBy,
  phaseAttr: string | undefined,
  nodes: Node[],
  profile: Profile,
): string {
  // Each effect has a natural phase order (jitter scatters, the rest sweep);
  // the knob overrides it either way. Invalid values degrade to the default.
  const phase: Phase =
    phaseAttr === "scatter" || phaseAttr === "ramp"
      ? phaseAttr
      : effect === "jitter"
        ? "scatter"
        : "ramp";
  const state: SplitState = { effect, by, phase, i: 0, total: 0 };
  state.total = countUnits(nodes, by);
  if (state.total === 0 || state.total > MAX_SPLIT_UNITS) {
    return `<span class="mq-${effect}">${children(nodes, profile)}</span>`;
  }
  return `<span class="mq-${effect} mq-split">${splitRender(nodes, profile, state)}</span>`;
}

/** A segment gets wrapped if it's animatable: for words, word-like segments
 * (spaces and bare punctuation ride along); for letters, anything that
 * isn't whitespace. */
function isUnit(seg: Intl.SegmentData, by: SplitBy): boolean {
  return by === "word" ? seg.isWordLike === true : !/^\s+$/.test(seg.segment);
}

/** Offsets are deterministic (goldens exist; a document renders the same
 * twice) in both phase orders: ramp sweeps, scatter scrambles by a fixed
 * integer hash - randomness-shaped, never random. */
function unitOffset(state: SplitState): string {
  let o: number;
  if (state.phase === "scatter") {
    o = ((state.i * 7919) % 101) / 101;
  } else {
    switch (state.effect) {
      case "rainbow":
        o = state.i / state.total; // gradient across the whole run
        break;
      case "wave":
        o = (state.i % 8) / 8; // fixed ripple wavelength
        break;
      case "bounce":
        o = (state.i % 6) / 6;
        break;
      default:
        o = (state.i % 8) / 8; // jitter in ramp mode: a rippling shudder
        break;
    }
  }
  return String(Math.round(o * 1000) / 1000);
}

function countUnits(nodes: Node[], by: SplitBy): number {
  let n = 0;
  for (const node of nodes) {
    if (node.type === "text") {
      for (const seg of SEGMENTERS[by].segment(node.value)) {
        if (isUnit(seg, by)) {
          n += 1;
        }
      }
    } else if (
      node.type === "emphasis" ||
      node.type === "strong" ||
      node.type === "strikethrough"
    ) {
      n += countUnits(node.children, by);
    }
  }
  return n;
}

function splitRender(nodes: Node[], profile: Profile, state: SplitState): string {
  let out = "";
  for (const node of nodes) {
    if (node.type === "text") {
      for (const seg of SEGMENTERS[state.by].segment(node.value)) {
        if (!isUnit(seg, state.by)) {
          out += escapeText(seg.segment); // spaces/punctuation ride along
          continue;
        }
        const o = unitOffset(state);
        state.i += 1;
        out += `<span class="mq-l" style="--mq-o:${o}">${escapeText(seg.segment)}</span>`;
      }
    } else if (node.type === "emphasis") {
      out += `<em>${splitRender(node.children, profile, state)}</em>`;
    } else if (node.type === "strong") {
      out += `<strong>${splitRender(node.children, profile, state)}</strong>`;
    } else if (node.type === "strikethrough") {
      out += `<del>${splitRender(node.children, profile, state)}</del>`;
    } else {
      out += render(node, profile); // anything else renders whole, un-split
    }
  }
  return out;
}

// -- escaping (the only paths author bytes may take into markup)

export function escapeText(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function escapeAttr(s: string): string {
  return escapeText(s).replaceAll('"', "&quot;");
}
