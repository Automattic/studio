# What's New modal

The What's New modal allows users to view new features and updates in WordPress Studio.

It opens automatically on app start on each minor and major release. It does not open on patch releases.

The modal can also be opened manually through the app menu via _Help → What's New_.

## Implementation

The What's New modal relies on the `lastSeenVersion` value stored in the app data (`appdata-v1.json`). If the major or minor app version has changed (or if the `lastSeenVersion` value is not present), the modal will open on app start.

If the goal is to display the modal automatically even for a patch version, the `forceNewVersion` flag needs to be set to `true` in the `selectIsNewVersion` (in `src/stores/app-version-api.ts`) for that specific release.
We need to ensure the `forceNewVersion` flag is then set back to `false` for the next release (unless we want to display the modal again for the patch release).

All the modal resources (images, copy and links) are stored in the app (`src/modules/whats-new`).
