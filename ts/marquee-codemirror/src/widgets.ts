// CodeMirror widgets for the ranges the planner chose to replace. Each is
// clickable: a click drops the cursor into the source it replaced, which
// makes the planner re-open that range on the next update - the "click the
// rendered thing to edit its source" half of the live-preview gesture.

import { EditorSelection } from "@codemirror/state";
import { WidgetType, type EditorView } from "@codemirror/view";
import type { Profile } from "@cube-drone/marquee-html-renderer";
import type { WidgetSpec } from "./plan.ts";

abstract class ClickToEditWidget extends WidgetType {
  readonly from: number;
  constructor(from: number) {
    super();
    this.from = from;
  }
  protected clickable(el: HTMLElement, view: EditorView): HTMLElement {
    el.style.cursor = "pointer";
    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      view.dispatch({ selection: EditorSelection.cursor(this.from) });
    });
    return el;
  }
  ignoreEvent(): boolean {
    return true; // let the DOM event reach our mousedown handler
  }
}

export class ImageWidget extends ClickToEditWidget {
  readonly target: string;
  readonly alt: string;
  readonly profile: Profile;
  constructor(from: number, target: string, alt: string, profile: Profile) {
    super(from);
    this.target = target;
    this.alt = alt;
    this.profile = profile;
  }
  eq(o: ImageWidget): boolean {
    return o.target === this.target && o.alt === this.alt && o.from === this.from;
  }
  toDOM(view: EditorView): HTMLElement {
    const media = this.profile.media(this.target);
    let el: HTMLElement;
    if (media !== null && media.kind === "image") {
      const img = document.createElement("img");
      img.src = media.url;
      img.alt = this.alt;
      img.className = "cm-mq-image";
      el = img;
    } else {
      el = document.createElement("span");
      el.className = "cm-mq-placeholder";
      el.textContent = this.alt === "" ? this.target : this.alt;
    }
    return this.clickable(el, view);
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
    }
    return this.clickable(el, view);
  }
}

export class RuleWidget extends ClickToEditWidget {
  eq(o: RuleWidget): boolean {
    return o.from === this.from;
  }
  toDOM(view: EditorView): HTMLElement {
    const el = document.createElement("span");
    el.className = "cm-mq-rule";
    return this.clickable(el, view);
  }
}

export function makeWidget(spec: WidgetSpec, from: number, profile: Profile): WidgetType {
  switch (spec.type) {
    case "image":
      return new ImageWidget(from, spec.target, spec.alt, profile);
    case "emoji":
      return new EmojiWidget(from, spec.slug, profile);
    case "rule":
      return new RuleWidget(from);
  }
}
