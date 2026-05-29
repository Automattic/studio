# Release Process

Releases are managed through [ReleasesV2](https://releases.a8c.com/) and automated via Fastlane + Buildkite. Each step below has a corresponding button in the ReleasesV2 UI that triggers a Buildkite pipeline, which runs the appropriate Fastlane lane.

Builds are signed, notarized (macOS), and uploaded to the Apps CDN automatically. Once on the CDN, auto-update delivers the new version to users.

## Release Lifecycle

### 1. Code Freeze

**ReleasesV2 milestone**: Code Freeze | **Fastlane lane**: `code_freeze`

- Creates `release/<version>` branch from `trunk`
- Extracts translatable strings and commits them to the release branch (a wpcom cron imports them to GlotPress via a backmerge PR)
- Generates draft release notes from merged PRs and commits them to the release branch
- Creates a backmerge PR from the release branch into `trunk`

### 2. Beta Releases

**ReleasesV2 milestone**: Beta Release | **Fastlane lane**: `new_beta_release`

- Downloads latest translations from GlotPress and commits them to the release branch
- Increments the beta number (e.g. beta1 → beta2)
- Triggers a build (the build tags the new version and uploads to CDN)
- Creates a backmerge PR from the release branch into `trunk`
- Repeat as needed for additional betas

### 3. Pre-Release

**ReleasesV2 milestone**: Pre-Release

- **Release notes**: Review and refine the draft release notes in `RELEASE-NOTES.txt` on the `release/<version>` branch (a draft is auto-generated during code freeze)
- **Smoke tests**: Verify betas on macOS and Windows

### 4. Finalize Release

**ReleasesV2 milestone**: Release | **Fastlane lane**: `finalize_release`

- Downloads latest translations from GlotPress (to capture any added during the beta period)
- Removes beta suffix (sets version to `<version>`)
- Triggers the final release build, which uploads to the Apps CDN, creates a **draft** GitHub release with notes and download links, and notifies Slack

### 5. Publish Release

**Fastlane lane**: `publish_release`

- Publishes the draft GitHub release (which creates the corresponding GitHub tag too)
- Creates a backmerge PR from `release/<version>` into `trunk`

### 6. Post-Release (manual)

- Publish Windows build to the Microsoft Store
- Update Slack channel bookmark
- Notify team for changelog update
- Notify next Release Wrangler

## Hotfix Releases

**Fastlane lane**: `new_hotfix_release`

- Creates a `release/<version>` branch from the latest release tag (or existing release branch)
- Bumps the version number
- After committing fixes, use `finalize_release` and `publish_release` as normal

## Standalone wp-studio npm Release

The Studio CLI npm package (`wp-studio`) is normally published as part of the regular app release flow — `distribute_release_build` triggers it for betas (with the `next` dist-tag) and `publish_release` triggers it for stable releases (as `latest`).

To publish `wp-studio` to npm **without** running a full app release (e.g. a CLI-only patch), use the two-step flow below. Both `studio-app` and `wp-studio` are bumped to the same version so the desktop app keeps pinning the matching CLI exactly.

**Fastlane lanes**: `prepare_npm_release` → merge PR → `publish_npm_package`

1. **Prepare** — `prepare_npm_release [version:"1.X.Y"]`
    - When `version:` is omitted, defaults to `trunk`'s current version with the patch bumped by one (any `-betaN` suffix is stripped first). Pass `version:` explicitly to bump minor/major or to ship a beta.
    - Creates `npm-release/<version>` from `trunk`
    - Bumps `apps/studio/package.json` and `apps/cli/package.json` to `<version>`
    - Pushes the branch and opens a PR against `trunk`
2. **Review and merge** the PR like any other change.
3. **Publish** — `publish_npm_package [version:"1.X.Y"]`
    - When `version:` is omitted, defaults to `trunk`'s current `package.json` version — i.e. whatever the prepare PR set it to.
    - Locates the commit on `trunk` where both `apps/studio/package.json` and `apps/cli/package.json` declare `<version>`. Tagging that specific commit (not `trunk` HEAD) means unrelated PRs landing on `trunk` between the prep merge and the publish run are **not** included in the published artifact. The search walks history newest-to-oldest, so a later commit that bumped *past* `<version>` (deleting its line) is correctly skipped in favor of the introduction commit. A half-applied prep PR (only one workspace bumped) leaves no commit where both match, so the lane errors out before tagging.
    - Tags the bump commit as `v<version>` and pushes the tag. Idempotent: if the tag already exists at the expected commit, the lane reuses it — so re-running after a failed workflow dispatch picks up where it left off rather than failing on a duplicate-tag error. If the tag exists at a different commit, the lane errors out for manual investigation.
    - Dispatches `publish-npm-package.yml` (publishes to npm with provenance via OIDC trusted publishing)
    - For `X.Y.Z-betaN` the package is published with `--tag next`; otherwise as `latest`
4. **Update the public changelog** at https://developer.wordpress.com/docs/developer-tools/studio/changelog/. The CLI displays a nudge pointing to that page.

### Sanity-checking the npm release lanes locally

Run the lanes end-to-end with `DRY_RUN=true` to see the full plan with no remote side effects — read-only remote queries still happen (`git fetch`, `git ls-remote`) and local commits still happen so you can inspect the diff, but the branch push, the PR creation, the tag push, and the workflow dispatch are all skipped:

```sh
DRY_RUN=true bundle exec fastlane prepare_npm_release version:"1.8.99"
DRY_RUN=true bundle exec fastlane publish_npm_package  version:"1.8.99"
```

Pure helpers used across the release lanes live in `fastlane/lib/`:

- `studio_release_version.rb` — version-string helpers (`valid_version?`, `next_patch_version!`, `npm_dist_tag_for!`, `prerelease?`, `base_version`, `beta_number`).
- `studio_release_git.rb` — git lookups for the npm release lane (`package_json_version_at`, `remote_tag_commit_sha`, `find_npm_release_bump_commit!`).

Both have Minitest sanity checks that run without bundling fastlane. The git suite builds a fixture repo per test (requires `git` on `PATH`):

```sh
ruby fastlane/test/studio_release_version_test.rb
ruby fastlane/test/studio_release_git_test.rb
```

## Running Lanes Locally

Lanes can be run locally for testing. Common requirements are Ruby and Bundler. Additional credentials depend on the lane:

- `publish_npm_package` requires `GITHUB_TOKEN`
- Build-upload lanes such as `distribute_release_build` require `WPCOM_API_TOKEN`
- Lanes that trigger Buildkite builds from a local machine require `BUILDKITE_TOKEN`

```sh

# Running these lanes locally will always print a description of what the lane will do with a confirmation prompt
bundle exec fastlane code_freeze version:"1.8.0"
bundle exec fastlane new_beta_release version:"1.8.0"
bundle exec fastlane finalize_release version:"1.8.0"
bundle exec fastlane publish_release version:"1.8.0"

# Standalone wp-studio npm release (CLI-only patch, no app release)
bundle exec fastlane prepare_npm_release version:"1.8.1"   # bump + open PR
# After the PR merges:
bundle exec fastlane publish_npm_package version:"1.8.1"   # tag the bump commit + dispatch workflow

# Beta of the same flow (publishes with --tag next):
bundle exec fastlane prepare_npm_release version:"1.8.1-beta1"
bundle exec fastlane publish_npm_package version:"1.8.1-beta1"
```

## Reference

- [Buildkite pipelines](https://buildkite.com/automattic/studio)
- [ReleasesV2 scenarios](https://releases.a8c.com/)
- [Fastfile](../fastlane/Fastfile) — all lane implementations
- [Localization](localization.md) — string extraction and translation workflow
