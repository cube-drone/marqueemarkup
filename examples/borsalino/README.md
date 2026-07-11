# Borsalino's — *We Only Have Spaghetti*

A complete little website written in Marquee: four pages (`index`, `menu`, `gallery`, `map`),
a two-column layout with a navbar and footer **shared between every page** via
`:::include doc=_nav:::` / `:::include doc=_footer:::` (the `_*.mq` files are includable
partials, not pages). The map page pastes a Google Maps link and the stock maps expander
renders it as an OpenStreetMap embed. Gallery photos come from `../../example-media/` and are
copied in at build time.

Build the whole site at once (from `ts/html_renderer/`):

```
npm run build-site -- ../../examples/borsalino /tmp/borsalino
npx serve /tmp/borsalino     # then open http://localhost:3000/index.html
```

The builder is the repo's example *embedder*: it implements include resolution (one level
deep, per spec — includes may not include), resolves doc-id links to built pages, copies
referenced media, ships the stylesheets and fonts as real files, and takes each page's
`<title>` from its `:::meta`.
