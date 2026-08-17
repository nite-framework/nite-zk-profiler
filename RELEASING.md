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

2. **Create an npm access token that covers this package name.**

   On npmjs.com, under Access Tokens, create a **Granular Access Token** with
   read and write permission for the `@nite-framework` scope.

   The token's scope has to match the package name or the publish is rejected
   with `E403`. This package is `@nite-framework/nite-zk-profiler`, so a token
   scoped to `@nite-framework` covers it.

   Under the token's **Security settings**, tick **Bypass two-factor
   authentication (2FA)**. If the account enforces 2FA for publishing and the
   token does not waive it, npm answers `EOTP` and asks for a one time password,
   which a CI runner cannot provide.

   Note the ordering trap if the name ever changes: a granular token can only
   select packages that already exist. Publishing a brand new **unscoped** name
   therefore needs a token with **All packages** access, because there is no
   package yet to grant it against. Publishing inside a scope you own avoids
   that entirely.

   **This token approach has an expiry date.** npm is restricting tokens that
   bypass 2FA: account changes from August 2026, and direct publishing from
   January 2027. The replacement is **trusted publishing**, where npm is
   configured to trust this repository and workflow directly and authenticates
   over OIDC, so no `NPM_TOKEN` exists at all. The workflow already grants
   `id-token: write`, which is the permission trusted publishing needs, so
   moving over later is a change on npmjs.com rather than a change here.

3. **Add the token to GitHub.**

   Repository Settings, Secrets and variables, Actions, New repository secret.
   Name it `NPM_TOKEN`.

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
| Publish to npm, `ENEEDAUTH` or `E401` | `NPM_TOKEN` secret missing or expired | Recreate the token and re-add the secret |
| Publish to npm, `E403` "may not perform that action" | Token scope does not cover the package name | Match the token scope to the name, see setup step 2 |
| Publish to npm, `E403` on a name you own | That version was already published | Bump to an unused version |
| Publish to npm, `EOTP` "requires a one-time password" | Account enforces 2FA and the token does not waive it | Tick **Bypass two-factor authentication (2FA)** on the token, see setup step 2 |
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
