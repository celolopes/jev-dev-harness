# Publishing a stable release

The harness version is independent of the Jev model version. This release is
`jev-dev-harness@0.2.8`, with Git tag `v0.2.8` and npm dist-tag `latest`.
`latest` is an npm distribution pointer, not a Git tag.

## Prepare and validate

From a clean checkout of `main` with Node.js 22 or newer:

```sh
git pull --ff-only origin main
npm ci
npm run release:dry-run
npm pack --dry-run
```

The publish dry run executes version checks, type checking, build and tests via
`prepublishOnly`. `prepack` rebuilds `dist` for packing. Inspect the package file
list and ensure it contains the compiled entry points, binaries and no secrets.
The dry run does not upload a package or move the npm `latest` pointer.

## Publish 0.2.8

Use your npm maintainer account; complete login/2FA locally. Do not commit tokens.
Check that 0.2.8 has not already been published before uploading:

```sh
npm whoami
npm view jev-dev-harness versions --json
git tag -a v0.2.8 -m "Release 0.2.8"
npm run release:publish
git push origin v0.2.8
npm view jev-dev-harness@0.2.8 version
npm dist-tag ls jev-dev-harness
```

Run these commands separately and stop on any error. Publish only the clean,
validated commit tagged above. `release:publish` runs `npm publish --tag latest`;
`publishConfig` also pins the public npm registry and `latest` for plain
`npm publish`. A successful publication should show `latest: 0.2.8`.
If publication fails, resolve the authentication or registry error before pushing
the tag. Do not move an existing published tag or reuse a published version.

After publication, create a GitHub release from `v0.2.8` using the changelog.
There is no automatic npm publication workflow; merging code or pushing a tag
alone does not publish the package.

## Next release

Before committing the next stable release:

```sh
npm version patch --no-git-tag-version
```

Update the fallback in `src/shared/version.ts` and add matching release notes.
Run the checks, commit and merge, then repeat the publication steps with the new
version/tag. Prereleases should use a separate process and npm tag such as `next`.

## Update local installations

```sh
npm install -g jev-dev-harness@latest
jev-dev --version
```

For an installation linked to a Git checkout, pull the release commit and run
`npm ci` and `npm run build` instead. Restart the Codex MCP session so the process
loads the updated build. An already-running server keeps its old code in memory.
