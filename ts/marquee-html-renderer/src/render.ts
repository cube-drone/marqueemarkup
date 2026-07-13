// AST -> HTML string. The safety contract: author bytes reach the output
// only through escapeText/escapeAttr, targets only through the profile's
// allowlist, and attribute *names* are never author-controlled. Unknown
// vocabulary shrugs (children survive, effect doesn't); comments render
// nothing; invalid constructs render inert placeholders.

import type { Attrs, Node } from "@cube-drone/marquee-parser";
import { bareWebProfile, type Profile, type TurbolinkLevel } from "./profile.ts";

/** Render state: the profile, plus the one piece of cross-block
 * coordination the renderer owns - aside numbering (sequential through the
 * document) and the pending notes that flush after the triggering block. */
interface Ctx {
  profile: Profile;
  note: { n: number; pending: string[] };
}

export function render(node: Node, profile: Profile = bareWebProfile): string {
  return renderNode(node, { profile, note: { n: 0, pending: [] } });
}

/** Asides render just below the paragraph (or heading) that triggered
 * them - part of regular flow, no floats, no popups. */
function flushNotes(ctx: Ctx, html: string): string {
  if (ctx.note.pending.length === 0) {
    return html;
  }
  const notes = ctx.note.pending.map((n) => `<p class="mq-note">${n}</p>`).join("");
  ctx.note.pending = [];
  return `${html}<aside class="mq-notes">${notes}</aside>`;
}

function renderNode(node: Node, ctx: Ctx): string {
  switch (node.type) {
    case "document":
      return `<div class="mq-doc">${children(node.children, ctx)}</div>`;
    case "paragraph":
      return flushNotes(ctx, `<p>${children(node.children, ctx)}</p>`);
    case "heading": {
      // HTML's ladder stops at h6; levels 7-8 (the grammar allows 1-8) keep
      // real heading semantics via ARIA on a styled block.
      const inner = children(node.children, ctx);
      const html =
        node.level <= 6
          ? `<h${node.level}>${inner}</h${node.level}>`
          : `<p class="mq-h${node.level}" role="heading" aria-level="${node.level}">${inner}</p>`;
      return flushNotes(ctx, html);
    }
    case "code_block": {
      const lang = infoToken(node.info);
      const cls = lang === null ? "" : ` class="language-${escapeAttr(lang)}"`;
      const text = node.text === "" ? "" : `${escapeText(node.text)}\n`;
      return `<pre class="mq-code"><code${cls}>${text}</code></pre>`;
    }
    case "blockquote":
      return `<blockquote>${children(node.children, ctx)}</blockquote>`;
    case "list": {
      const tag = node.ordered ? "ol" : "ul";
      return `<${tag}>${children(node.children, ctx)}</${tag}>`;
    }
    case "list_item":
      return `<li>${children(node.children, ctx)}</li>`;
    case "thematic_break":
      return "<hr>";
    case "directive":
      return directive(node.name, node.attrs, node.children, ctx);
    case "invalid_directive":
      return `<div class="mq-invalid" data-reason="${escapeAttr(node.reason)}"></div>`;
    case "comment":
      return ""; // the anti-shrug: correct rendering is absence
    case "text":
      return escapeText(node.value);
    case "emphasis":
      return `<em>${children(node.children, ctx)}</em>`;
    case "strong":
      return `<strong>${children(node.children, ctx)}</strong>`;
    case "strikethrough":
      return `<del>${children(node.children, ctx)}</del>`;
    case "code_span":
      return `<code>${escapeText(node.text)}</code>`;
    case "link": {
      const inner = children(node.children, ctx);
      return ctx.profile.linkAllowed(node.target)
        ? `<a href="${escapeAttr(node.target)}">${inner}</a>`
        : `<span class="mq-blocked">${inner}</span>`;
    }
    case "embed":
      return embed(node.target, node.alt, ctx.profile);
    case "turbolink":
      return turbolink(node.target, undefined, ctx.profile);
    case "span":
      return span(node.name, node.attrs, node.children, ctx);
    case "emoji": {
      const resolved = ctx.profile.emoji(node.slug);
      if (resolved !== null && typeof resolved === "object") {
        const alt = resolved.alt ?? `:${node.slug}:`;
        return `<img class="mq-emoji" src="${escapeAttr(resolved.image)}" alt="${escapeAttr(alt)}" loading="lazy">`;
      }
      return escapeText(resolved ?? `:${node.slug}:`);
    }
    case "hard_break":
      return "<br>";
  }
}

