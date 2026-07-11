# Releasing

**Policy: lockstep.** Every publishable artifact — all npm packages and both crates — carries
the same version, and every release publishes all of them, changed or not.

Why: the spec, the vectors, and the implementations are one conformance unit (see README),
and the vectors are shared state across every package *and both registries*. Lockstep makes
cross-registry agreement a tautology: `@cube-drone/marquee-parser@0.4.0` and the
`marquee-parser 0.4.0` crate passed the same corpus, by definition of the number. The cost —
occasionally republishing an unchanged package — is mild and honest; version skew between
reference implementations would not be.

## The flow

1. **Pre-flight** (clean tree, both languages' full suites, a fuzz run):

   ```
   npm run release-check
   ```

2. **Set the version everywhere** (root + all workspaces + internal `@cube-drone/*` ranges +
   both Cargo.tomls + the crate path-dependency), then refresh the lockfile:

   ```
   npm run set-version -- X.Y.Z
   npm install
   ```

3. **Commit and tag** (yours):

   ```
   git commit -am "release: vX.Y.Z" && git tag vX.Y.Z && git push --tags
   ```

4. **Publish npm packages, in dependency order** (packages marked `private` are skipped
   automatically; `--workspace` order below matters on first publish):

   ```
   npm publish --workspace=@cube-drone/marquee-parser
   npm publish --workspace=@cube-drone/marquee-turbolink
   npm publish --workspace=@cube-drone/marquee-css
   npm publish --workspace=@cube-drone/marquee-html-renderer
   npm publish --workspace=@cube-drone/marquee-fonts
   npm publish --workspace=@cube-drone/marquee-emoji
   npm publish --workspace=@cube-drone/marquee-markup
   ```

5. **Publish crates, parser first** (cargo verifies dependencies exist on the registry):

   ```
   (cd rust/parser && cargo publish)      # cube-drone-marquee-parser
   (cd rust/html_renderer && cargo publish)   # cube-drone-marquee-html-renderer
   ```

Notes:

- Packages ship compiled `dist/` (JS + `.d.ts`; built automatically by `prepack` on publish)
  because Node refuses to type-strip under `node_modules`. In-repo development still runs raw
  source with zero build steps via the `marquee-src` exports condition (test/dev scripts pass
  `--conditions=marquee-src`; tsconfigs use `customConditions`). `release-check` ends with a
  consumer smoke test — pack, install, import from plain node — so this can never silently
  regress.
- `@cube-drone/marquee-turbolink-example-plugin` stays `private: true` (a teaching artifact); flip that
  flag if it should ever be installable.
- Vectors and the spec are CC0 and travel with the repo, not the packages; the version tag is
  the pointer that says which corpus a release passed.
