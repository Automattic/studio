# What's New modal

The What's New modal is a feature that allows users to view new features and updates in WordPress Studio.

It opens automatically on app start on each minor and major release. It does not open on patch releases.

The modal can be also opened manually through the app menu via _Help → What's New_.

## Implementation

The What's New modal relies on the `lastSeenVersion` value stored in the app data (`appdata-v1.json`). If the major or minor app version has changed (or if the `lastSeenVersion` value is not present), the modal will open on app start.

If the goal is to display the modal even for a patch version, the `forceNewVersion` flag can be set to `true` in the `src/stores/app-version-api.ts` file.

All the modal resources (images, copy and links) are stored in the app (`src/modules/whats-new`).

## Updating the items in the What's New modal

It is necessary to prepare the modal resources in advance when a new feature project is starting. The aim is to ensure all the resources are available and translated already when the new feature gets released to public.
