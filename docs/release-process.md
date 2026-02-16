# Release Process

Releases are managed through [ReleasesV2](https://releases.a8c.com/) and automated via Fastlane + Buildkite. Each step below has a corresponding button in the ReleasesV2 UI that triggers a Buildkite pipeline, which runs the appropriate Fastlane lane.

Builds are signed, notarized (macOS), and uploaded to the Apps CDN automatically. Once on the CDN, auto-update delivers the new version to users.

## Release Lifecycle

### 1. Code Freeze

**ReleasesV2 milestone**: Code Freeze | **Fastlane lane**: `code_freeze`

- Extracts translatable strings and commits them to `trunk` (a wpcom cron imports them to GlotPress)
- Creates `release/<version>` branch from `trunk`
- Bumps version to `<version>-beta1`, creates a GitHub prerelease, and triggers a build

### 2. Beta Releases

**ReleasesV2 milestone**: Beta Release | **Fastlane lane**: `new_beta_release`

- Increments the beta number (e.g. beta1 → beta2)
- Creates a GitHub prerelease and triggers a build
- Repeat as needed for additional betas

### 3. Pre-Release

**ReleasesV2 milestone**: Pre-Release

- **Download translations**: Button triggers `download_translations` lane, which fetches translations from GlotPress and commits them to the release branch
- **Release notes**: Manually update `RELEASE-NOTES.txt` on the `release/<version>` branch (required before finalizing)
- **Smoke tests**: Verify betas on macOS and Windows

### 4. Finalize Release

**ReleasesV2 milestone**: Release | **Fastlane lane**: `finalize_release`

- Removes beta suffix (sets version to `<version>`)
- Creates a **draft** GitHub release with notes from `RELEASE-NOTES.txt`
- Triggers the final release build

### 5. Publish Release

**Fastlane lane**: `publish_release`

- Publishes the draft GitHub release
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

## Running Lanes Locally

Lanes can be run locally for testing (requires Ruby + Bundler setup):

```sh
# Dry run (no pushes, no uploads)
DRY_RUN=true bundle exec fastlane code_freeze version:"1.8.0" skip_confirm:true

# Other lanes
bundle exec fastlane new_beta_release skip_confirm:true
bundle exec fastlane finalize_release version:"1.8.0" skip_confirm:true
bundle exec fastlane publish_release version:"1.8.0" skip_confirm:true
```

## Reference

- [Buildkite pipelines](https://buildkite.com/automattic/studio)
- [ReleasesV2 scenarios](https://releases.a8c.com/)
- [Fastfile](../fastlane/Fastfile) — all lane implementations
- [Localization](localization.md) — string extraction and translation workflow
