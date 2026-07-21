// <Marquee /> - the interactive renderer.
//
// It is the static renderer plus the three things a string of HTML cannot do,
// which are exactly the three things the spec's animation contract defers to
// "the interactive renderer":
//
//   1. animate on VISIBILITY, not on page load (IntersectionObserver)
//   2. the user can always SKIP (one gesture stills everything, whole)
//   3. scroll sync for side-by-side editors (source offset <-> element)
//
// All motion is still CSS - marquee.css is the shared artifact, and the
// mq-* class contract is what every renderer targets. JS never animates
// anything here; it decides when the CSS clock starts and when it stops.
// That is why there is no animation library in the dependency list: the
// effect vocabulary is closed, and CSS already speaks all of it.

import {
  createElement as h,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  parse,
  parseWithPositions,
  UnsupportedVersionError,
  type Node,
  type Span,
} from "@cube-drone/marquee-parser";
import { bareWebProfile, type Profile } from "@cube-drone/marquee-html-renderer";
import { ANIM_CLASS, renderNode, type Ctx, type ReactHooks } from "./render.ts";
import { nodeAt as locateAt, nodeNear as locateNear } from "./locate.ts";

/** SSR-safe: layout effects only exist in the browser. The `mq-js` hold is
 * applied here (before paint) rather than in the rendered markup, so a page
 * that never hydrates animates normally instead of freezing - the hold only
 * exists where JS is alive to release it. Never a hostage situation. */
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export interface MarqueeHandle {
  /** The rendered root element. */
  readonly root: HTMLElement | null;
  /** The DOM element a node rendered to, if it is currently mounted. */
  elementFor(node: Node): HTMLElement | null;
  /** The element `scrollToSource(offset)` would scroll to: the nearest node
   * to that offset that actually has an element (text nodes render as
   * strings, so they have none). Handy for highlighting it too. */
  elementNear(offset: number): HTMLElement | null;
  /** The deepest node whose source span CONTAINS this offset (needs
   * `source`). Exact, with holes: a cursor in the blank line between two
   * paragraphs is contained by nothing smaller than their container. */
  nodeAt(offset: number): Node | null;
  /** The deepest node at or NEAREST this offset - the editor-shaped answer,
   * and what `scrollToSource` uses. A cursor in the gap between two blocks
   * finds the block beside it, not the container above it. */
  nodeNear(offset: number): Node | null;
  /** Scroll a node into view. Returns false if it isn't mounted. */
  scrollToNode(node: Node, options?: ScrollIntoViewOptions): boolean;
  /** Scroll to whatever the editor's cursor is sitting in: the side-by-side
   * move. Centered by default, because "at the top edge" is not where a
   * human looks. Returns false if the offset maps to nothing on screen. */
  scrollToSource(offset: number, options?: ScrollIntoViewOptions): boolean;
  /** Still every effect and show all text, whole - the skip gesture, fired
   * programmatically (a toolbar button, a keystroke, a host policy). */
  skip(): void;
  /** Undo a skip and re-arm the visibility observer. */
  replay(): void;
}

export interface MarqueeProps {
  /** Marquee source. Parsed with positions, which is what enables the
   * editor-sync half of the API. Ignored when `doc` is given. */
  source?: string;
  /** A pre-parsed document (no positions, so no source sync). */
  doc?: Node;
  /** Embedder policy: schemes, media, emoji, turbolinks, vocabulary.
   * The SAME socket the static renderer uses - one policy, both renderers. */
  profile?: Partial<Profile>;
  /** React-returning versions of the rendering hooks. When given, the
   * corresponding string-returning profile hook is not consulted (and no
   * HTML string is ever injected). */
  hooks?: ReactHooks;
  /** `visible` (default): effects hold until scrolled into view.
   * `immediate`: effects run from mount, like the static renderer.
   * `never`: no motion at all (the reduced-motion posture, by choice). */
  animate?: "visible" | "immediate" | "never";
  /** A click anywhere in the document stills every effect (default true) -
   * the spec's "animated text is a performance, never a hostage situation". */
  skipOnClick?: boolean;
  /** Extra classes on the root, beside `mq-doc`. */
  className?: string;
  /** Reverse sync: which node did the reader just click? Gives you the node
   * and its source span, so the editor can move its cursor there. */
  onNodeClick?: (node: Node, span: Span | null, event: React.MouseEvent) => void;
}

