# Releasing

Releases are cut from a git tag. Pushing a `v*` tag publishes to npm and creates
the matching GitHub Release, so the two never drift apart.

## One time setup

1. **Push the repository to GitHub.**

   ```text
   git push -u origin main
   ```

   Do this before publishing anything. The `repository` field in package.json
   points at the GitHub repo, and npm renders that link on the package page.

2. **Create an npm access token.**

   On npmjs.com, under Access Tokens, create a **Granular Access Token** with
   read and write permission for this package. Classic automation tokens also
   work, but granular tokens can be scoped to a single package and expire.

3. **Add the token to GitHub.**

   Repository Settings, Secrets and variables, Actions, New repository secret.
   Name it `NPM_TOKEN`.

4. **Allow Actions to create releases.**

   Repository Settings, Actions, General, Workflow permissions. The workflow
   requests `contents: write` explicitly, but the repository must not be set to
   read only for it to take effect.

## Cutting a release

1. **Make sure `main` is clean and green.**

   ```text
   npm run typecheck && npm test && npm run build
   ```

2. **Bump the version and tag it.**

   ```text
   npm version patch        # or minor, major, or an exact version like 1.0.0
   ```

   This edits package.json and package-lock.json, commits both, and creates a
   `v<version>` tag.

3. **Push the commit and the tag.**

   ```text
   git push --follow-tags
   ```

4. **Watch the Release workflow.** It verifies the tag matches package.json,
   typechecks, runs the tests, builds, publishes to npm with a provenance
   attestation, and opens the GitHub Release with generated notes.

That is the whole flow. The tag is the trigger, so there is no separate publish
step to forget.

## Which version number

Choose deliberately, because npm never lets a version be reused or overwritten,
even after `npm unpublish`.

- `0.x` signals the interface may still change. Reasonable while the supported
  toolchain range is narrow.
- `1.0.0` signals a stable command line surface and budget file format.

## Publishing by hand

If the workflow is unavailable:

```text
npm login
npm publish
```

`npm publish` runs `prepublishOnly`, which typechecks, tests and builds before
packing, so a missing or stale `dist` cannot ship. It does not create the
GitHub Release, and it does not attach a provenance attestation. Tag and push
separately if you go this route:

```text
git tag v0.1.0 && git push origin v0.1.0
```

## Verifying a release

```text
npm view nite-zk-profiler versions      # every published version
npx nite-zk-profiler@latest --version   # what a fresh install gets
```

The GitHub repository shows published versions under **Releases** in the right
hand sidebar, and every tag under **Tags**.
