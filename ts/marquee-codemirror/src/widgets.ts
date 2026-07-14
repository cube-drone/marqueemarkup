// CodeMirror widgets. Two kinds:
//   - EmojiWidget: an inline resolved emoji glyph inside augmented source.
//   - BlockWidget: a whole block rendered by the REAL HTML renderer - the
//     leverage move that makes lists look like lists and code like code,
//     because it IS the renderer's output (safe: the renderer escapes author
//     bytes and allowlists targets, as for a static page fragment).
//
// Neither widget stores a document position: positions shift as you edit
// above them, and a stale captured offset would place the cursor wrong.
// Instead the click handler asks the view where the widget currently is
// (posAtDOM). That's also what lets `eq` compare by content alone, so an
// unchanged block keeps its DOM across keystrokes - no re-render, no image
// reload, no height churn (the cause of the scroll flailing).

import { EditorSelection } from "@codemirror/state";
import { WidgetType, type EditorView } from "@codemirror/view";
import type { Profile } from "@cube-drone/marquee-html-renderer";

function cursorInto(view: EditorView, el: HTMLElement): void {
  const pos = view.posAtDOM(el);
  view.dispatch({ selection: EditorSelection.cursor(pos) });
}

export class EmojiWidget extends WidgetType {
  readonly slug: string;
  readonly profile: Profile;
  constructor(slug: string, profile: Profile) {
    super();
    this.slug = slug;
    this.profile = profile;
  }
  eq(o: EmojiWidget): boolean {
    return o.slug === this.slug;
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
    }
    el.style.cursor = "pointer";
    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      cursorInto(view, el);
    });
    return el;
  }
  ignoreEvent(): boolean {
    return true;
  }
}

export class BlockWidget extends WidgetType {
  readonly html: string;
  readonly dimmed: boolean;
  constructor(html: string, dimmed: boolean) {
    super();
    this.html = html;
    this.dimmed = dimmed;
  }
  eq(o: BlockWidget): boolean {
    // Content-only: an unchanged block keeps its DOM across keystrokes.
    return o.html === this.html && o.dimmed === this.dimmed;
  }
  toDOM(view: EditorView): HTMLElement {
    const el = document.createElement("div");
    el.className = this.dimmed ? "cm-mq-block cm-mq-preview mq-doc" : "cm-mq-block mq-doc";
    el.innerHTML = this.html;
    // Media loads late and changes the block's height; CM measured it before
    // the load, so re-measure when it arrives or the coordinate map drifts.
    el.querySelectorAll("img, video").forEach((media) => {
      media.addEventListener("load", () => view.requestMeasure(), { once: true });
      media.addEventListener("loadedmetadata", () => view.requestMeasure(), { once: true });
    });
    // Click the rendered block (but not a link/control inside it) to edit.
    el.addEventListener("mousedown", (e) => {
      const t = e.target as HTMLElement;
      if (t.closest("a, audio, video, button, iframe, input") === null) {
        e.preventDefault();
        cursorInto(view, el);
      }
    });
    return el;
  }
  ignoreEvent(): boolean {
    return true;
  }
}
