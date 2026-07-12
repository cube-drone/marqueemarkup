# Marquee for VS Code

Syntax highlighting for the [Marquee markup language](https://github.com/cube-drone/marqueemarkup)
(`.mq`) — a little bit of markdown, a little bit of RST, a whole lot of dumb old internet.

- Headings (all eight levels), emphasis, strong, strikethrough, code spans
- BBCode-shaped spans (`[blink]`, `[color=#f06]`, `[wave by=letter]`) with attribute coloring
- `:::directive` blocks — opens, named closes, leaf directives, attributes
- Links, embeds, bare-URL turbolinks, `:emoji:` shortcodes, `%%` comments, fenced code
- `%%` line comments toggle with the comment keybinding; `:::` blocks fold

This extension is declarative — one TextMate grammar, zero code, nothing running. The same
grammar file powers highlighting anywhere TextMate grammars are spoken (Shiki, Sublime, and
friends). Grammar correctness is enforced by a scope-assertion test suite in the
[marqueemarkup repo](https://github.com/cube-drone/marqueemarkup), where this extension lives
(`editors/vscode-marquee`).

To learn the language: [WRITING.md](https://github.com/cube-drone/marqueemarkup/blob/main/WRITING.md).
