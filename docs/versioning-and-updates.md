# Versioning and Updates

## Version Numbers

Studio uses [semver](https://href.li/?https://semver.org/)-style version numbers.

`0.1.0` < `0.2.0` < `0.3.0-beta.1` < `0.3.0`

## “Dev Builds” and “Release Builds”

A **dev build** is any version of the app built from `trunk` using CI. It has
version numbers that look like `0.1.0-dev.e7c8583`, where the suffix is the
changeset it was built from.

A **release build** is version of the app built from a specific changeset that
was chosen by a member of the team by applying a tag to the changeset. It has
version numbers that look like `1.2.3` and `0.1.0-beta.3`. Notice a beta is
still considered a release build. They’re built using the same mechanism and are
out in the wild, generating entries in Sentry etc. From the team’s point of view
there’s no real difference between a beta and a non-beta build.

## Where Versions Come From

Studio’s version is defined in `package.json`. When it’s time to bump to the next
version the new version number should be committed in `package.json`
(e.g. `"version": "1.0.1-beta.1"`). To run the release build in CI the changeset
should be tagged (e.g. `v1.0.1-beta.1`). CI will pick this up automatically.

`package.json` is the authoritative source of the version info, not the tag. But
duplicating the version number in the tag is still useful for comparing
changesets in GitHub.

Dev build versions do not need a change to be made to `package.json`. When
building from `trunk`, CI uses logic in `forge.config.ts` to choose the first
part of the version (before the hyphen) and append `-dev.abc123` automatically.

## Updating Logic

Studio checks for updates on launch and every hour after that.

Release builds:

- Check for updates on launch and every hour after that.
- Ignore dev builds, will only update to another release build.

Dev builds:

- Do not automatically check for updates.
- Check for updates if you use the “Check for Updates” menu item on Mac.
- Ignore release builds, will only update to the latest dev build.

## Releases Manifest and CDN

CI uses the `generate-releases-manifest.json` script to genreate a
`releases.json` file which acts as an authoritative source of update info for
the update server.

When CI has finished building installers it uploads installers _and_ the
releases manifest to the CDN for distribution.
