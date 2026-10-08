// The effect vocabulary's look, as data: which classes, custom properties
// and data attributes an effect span's container wears, and - for by=letter
// / by=word - exactly which runs of which text nodes are animated units and
// with what phase offset. The HTML renderer builds its markup from this, and
// any other surface that draws effects (the live editor's in-place marks)
// takes the same answer, so the two can't disagree about segmentation,
// phase order, offsets, or caps.

import type { Attrs, Node } from "@cube-drone/marquee-parser";

const TOKEN = /^[a-z][a-z0-9-]{0,31}$/;
const COUNT = /^[0-9]{1,4}$/;

/** The language-defined animated effects (SPEC.md, "Text effects"). */
export const EFFECT_NAMES: ReadonlySet<string> = new Set([
  "marquee", "blink", "rainbow", "bounce", "jitter", "wave", "rubber", "typewriter", "fadein",
]);

/** One animated unit: `[start, end)` in its text node's `value` (UTF-16
 * offsets), and the `--mq-o` phase offset it wears. */
export interface EffectUnit {
  start: number;
  end: number;
  offset: string;
}

export interface EffectLook {
  /** The container's classes: `mq-<name>`, plus `mq-split` when split. */
  className: string;
  /** Custom properties on the container (`--mq-speed`, `--mq-rate`, a
   * reveal's step), in emission order. */
  vars: [string, string][];
  /** Data attributes on the container (a marquee's direction). */
  data: [string, string][];
  /** Per-unit animation, or null when the run animates as one piece (no
   * `by=`, no units, or past the unit cap). Keyed by text node identity. */
  units: Map<Node, EffectUnit[]> | null;
}

/** How an effect span looks, or null if `name` isn't an effect. */
export function effectLook(name: string, attrs: Attrs, children: Node[]): EffectLook | null {
  if (!EFFECT_NAMES.has(name)) {
    return null;
  }
  const look: EffectLook = { className: `mq-${name}`, vars: [], data: [], units: null };
  const by = attrs["by"] === "letter" || attrs["by"] === "word" ? attrs["by"] : null;
  let splitBy: SplitBy | null = null;
  switch (name) {
    case "marquee":
      if (TOKEN.test(attrs["direction"] ?? "")) {
        look.data.push(["direction", attrs["direction"]!]);
      }
      if (COUNT.test(attrs["speed"] ?? "")) {
        look.vars.push(["--mq-speed", attrs["speed"]!]);
      }
      return look;
    case "blink":
      // Split blink: ramp is theater-marquee chase lights, scatter is
      // twinkle. The rate rides the container; units inherit it.
      if (COUNT.test(attrs["rate"] ?? "")) {
        look.vars.push(["--mq-rate", attrs["rate"]!]);
      }
      splitBy = by;
      break;
    case "typewriter":
      // Inherently per-unit: the reveal IS a by=letter effect (by=word for
      // word-at-a-time). speed= is units per second; the container carries
      // the per-unit delay step, each unit its ordinal in --mq-o.
      splitBy = by === "word" ? "word" : "letter";
      look.vars.push(["--mq-tw-step", `${revealStep(attrs["speed"], 14)}s`]);
      break;
    case "fadein":
      // Bare [fadein] fades the whole run in once; by= drifts units in on
      // staggered starts (the same one-shot family as typewriter).
      if (by !== null) {
        splitBy = by;
        look.vars.push(["--mq-fi-step", `${revealStep(attrs["speed"], 16)}s`]);
      }
      break;
    default: // rainbow, bounce, jitter, wave, rubber
      splitBy = by;
  }
  if (splitBy === null) {
    return look;
  }
  const units = splitUnits(name, splitBy, attrs["phase"], children);
  if (units === null) {
    // Past the cap (or nothing to split): the run animates whole, and the
    // split's container knobs go with the split.
    look.vars = [];
    return look;
  }
  look.className += " mq-split";
  look.units = units;
  return look;
}

// -- per-unit effects (by=letter / by=word): each unit carries a phase
// offset in --mq-o; the stylesheet replays the effect's keyframes through a
// negative animation-delay. Locale pinned so segmentation (and thus output)
// is stable.

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

function splitUnits(
  effect: string,
  by: SplitBy,
  phaseAttr: string | undefined,
  children: Node[],
): Map<Node, EffectUnit[]> | null {
  // Each effect has a natural phase order (jitter scatters, the rest sweep);
  // the knob overrides it either way. Invalid values degrade to the default.
  const phase: Phase =
    phaseAttr === "scatter" || phaseAttr === "ramp" ? phaseAttr : effect === "jitter" ? "scatter" : "ramp";
  const total = countUnits(children, by);
  const cap = isReveal(effect) ? MAX_REVEAL_UNITS : MAX_SPLIT_UNITS;
  if (total === 0 || total > cap) {
    return null;
  }
  const state: SplitState = { effect, by, phase, i: 0, total };
  const units = new Map<Node, EffectUnit[]>();
  collectUnits(children, state, units);
  return units;
}

/** The nodes a split descends into: text, through emphasis/strong/strike.
 * Anything else (a link, an emoji, a nested span) renders whole, un-split. */
function collectUnits(nodes: Node[], state: SplitState, out: Map<Node, EffectUnit[]>): void {
  for (const node of nodes) {
    if (node.type === "text") {
      const list: EffectUnit[] = [];
      for (const seg of SEGMENTERS[state.by].segment(node.value)) {
        if (isUnit(seg, state.by)) {
          list.push({ start: seg.index, end: seg.index + seg.segment.length, offset: unitOffset(state) });
          state.i += 1;
        }
      }
      out.set(node, list);
    } else if (node.type === "emphasis" || node.type === "strong" || node.type === "strikethrough") {
      collectUnits(node.children, state, out);
    }
  }
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
    } else if (node.type === "emphasis" || node.type === "strong" || node.type === "strikethrough") {
      n += countUnits(node.children, by);
    }
  }
  return n;
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
    const o = state.phase === "scatter" ? (state.i * scatterStride(state.total)) % state.total : state.i;
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
  const speed = speedAttr !== undefined && COUNT.test(speedAttr) && Number(speedAttr) > 0 ? Number(speedAttr) : dflt;
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
