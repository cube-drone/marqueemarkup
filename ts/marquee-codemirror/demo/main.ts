// The live-preview editor, on WRITING.mq. Type on it: the element under your
// cursor shows its syntax; move away and it renders clean. Click an image or
// emoji to edit its source. The corner checkbox toggles vim mode at runtime.

import { EditorView, keymap } from "@codemirror/view";
import { Compartment, EditorState } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { vim } from "@replit/codemirror-vim";
import { standardEmoji } from "@cube-drone/marquee-emoji";
import { composeTurbolinks, defaultPlugins } from "@cube-drone/marquee-turbolink";
import { marquee, type Profile } from "../src/index.ts";
import WRITING from "../../../WRITING.mq";

/** The demo host's policy - the same Profile the renderers take. Resolves
 * the standard emoji table, the house `:angry-burger:`, relative media, and
 * the fetchless turbolink chain (YouTube/Spotify embeds, media by kind) so
 * rendered blocks in the editor look like they will on the page. */
const profile: Partial<Profile> = {
  emoji: (slug) =>
    slug === "angry-burger"
      ? { image: "example-media/angry-burger-emoji.png", alt: ":angry-burger:" }
      : (standardEmoji[slug] ?? null),
  turbolink: composeTurbolinks(defaultPlugins),
};

const root = document.getElementById("root");
if (root !== null) {
  const header = document.createElement("header");
  const h1 = document.createElement("h1");
  h1.textContent = "Marquee — live-preview editor";
  const hint = document.createElement("span");
  hint.className = "hint";
  hint.textContent = "the element under your cursor shows its syntax; move away and it renders clean";

  // A runtime vim toggle, driven by a Compartment (see below).
  const toggle = document.createElement("label");
  toggle.className = "vim-toggle";
  const box = document.createElement("input");
  box.type = "checkbox";
  toggle.append(box, document.createTextNode("vim"));

  header.append(h1, hint, toggle);

  const main = document.createElement("main");
  root.append(header, main);

  // The vim keymap lives in its own Compartment so it can be reconfigured on
  // the fly. vim() must sit BEFORE the other keymaps to win precedence, so the
  // compartment is first in the extension list. Off = an empty extension.
  const vimMode = new Compartment();

  const view = new EditorView({
    parent: main,
    state: EditorState.create({
      doc: WRITING,
      extensions: [
        vimMode.of([]),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        EditorView.lineWrapping,
        marquee({ profile }),
      ],
    }),
  });

  box.addEventListener("change", () => {
    view.dispatch({ effects: vimMode.reconfigure(box.checked ? vim() : []) });
    view.focus();
  });
}
