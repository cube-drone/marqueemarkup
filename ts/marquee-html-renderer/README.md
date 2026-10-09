# @cube-drone/marquee-html-renderer

The reference static HTML renderer for the
[Marquee markup language](https://github.com/cube-drone/marqueemarkup): AST in, HTML fragment
out, zero scripts emitted, ever.

```ts
import { parse } from "@cube-drone/marquee-parser";
import { render, bareWebProfile } from "@cube-drone/marquee-html-renderer";

const html = render(parse(source)); // a <div class="mq-doc"> fragment
```

Embedder policy — which schemes link, how media resolves, what turbolinks become, custom
directive/span vocabulary — is injected via the `Profile` interface; `bareWebProfile` is the
conservative default. The `directive`/`span` hooks (a span is the inline twin of a directive)
are also called by the React renderer and the CodeMirror live preview, so they carry a
contract, documented on the interface and in the spec: claim on name and attrs alone (a probe
with empty children answers the same), stay pure and fetchless, and always place the rendered
children. Pair the output with
[`@cube-drone/marquee-css`](https://www.npmjs.com/package/@cube-drone/marquee-css) (the `mq-*`
class contract this renderer targets) and optionally
[`@cube-drone/marquee-fonts`](https://www.npmjs.com/package/@cube-drone/marquee-fonts).

`linkAllowed` decides *whether* a target links; the optional `linkTarget` decides *where* it
points — return another address (a note's chapter inside an ePub, a file inside an export) or
`null` to keep the target as written. It's asked only after `linkAllowed` says yes, for every
anchor drawn from an author target (links, turbolinks, an embed's fallback link), and the
visible text stays the author's. The React renderer honors it too.

For a page that must be well-formed XML — an ePub chapter, any XHTML document — pass
`{ output: "xhtml" }`: void elements close themselves (`<br/>`, `<img …/>`), boolean
attributes carry values (`controls="controls"`), the only entities are XML's own five, and
characters XML forbids become U+FFFD. Same elements, classes, and words. Hook output is placed
as given, so a profile used this way must return XHTML too.

```ts
render(parse(source), bookProfile, { output: "xhtml" });
renderMarquee(source, bookProfile, { output: "xhtml" }); // same, from source
```

The renderer's obligations (never eat content, comments render nothing, unknown vocabulary
shrugs, invalid constructs render inert placeholders, author bytes never become markup) are
enforced by its behavioral test suite. You probably want
[`@cube-drone/marquee-markup`](https://www.npmjs.com/package/@cube-drone/marquee-markup) unless
you're wiring a custom embedder.