function children(nodes: Node[], ctx: Ctx): string {
  return nodes.map((n) => renderNode(n, ctx)).join("");
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

/** Which grab-bag faces does this rendered HTML actually wear? Pure string
 * scan of the mq-font-* class contract - feed the result to
 * @cube-drone/marquee-fonts (externalFontFaces / inlineFontFaces) to deliver
 * exactly those faces and not one byte more. */
export function usedFontTokens(html: string): string[] {
  const used = new Set<string>();
  for (const m of html.matchAll(/mq-font-([a-z0-9-]+)/g)) {
    used.add(m[1]!);
  }
  return [...used].sort();
}

/** One rung of the font-element seven-step dial: presentational floor
 * (works with no stylesheet, under any CSP), stylesheet class as ceiling.
 * The named rungs - teeny, tiny, huge, enormous - are unnecessary
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

/** A resolved URL made safe for a CSS url("...") token: encodeURI handles
 * whitespace, controls, backslashes, and double quotes; quotes and parens
 * that encodeURI deliberately leaves are percent-encoded on top, so the
 * value can never terminate the url() or the declaration - author bytes
 * must not write CSS, even inside their own style attribute. */
function cssUrl(url: string): string {
  return encodeURI(url).replaceAll("'", "%27").replaceAll("(", "%28").replaceAll(")", "%29");
}

/** Style knobs on a block node: validated values into --mq-* slots; the
 * stylesheet owns which CSS property each slot feeds. `background` takes a
 * color, or `tile:<target>` - a tiled background image, resolved through
 * the embedder's media policy exactly as an embed (a background fetch is a
 * fetch): out-of-policy or non-image targets degrade to no background. */
function styleVars(attrs: Attrs, profile: Profile): string {
  const vars: string[] = [];
  if (isColorValue(attrs["color"])) {
    vars.push(`--mq-color:${attrs["color"]}`);
  }
  const bg = attrs["background"];
  if (bg !== undefined && bg.startsWith("tile:")) {
    const media = profile.media(bg.slice("tile:".length));
    if (media !== null && media.kind === "image") {
      // Single-quoted url token: the style attribute itself is
      // double-quoted, and cssUrl percent-encodes single quotes.
      vars.push(`--mq-bg-tile:url('${cssUrl(media.url)}')`);
    }
  } else if (isColorValue(bg)) {
    vars.push(`--mq-bg:${bg}`);
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

function directive(name: string, attrs: Attrs, nodes: Node[], ctx: Ctx): string {
  const { profile } = ctx;
  const inner = children(nodes, ctx);
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
      return `<div class="mq-page${layout}${schemeClass(attrs)}${fontClass(attrs)}"${styleVars(attrs, profile)}>${inner}</div>`;
    }
    case "section": {
      const slot = isToken(attrs["slot"]) ? ` data-slot="${attrs["slot"]}"` : "";
      return `<section class="mq-section${schemeClass(attrs)}${fontClass(attrs)}"${slot}${styleVars(attrs, profile)}>${inner}</section>`;
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
    case "table":
      return renderTable(attrs, nodes, ctx);
    case "center":
    case "right":
    case "left":
      // The <center> tag, back from the dead in directive clothing - plus
      // its siblings: right for symmetry, left as the un-aligner (useful
      // only inside the other two, which is exactly when you want it).
      // Physical directions, deliberately: predictable beats logical.
      return `<div class="mq-${name}">${inner}</div>`;
  }
  // Unknown vocabulary: a container renders its children with an affordance
  // that something wrapped them; a leaf renders the inert placeholder.
  // Never eat authored content.
  return nodes.length > 0
    ? `<div class="mq-unknown" data-directive="${escapeAttr(name)}">${inner}</div>`
    : `<div class="mq-placeholder" data-directive="${escapeAttr(name)}"></div>`;
}

/** :::table (SPEC.md, "Tables"): each paragraph child is a row; a row's
 * cells are its top-level `[c]` spans, and loose inline content between
 * cells coalesces into implicit cells (never eaten). A non-paragraph block
 * child is a full-width single-cell row. `header=row|column|both` promotes
 * the first row / first column to <th> with scope - header association is
 * the accessibility half of tables, hoisted onto the one attr. */
function renderTable(attrs: Attrs, nodes: Node[], ctx: Ctx): string {
  const header = attrs["header"];
  const headRow = header === "row" || header === "both";
  const headCol = header === "column" || header === "both";
  const rows: string[] = [];
  for (const node of nodes) {
    const cells: string[] = [];
    if (node.type === "paragraph") {
      let loose: Node[] = [];
      const flushLoose = () => {
        if (loose.some((n) => n.type !== "text" || n.value.trim() !== "")) {
          cells.push(children(loose, ctx));
        }
        loose = [];
      };
      for (const child of node.children) {
        if (child.type === "span" && child.name === "c") {
          flushLoose();
          cells.push(children(child.children, ctx));
        } else {
          loose.push(child);
        }
      }
      flushLoose();
    } else {
      cells.push(renderNode(node, ctx));
    }
    const isHeadRow = headRow && rows.length === 0;
    const cellsHtml = cells
      .map((cell, i) =>
        isHeadRow || (headCol && i === 0)
          ? `<th scope="${isHeadRow ? "col" : "row"}">${cell}</th>`
          : `<td>${cell}</td>`,
      )
      .join("");
    rows.push(`<tr>${cellsHtml}</tr>`);
  }
  // Cell sidenotes land just below the table, like a paragraph's would.
  return flushNotes(ctx, `<table class="mq-table">${rows.join("")}</table>`);
}

/** Effect/typographic spans. The `<font>` tag is deliberate: presentational
 * attributes are outside CSP's jurisdiction and are implemented by the
 * browser itself, so color survives with no stylesheet and no style
 * attributes - the floor of the degradation ladder. The --mq-color slot is
 * the stylesheet-era ceiling on the same element. */
function span(name: string, attrs: Attrs, nodes: Node[], ctx: Ctx): string {
  const inner = children(nodes, ctx);
  const custom = ctx.profile.span(name, attrs, inner);
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
    case "spoiler":
      // The content is present and never eaten - just blurred, revealed on
      // hover/focus (the static renderer has no JS to gate a click). An
      // interactive renderer turns the same class into click-to-reveal.
      // Degrades, like everything, to readable content: no stylesheet means
      // a visible spoiler, which beats a hidden one.
      return `<span class="mq-spoiler" tabindex="0">${inner}</span>`;
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
    case "teeny":
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
    case "aside":
    case "footnote": {
      // Permanent synonyms (SPEC.md): nobody keeps these three words
      // distinct in their head, and an aside that silently isn't an aside
      // is worse than two extra names - the list-marker rule, one layer up.
      // A numbered mark in the flow; the note itself flushes just below the
      // triggering paragraph (see flushNotes). Numbering runs sequentially
      // through the whole document.
      ctx.note.n += 1;
      ctx.note.pending.push(`<span class="mq-note-num">${ctx.note.n}</span>${inner}`);
      return `<sup class="mq-noteref">${ctx.note.n}</sup>`;
    }
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
      if (attrs["by"] === "letter" || attrs["by"] === "word") {
        // Split blink: ramp is theater-marquee chase lights, scatter is
        // twinkle. The rate var rides the container; units inherit it.
        return bySegments(name, attrs["by"], attrs["phase"], nodes, ctx, rate);
      }
      return `<span class="mq-blink"${rate}>${inner}</span>`;
    }
    case "rainbow":
    case "bounce":
    case "jitter":
    case "wave":
    case "rubber":
      if (attrs["by"] === "letter" || attrs["by"] === "word") {
        return bySegments(name, attrs["by"], attrs["phase"], nodes, ctx);
      }
      return `<span class="mq-${name}">${inner}</span>`;
    case "typewriter": {
      // Inherently per-unit: the reveal IS a by=letter effect (by=word for
      // word-at-a-time). speed= is units per second; the container carries
      // the per-unit delay step, each unit its ordinal in --mq-o.
      const by = attrs["by"] === "word" ? "word" : "letter";
      const step = revealStep(attrs["speed"], 14);
      return bySegments(name, by, attrs["phase"], nodes, ctx, ` style="--mq-tw-step:${step}s"`);
    }
    case "fadein": {
      // The ghostly reveal. Bare [fadein] fades the whole run in once;
      // by=letter / by=word drift units in on staggered starts (same
      // one-shot family as typewriter: sequential ordinals, high cap);
      // phase=scatter is apparition weather.
      if (attrs["by"] === "letter" || attrs["by"] === "word") {
        const step = revealStep(attrs["speed"], 16);
        return bySegments(name, attrs["by"], attrs["phase"], nodes, ctx, ` style="--mq-fi-step:${step}s"`);
      }
      return `<span class="mq-fadein">${inner}</span>`;
    }
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

/** DOM-weight discipline: past this many units, the run animates whole.
 * Loopers pay a live animation per element forever, so they cap low;
 * typewriter's units are 1ms one-shots (finished animations cost nothing)
 * and its natural material is long text, so it caps high. */
const MAX_SPLIT_UNITS = 400;
const MAX_REVEAL_UNITS = 2000;

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
  ctx: Ctx,
  containerStyle = "",
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
  const cap = isReveal(effect) ? MAX_REVEAL_UNITS : MAX_SPLIT_UNITS;
  if (state.total === 0 || state.total > cap) {
    return `<span class="mq-${effect}">${children(nodes, ctx)}</span>`;
  }
  return `<span class="mq-${effect} mq-split"${containerStyle}>${splitRender(nodes, ctx, state)}</span>`;
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
  // Reveal offsets (typewriter, fadein) are sequential INTEGERS (the
  // ordinal; delay = ordinal x step), unlike the cyclic 0..1 fractions the
  // looping effects replay. phase=scatter reveals in a
  // scrambled-but-deterministic order: a stride at the run's golden-ratio
  // point, nudged coprime with the total, walks a well-spread permutation
  // at EVERY length. (A fixed prime stride is a trap: 7919 mod 40 = 39 =
  // -1, so forty-unit runs typed in backwards.)
  if (isReveal(state.effect)) {
    const o =
      state.phase === "scatter"
        ? (state.i * scatterStride(state.total)) % state.total
        : state.i;
    return String(o);
  }
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

/** speed= (units per second, a COUNT) into a per-unit delay step in
 * seconds; invalid or absent falls to the effect's default rate. */
function revealStep(speedAttr: string | undefined, dflt: number): number {
  const speed =
    speedAttr !== undefined && COUNT.test(speedAttr) && Number(speedAttr) > 0
      ? Number(speedAttr)
      : dflt;
  return Math.round(1000 / speed) / 1000;
}

/** The one-shot reveals: sequential ordinals, the high unit cap. */
function isReveal(effect: string): boolean {
  return effect === "typewriter" || effect === "fadein";
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** The smallest stride >= ~61.8% of total that's coprime with it (falls
 * back to 1 for degenerate totals - a 1- or 2-unit "scramble" is fate). */
function scatterStride(total: number): number {
  let stride = Math.max(1, Math.round(total * 0.618));
  while (stride < total && gcd(stride, total) !== 1) {
    stride += 1;
  }
  return gcd(stride, total) === 1 ? stride : 1;
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

function splitRender(nodes: Node[], ctx: Ctx, state: SplitState): string {
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
      out += `<em>${splitRender(node.children, ctx, state)}</em>`;
    } else if (node.type === "strong") {
      out += `<strong>${splitRender(node.children, ctx, state)}</strong>`;
    } else if (node.type === "strikethrough") {
      out += `<del>${splitRender(node.children, ctx, state)}</del>`;
    } else {
      out += renderNode(node, ctx); // anything else renders whole, un-split
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
