# Release Process

Release builds are built, signed, notarized, and uploaded to the CDN by [Buildkite](https://buildkite.com/automattic/studio).
Once the release is on the CDN the auto-update process will start downloading the new version.

## Creating a Release

These instructions are for creating version 0.1.0-alpha.5, but the steps are the same for releases with no pre-release tag.

1. Create a PR which updates the `version` field in `package.json` to `'0.1.0-alpha5'`.
   - Remember to run `npm install` so the version in `package-lock.json` gets updated too.
2. Merge this PR.
3. Make a note of the commit hash of the PR which was just merged into `trunk`, e.g. `a1c70f3a3be5d28922a48f7f298f6152d6001516`
4. Tag this commit with `v0.1.0-alpha5`:
   1. On your local machine get the latest code: `git checkout trunk && git pull`
   2. Create the tag: `git tag v0.1.0-alpha5 a1c70f3a3be5d28922a48f7f298f6152d6001516`
   3. Push the tag to the GitHub repo: `git push origin v0.1.0-alpha5`

Pushing the tag will automatically start the build and release process, and is complete when the build finishes cleanly.
