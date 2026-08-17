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

2. **Configure trusted publishing on npm.**

   On npmjs.com, open the package, then **Settings**, then **Trusted Publisher**,
   and add a GitHub Actions publisher pointing at this repository and
   `release.yml`.

   The workflow authenticates over OIDC using the `id-token: write` permission
   it already declares. There is no `NPM_TOKEN`, and no secret to rotate or
   leak.

   This replaces access tokens, which no longer work for unattended publishing:
   npm has stopped issuing tokens that bypass 2FA, so a token driven release
   fails with `EOTP` asking for a one time password that a runner cannot supply.

3. **Bootstrapping a brand new package.**

   A trusted publisher is configured per package, so the package has to exist
   before it can be pointed at a repository. The first version therefore has to
   be published by hand, from a machine where 2FA can be answered:

   ```text
   npm login
   npm publish --access public
   ```

   Every release after that goes through the workflow. Only the first one is
   manual, and only because of that ordering. Note that a manual publish carries
   no provenance attestation, since provenance comes from the CI identity.

4. **Leave workflow permissions read only.**

   Repository Settings, Actions, General, Workflow permissions can stay on
   "Read repository contents and packages permissions". `release.yml` declares
   `contents: write` and `id-token: write` itself, and a workflow level
   `permissions` block overrides the repository default. The default only
   applies to workflows that do not declare one, so there is no reason to widen
   it for every workflow in the repository.

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

## When a release fails

Open the failed run under the repository's **Actions** tab and look at which
step went red. The usual causes, in order:

| Step that fails | Cause | Fix |
| --- | --- | --- |
| Publish to npm, `ENEEDAUTH` or `E401` | Trusted publisher not configured, or it names a different repository or workflow file | Check the entry on npmjs.com matches this repo and `release.yml` exactly |
| Publish to npm, `EOTP` "requires a one-time password" | The run fell back to token auth instead of OIDC | Confirm `id-token: write` is present and no `NODE_AUTH_TOKEN` is set |
| Publish to npm, `E403` "may not perform that action" | Package name outside the scope you own | The name must sit under a scope your account controls |
| Publish to npm, `E403` on a name you own | That version was already published | Bump to an unused version |
| Publish to npm, provenance error | Repository is private, or `id-token: write` was removed | Provenance needs a public repo |
| Fail if the tag does not match | Tag was created by hand | Use `npm version`, which tags for you |
| Create the GitHub Release | `contents: write` missing from the workflow | Restore the `permissions` block |

Repository level workflow permissions are **not** a likely cause, because the
workflow grants itself what it needs.

**If the publish step failed, do not bump the version.** Nothing reached the
registry, so that version number is still free. Fix the cause, then use
**Re-run failed jobs** on the failed run in the Actions tab. The tag already
exists and the workflow will replay against it. Bumping instead burns a version
number for no reason.

A tag that already failed can also be reused outright. Delete it locally and
remotely, then push it again once the cause is fixed:

```text
git tag -d v0.1.2
git push origin :refs/tags/v0.1.2
git tag v0.1.2 && git push origin v0.1.2
```

That works for the GitHub Release. It does **not** work for npm: once a version
number is published it can never be reused, so if the publish step succeeded and
a later step failed, bump the version rather than retrying the same one.

## Verifying a release

```text
npm view @nite-framework/nite-zk-profiler versions   # every published version
npx @nite-framework/nite-zk-profiler@latest -v      # what a fresh install gets
```

The GitHub repository shows published versions under **Releases** in the right
hand sidebar, and every tag under **Tags**.
