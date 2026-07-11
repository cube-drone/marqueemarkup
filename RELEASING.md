# Releasing

**Policy: lockstep.** Every publishable artifact — all npm packages and both crates — carries
the same version, and every release publishes all of them, changed or not.

Why: the spec, the vectors, and the implementations are one conformance unit (see README),
and the vectors are shared state across every package *and both registries*. Lockstep makes
cross-registry agreement a tautology: `@classam/marquee-parser@0.4.0` and the
`marquee-parser 0.4.0` crate passed the same corpus, by definition of the number. The cost —
occasionally republishing an unchanged package — is mild and honest; version skew between
reference implementations would not be.

## The flow

1. **Pre-flight** (clean tree, both languages' full suites, a fuzz run):

   ```
   npm run release-check
   ```

2. **Set the version everywhere** (root + all workspaces + internal `@classam/*` ranges +
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
   npm publish --workspace=@classam/marquee-parser
   npm publish --workspace=@classam/turbolink
   npm publish --workspace=@classam/marquee-css
   npm publish --workspace=@classam/marquee-html-renderer
   npm publish --workspace=@classam/marquee-fonts
   npm publish --workspace=@classam/marquee-markup
   ```

5. **Publish crates, parser first** (cargo verifies dependencies exist on the registry):

   ```
   (cd rust/parser && cargo publish)
   (cd rust/html_renderer && cargo publish)
   ```

Notes:

- npm packages ship TypeScript source (`engines: node >=22.6`); a `dist`/`.d.ts` build is
  deliberately deferred until a consumer needs older toolchains — revisit before 1.0.
- `@classam/turbolink-example-plugin` stays `private: true` (a teaching artifact); flip that
  flag if it should ever be installable.
- Vectors and the spec are CC0 and travel with the repo, not the packages; the version tag is
  the pointer that says which corpus a release passed.
