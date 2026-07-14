// CodeMirror widgets. Two kinds:
//   - EmojiWidget: an inline resolved emoji glyph inside augmented source.
//   - BlockWidget: a whole block rendered by the REAL HTML renderer - the
//     leverage move that makes lists look like lists, code like code, and
//     turbolinks/media/tables/asides/spoilers all render correctly, because
//     it IS the renderer's output (safe: the renderer escapes author bytes
//     and allowlists targets, exactly as for a static page fragment).
// Both click-to-edit: a click drops the cursor into the source they replaced.

import { EditorSelection } from "@codemirror/state";
import { WidgetType, type EditorView } from "@codemirror/view";
import type { Node } from "@cube-drone/marquee-parser";
import type { Profile } from "@cube-drone/marquee-html-renderer";

abstract class ClickToEditWidget extends WidgetType {
  readonly from: number;
  constructor(from: number) {
    super();
    this.from = from;
  }
  protected clickable(el: HTMLElement, view: EditorView): HTMLElement {
    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      view.dispatch({ selection: EditorSelection.cursor(this.from) });
    });
    return el;
  }
  ignoreEvent(): boolean {
    return true;
  }
}

export class EmojiWidget extends ClickToEditWidget {
  readonly slug: string;
  readonly profile: Profile;
  constructor(from: number, slug: string, profile: Profile) {
    super(from);
    this.slug = slug;
    this.profile = profile;
  }
  eq(o: EmojiWidget): boolean {
    return o.slug === this.slug && o.from === this.from;
  }
  toDOM(view: EditorView): HTMLElement {
    const resolved = this.profile.emoji(this.slug);
    let el: HTMLElement;
    if (resolved !== null && typeof resolved === "object") {
      const img = document.createElement("img");
      img.src = resolved.image;
      img.alt = resolved.alt ?? `:${this.slug}:`;
      img.className = "cm-mq-emoji";
      el = img;
    } else {
      el = document.createElement("span");
      el.className = "cm-mq-emoji-text";
      el.textContent = resolved ?? `:${this.slug}:`;
      el.style.cursor = "pointer";
    }
    return this.clickable(el, view);
  }
}

export class BlockWidget extends ClickToEditWidget {
  readonly node: Node;
  readonly html: string;
  constructor(from: number, node: Node, html: string) {
    super(from);
    this.node = node;
    this.html = html;
  }
  eq(o: BlockWidget): boolean {
    // node identity is stable across cursor moves (parse is cached), so an
    // unchanged block is not re-rendered and its effects don't restart.
    return o.node === this.node && o.from === this.from;
  }
  toDOM(view: EditorView): HTMLElement {
    const el = document.createElement("div");
    el.className = "cm-mq-block mq-doc";
    el.innerHTML = this.html;
    // Images/videos load late and change the block's height; CM measured it
    // before the load, so re-measure when they arrive or the coordinate map
    // (clicks, vertical motion) drifts below this block.
    el.querySelectorAll("img, video").forEach((media) => {
      media.addEventListener("load", () => view.requestMeasure(), { once: true });
      media.addEventListener("loadedmetadata", () => view.requestMeasure(), { once: true });
    });
    // Click the rendered block (but not a link/control inside it) to edit.
    el.addEventListener("mousedown", (e) => {
      const t = e.target as HTMLElement;
      if (t.closest("a, audio, video, button, iframe, input") === null) {
        e.preventDefault();
        view.dispatch({ selection: EditorSelection.cursor(this.from) });
      }
    });
    return el;
  }
  ignoreEvent(): boolean {
    return true;
  }
}
