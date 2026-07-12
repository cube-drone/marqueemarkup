# Releasing

If you're not me, this document isn't for you, because you don't have to publish this
fuckin' 18 package jambaroo. 

## The First Time (To Establish Packages)
```
cp publish.env.example publish.env    # once: fill in the tokens (the file
                                      # explains how to mint each one)
npm run release                       # prompts micro/minor/major, does the rest
```

## Every Subsequent Time (Once You Have )

```
npm run release -- --tag-only 
```


`npm run release` runs the whole ceremony: release-check → set-version →
release commit + git tag → every npm publish in dependency order → every
cargo publish in dependency order → offers to push. It's **safely
rerunnable**: each publish checks the registry first and skips versions
already there, so a run that dies halfway (network, expired token) resumes
by running it again. `--dry-run` prints the plan without uploading or
tagging; `--bump minor` / an explicit `0.2.0` skip the prompt;
`--skip-checks` resumes without re-running the gate.

**The token flow above is the bootstrap** (both registries require a
package to exist before trusted publishing can be configured for it). The
permanent, token-free flow:

1. After the first release, configure **trusted publishing** for each npm
   package (npmjs.com → package → Settings → Trusted Publisher → this repo,
   `.github/workflows/release.yml`) and each crate (crates.io → crate →
   Settings → Trusted Publishing → same), then **revoke the tokens**.
2. From then on: `npm run release -- --tag-only` does the local half (gate,
   version, commit, tag, push), and the pushed tag triggers `release.yml`,
   which re-runs the gate and publishes everywhere via per-run OIDC
   credentials — no stored secrets, npm provenance attestations included.
   Re-running the workflow is always safe (same skip-if-published checks).

## Lockstep

**Policy: lockstep.** Every publishable artifact — all npm packages and both crates — carries
the same version, and every release publishes all of them, changed or not.

Why: the spec, the vectors, and the implementations are one conformance unit (see README),
and the vectors are shared state across every package *and both registries*. Lockstep makes
cross-registry agreement a tautology: `@cube-drone/marquee-parser@0.4.0` and the
`marquee-parser 0.4.0` crate passed the same corpus, by definition of the number. The cost —
occasionally republishing an unchanged package — is mild and honest; version skew between
reference implementations would not be.

## What it does, step by step (the manual fallback)

1. **Pre-flight** (clean tree, both languages' full suites, a fuzz run):

   ```
   npm run release-check
   ```

2. **Set the version everywhere** (root + all workspaces + internal `@cube-drone/*` ranges +
   all three Cargo.tomls + the crate path-dependencies), then refresh BOTH lockfile kinds —
   Cargo.locks still naming the old version will dirty CI's tree at the first cargo command:

   ```
   npm run set-version -- X.Y.Z
   npm install
   (cd rust/parser && cargo metadata --format-version 1 > /dev/null)
   (cd rust/html_renderer && cargo metadata --format-version 1 > /dev/null)
   (cd rust/markup && cargo metadata --format-version 1 > /dev/null)
   ```

3. **Commit and tag**:

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
   (cd rust/markup && cargo publish)      # cube-drone-marquee-markup (the omnibus + CLI)
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


### The Fucking Microsoft Dealio

Currently we're manually updating the VSCode Plugin at 
https://marketplace.visualstudio.com/manage/publishers/cube-drone

I hate Azure. 