# Versioning and Updates

## Version Numbers

Studio uses [semver](https://semver.org/)-style version numbers.

`0.1.0` < `0.2.0` < `0.3.0-beta1` < `0.3.0`

## “Dev Builds” and “Release Builds”

A **dev build** is any version of the app built from `trunk` using CI. It has
version numbers that look like `0.1.0-devX`, where the suffix is the
number of commits since the last release tag.

A **release build** is version of the app built from a specific changeset that
was chosen by a member of the team by applying a tag to the changeset. It has
version numbers that look like `1.2.3` and `0.1.0-beta3`. Notice a beta is
still considered a release build. They’re built using the same mechanism and are
out in the wild, generating entries in Sentry etc. From the team’s point of view
there’s no real difference between a beta and a non-beta build.

## Where Versions Come From

Studio’s version is defined in `package.json`. When it’s time to bump to the next
version the new version number should be committed in `package.json`
(e.g. `"version": "1.0.1-beta1"`). To run the release build in CI the changeset
should be tagged (e.g. `v1.0.1-beta1`). CI will pick this up automatically.

`package.json` is the authoritative source of the version info, not the tag. But
duplicating the version number in the tag is still useful for comparing
changesets in GitHub.

To generate dev builds CI modifies `package.json`, using the first part of the
version (before the hyphen) and appending `-devN` where N is the number of commits
since the last release tag. For example: `1.0.0-dev123`.
See `scripts/prepare-dev-build-version.mjs`.

## Updating Logic

Studio checks for updates on launch and every hour after that, for both release
and dev builds. In case of dev build, if there is prod build bigger than the
latest dev build, then will be updated to the prod build. Otherwise, to the latest dev build.

## Update System

Studio uses Electron's built-in auto-updater to check for updates. The update feed URL
is constructed dynamically based on the current platform, architecture, and version,
and queries the WordPress.com API endpoint:

`https://public-api.wordpress.com/wpcom/v2/studio-app/updates?platform={platform}&localStudioArch={localStudioArch}&version={version}`

The API returns information about available updates, and the app downloads and installs
them automatically. See `src/updates.ts` for the implementation.
