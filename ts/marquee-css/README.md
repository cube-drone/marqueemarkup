# @classam/marquee-css

The Marquee reference stylesheet: the `mq-*` class contract every renderer targets — effects
under `prefers-reduced-motion` (the exit is contractual), the layout grids, the schemes, the
size dial, placeholders and affordances.

Two ways in:

```ts
import "@classam/marquee-css/marquee.css";      // bundlers: the file itself
import { marqueeCss } from "@classam/marquee-css"; // node: the string, to inline or write
```

Without this stylesheet a rendered document is still readable semantic HTML (and
`<font color>` still colors — the floor of the degradation ladder is the browser itself);
with it, the marquee scrolls. Part of the
[Marquee markup language](https://github.com/cube-drone/marqueemarkup).
