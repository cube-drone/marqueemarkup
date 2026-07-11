# @classam/marquee-html-renderer

The reference static HTML renderer for the
[Marquee markup language](https://github.com/cube-drone/marqueemarkup): AST in, HTML fragment
out, zero scripts emitted, ever.

```ts
import { parse } from "@classam/marquee-parser";
import { render, bareWebProfile } from "@classam/marquee-html-renderer";

const html = render(parse(source)); // a <div class="mq-doc"> fragment
```

Embedder policy — which schemes link, how media resolves, what turbolinks become, custom
directive/span vocabulary — is injected via the `Profile` interface; `bareWebProfile` is the
conservative default. Pair the output with
[`@classam/marquee-css`](https://www.npmjs.com/package/@classam/marquee-css) (the `mq-*`
class contract this renderer targets) and optionally
[`@classam/marquee-fonts`](https://www.npmjs.com/package/@classam/marquee-fonts).

The renderer's obligations (never eat content, comments render nothing, unknown vocabulary
shrugs, invalid constructs render inert placeholders, author bytes never become markup) are
enforced by its behavioral test suite. You probably want
[`@classam/marquee-markup`](https://www.npmjs.com/package/@classam/marquee-markup) unless
you're wiring a custom embedder.