export const Marquee = forwardRef<MarqueeHandle, MarqueeProps>(function Marquee(props, ref) {
  const {
    source,
    doc: docProp,
    profile: profileOverrides,
    hooks = {},
    animate = "visible",
    skipOnClick = true,
    className,
    onNodeClick,
  } = props;

  const rootRef = useRef<HTMLElement | null>(null);
  const elements = useRef(new Map<Node, HTMLElement>()).current;
  const nodesByElement = useRef(new WeakMap<HTMLElement, Node>()).current;
  const [skipped, setSkipped] = useState(animate === "never");
  const [generation, setGeneration] = useState(0);

  // Parse once per source change. An unknown dialect version is the one
  // refusal in the whole language - and the component's job is still to
  // never eat content, so it shows the source rather than throwing.
  const parsed = useMemo((): { doc: Node | null; spans: WeakMap<Node, Span> | null; error: Error | null } => {
    try {
      if (docProp !== undefined) {
        return { doc: docProp, spans: null, error: null };
      }
      if (source === undefined) {
        return { doc: null, spans: null, error: null };
      }
      const { doc, spans } = parseWithPositions(source);
      return { doc, spans, error: null };
    } catch (e) {
      return { doc: null, spans: null, error: e as Error };
    }
  }, [source, docProp]);

  const profile = useMemo(
    (): Profile => ({ ...bareWebProfile, ...profileOverrides }),
    [profileOverrides],
  );

  const register = useCallback(
    (node: Node) => (el: HTMLElement | null) => {
      if (el === null) {
        const prev = elements.get(node);
        if (prev !== undefined) {
          elements.delete(node);
        }
        return;
      }
      elements.set(node, el);
      nodesByElement.set(el, node);
    },
    [elements, nodesByElement],
  );

  // -- the visibility gate (contract rule 1). The hold is applied AFTER
  // mount (mq-js), so markup that never hydrates animates instead of
  // freezing; then each effect is released the first time it is seen.
  useIsomorphicLayoutEffect(() => {
    const root = rootRef.current;
    if (root === null || parsed.doc === null) {
      return;
    }
    if (animate !== "visible") {
      root.classList.remove("mq-js");
      return;
    }
    root.classList.add("mq-js");
    const targets = Array.from(root.querySelectorAll<HTMLElement>(`.${ANIM_CLASS}`));
    for (const el of targets) {
      el.removeAttribute("data-mq-play");
    }
    if (typeof IntersectionObserver === "undefined") {
      // No observer (old browser, test environment): release everything -
      // the effect is worth less than the text being visible.
      for (const el of targets) {
        el.setAttribute("data-mq-play", "");
      }
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.setAttribute("data-mq-play", "");
            observer.unobserve(entry.target); // one-shot: a performance, not a loop
          }
        }
      },
      // No negative margin: a shrunk root creates a dead zone at the bottom of
      // the viewport, and an effect that renders permanently inside it - the
      // last element on a page too short to scroll further - would never count
      // as "in view", so it would hold, hidden, forever. Contract rule 1 is
      // "animate when the text enters view"; entering view is any pixel of it.
      { rootMargin: "0px" },
    );
    for (const el of targets) {
      observer.observe(el);
    }
    return () => observer.disconnect();
  }, [parsed.doc, animate, generation]);

  /** NEAREST, not "containing": a cursor in the whitespace between two
   * blocks is contained only by their parent, and scrolling to the parent
   * means scrolling to the middle of the whole group (or, on a blank line
   * between top-level paragraphs, the middle of the whole document). Then
   * walk out until something has an element: text nodes render as strings.
   *
   * But STOP below the document node. The document is registered too (it is
   * the <div class="mq-doc">), so a cursor whose nearest node renders to
   * nothing - the meta line, a comment, an invalid directive - would walk all
   * the way up and "scroll to" the whole page. Better to not scroll at all
   * (return null): leave the preview where the reader left it. */
  const elementNear = useCallback(
    (offset: number): HTMLElement | null => {
      if (parsed.doc === null || parsed.spans === null) {
        return null;
      }
      let node = locateNear(parsed.doc, parsed.spans, offset);
      while (node !== null && node !== parsed.doc) {
        const el = elements.get(node);
        if (el !== undefined) {
          return el;
        }
        node = parentOf(parsed.doc, node);
      }
      return null;
    },
    [parsed, elements],
  );

  const skip = useCallback(() => setSkipped(true), []);
  const replay = useCallback(() => {
    setSkipped(false);
    setGeneration((g) => g + 1); // re-arm the observer
  }, []);

  useImperativeHandle(
    ref,
    (): MarqueeHandle => ({
      get root() {
        return rootRef.current;
      },
      elementFor: (node) => elements.get(node) ?? null,
      nodeAt: (offset) =>
        parsed.doc === null || parsed.spans === null
          ? null
          : locateAt(parsed.doc, parsed.spans, offset),
      nodeNear: (offset) =>
        parsed.doc === null || parsed.spans === null
          ? null
          : locateNear(parsed.doc, parsed.spans, offset),
      scrollToNode: (node, options) => {
        const el = elements.get(node);
        if (el === undefined) {
          return false;
        }
        el.scrollIntoView({ block: "center", behavior: "smooth", ...options });
        return true;
      },
      elementNear: (offset) => elementNear(offset),
      scrollToSource: (offset, options) => {
        const el = elementNear(offset);
        if (el === null) {
          return false;
        }
        el.scrollIntoView({ block: "center", behavior: "smooth", ...options });
        return true;
      },
      skip,
      replay,
    }),
    [parsed, elements, elementNear, skip, replay],
  );

  const handleClick = useCallback(
    (event: React.MouseEvent) => {
      if (skipOnClick && !skipped) {
        setSkipped(true);
      }
      if (onNodeClick !== undefined) {
        const el = (event.target as HTMLElement).closest<HTMLElement>("[data-mq-start]");
        const node = el === null ? undefined : nodesByElement.get(el);
        if (node !== undefined) {
          onNodeClick(node, parsed.spans?.get(node) ?? null, event);
        }
      }
    },
    [skipOnClick, skipped, onNodeClick, nodesByElement, parsed.spans],
  );

  if (parsed.error !== null) {
    const message =
      parsed.error instanceof UnsupportedVersionError
        ? `This document declares Marquee version ${parsed.error.version}, which this renderer doesn't know.`
        : String(parsed.error.message);
    // Never eat content: show the refusal AND the words.
    return h(
      "div",
      { className: `mq-doc mq-unsupported${className === undefined ? "" : ` ${className}`}` },
      h("p", { className: "mq-invalid", "data-reason": "unsupported_version" }, message),
      h("pre", { className: "mq-code" }, h("code", null, source ?? "")),
    );
  }

  if (parsed.doc === null) {
    return null;
  }

  const ctx: Ctx = {
    profile,
    hooks,
    spans: parsed.spans,
    register,
    note: { n: 0, pending: [] },
  };

  const tree = renderNode(parsed.doc, ctx, "doc") as ReactNode;

  // The root element the renderer produced is a <div class="mq-doc">; wrap
  // it so the component owns the ref, the click gesture, and the skip flag
  // without the renderer needing to know they exist.
  return h(
    "div",
    {
      ref: (el: HTMLDivElement | null) => {
        rootRef.current = el;
      },
      className: `mq-root${className === undefined ? "" : ` ${className}`}`,
      "data-mq-skip": skipped ? "" : undefined,
      onClick: handleClick,
      style: { display: "contents" },
    },
    tree,
  );
});

function parentOf(doc: Node, target: Node): Node | null {
  let found: Node | null = null;
  const walk = (node: Node): void => {
    if (found !== null || !("children" in node)) {
      return;
    }
    for (const child of node.children) {
      if (child === target) {
        found = node;
        return;
      }
      walk(child);
    }
  };
  walk(doc);
  return found;
}

/** Parse without positions - for callers who want to hold the AST
 * themselves and pass it as `doc`. */
export { parse };
