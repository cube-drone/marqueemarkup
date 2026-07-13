// The demo: WRITING.mq, live, beside its own source.
//
// It is deliberately the side-by-side editor pattern rather than a static
// page, because that is what exercises everything this renderer adds over
// the static one: effects that hold until seen, a click that stills them,
// and scroll sync in BOTH directions (cursor -> preview, click -> cursor).
// It is also the honest prototype of the editor we're heading toward.

import {
  createElement as h,
  StrictMode,
  useDeferredValue,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import { composeTurbolinks, defaultPlugins } from "@cube-drone/marquee-turbolink";
import { standardEmoji } from "@cube-drone/marquee-emoji";
import { Marquee, type MarqueeHandle, type Node, type Profile, type Span } from "../src/index.ts";
// esbuild's text loader: the document IS the demo (see scripts/demo.ts).
import WRITING from "../../../WRITING.mq";

/** The demo host's policy. Exactly the socket the static renderer uses -
 * this object would work, unchanged, in `marquee()` or `build_site()`. */
const profile: Partial<Profile> = {
  // WRITING.mq says ":angry-burger: is a custom image emoji this host
  // provides" - so this host provides it. (There are no vanity defaults in
  // any package: custom emoji are always the embedder's to supply.)
  emoji: (slug) =>
    slug === "angry-burger"
      ? { image: "example-media/angry-burger-emoji.png", alt: ":angry-burger:" }
      : (standardEmoji[slug] ?? null),
  // The fetchless plugin chain: YouTube and Spotify embeds, media by
  // extension. No network at render time, ever.
  turbolink: composeTurbolinks(defaultPlugins),
};

function App(): ReactNode {
  const [source, setSource] = useState(WRITING);
  const [animate, setAnimate] = useState<"visible" | "immediate" | "never">("visible");
  const [clicked, setClicked] = useState<string>("");
  const view = useRef<MarqueeHandle>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const marked = useRef<HTMLElement | null>(null);
  // Bidirectional sync needs an echo guard: setSelectionRange() fires the
  // textarea's `select` event, which would run the FORWARD sync and scroll
  // the preview to re-center the very node you just clicked - yanking it
  // out from under your cursor. A click moves the editor; it must not then
  // move the preview back.
  const echo = useRef(false);

  // Typing stays snappy; the preview catches up a beat later.
  const deferred = useDeferredValue(source);

  /** Editor cursor -> preview: scroll the node under the cursor into the
   * middle of the view, and outline it so the sync is legible. */
  const syncToCursor = (): void => {
    const handle = view.current;
    const ta = editor.current;
    if (handle === null || ta === null || echo.current) {
      return; // this selection came from the preview: don't bounce it back
    }
    const node = handle.nodeAt(ta.selectionStart);
    marked.current?.classList.remove("demo-cursor-node");
    marked.current = null;
    if (node === null) {
      return;
    }
    handle.scrollToSource(ta.selectionStart);
    // Outline the nearest node that actually has an element on screen.
    let el = handle.elementFor(node);
    if (el === null) {
      const parent = handle.nodeAt(ta.selectionStart);
      el = parent === null ? null : handle.elementFor(parent);
    }
    if (el !== null) {
      el.classList.add("demo-cursor-node");
      marked.current = el;
    }
  };

  /** Preview click -> editor: put the cursor where that node came from. */
  const syncToNode = (_node: Node, span: Span | null): void => {
    const ta = editor.current;
    if (ta === null || span === null) {
      return;
    }
    // The preview stays exactly where the reader clicked; only the editor
    // moves. (Cleared on a timeout rather than in the handler, so a `select`
    // event that never arrives can't leave the guard stuck on.)
    echo.current = true;
    ta.focus();
    ta.setSelectionRange(span.start, span.end);
    setTimeout(() => {
      echo.current = false;
    }, 0);
    marked.current?.classList.remove("demo-cursor-node");
    marked.current = null;
    setClicked(`cursor → [${span.start}, ${span.end})`);
  };

  return h(
    "div",
    { style: { display: "contents" } },
    h(
      "header",
      null,
      h("h1", null, "Marquee — interactive renderer"),
      h("span", { className: "hint" }, "type on the left · move the cursor to sync · click the preview to skip / jump back"),
      h("span", { className: "spacer" }),
      h("span", { className: "hint" }, clicked),
      h(
        "select",
        {
          value: animate,
          onChange: (e: { target: { value: string } }) =>
            setAnimate(e.target.value as "visible" | "immediate" | "never"),
          title: "when effects start",
        },
        h("option", { value: "visible" }, "animate: on visible"),
        h("option", { value: "immediate" }, "animate: immediately"),
        h("option", { value: "never" }, "animate: never"),
      ),
      h("button", { onClick: () => view.current?.skip() }, "Skip"),
      h("button", { onClick: () => view.current?.replay() }, "Replay"),
    ),
    h(
      "main",
      null,
      h("textarea", {
        id: "source",
        ref: editor,
        spellCheck: false,
        value: source,
        onChange: (e: { target: { value: string } }) => setSource(e.target.value),
        onSelect: syncToCursor,
        onClick: syncToCursor,
        onKeyUp: syncToCursor,
      }),
      h(
        "div",
        { id: "preview" },
        h(Marquee, {
          ref: view,
          source: deferred,
          profile,
          animate,
          onNodeClick: syncToNode,
        }),
      ),
    ),
  );
}

const root = document.getElementById("root");
if (root !== null) {
  createRoot(root).render(h(StrictMode, null, h(App)));
}
