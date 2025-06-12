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
version (before the hyphen) and appending `-dev.abc123`.
See `scripts/prepare-dev-build-version.mjs`.

## Updating Logic

Studio checks for updates on launch and every hour after that, for both release
and dev builds. In case of dev build, if there is prod build bigger than the
latest dev build, then will be updated to the prod build. Otherwise, to the latest dev build.

## Releases Manifest and CDN

The `releases.json` file serves as an authoritative source of update information for the App to update. It is generated entirely by the Apps CDN endpoint https://appscdn.wordpress.com/builds/wordpress-com-studio/releases.json.
