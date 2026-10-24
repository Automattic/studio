# What's New modal

The What's New modal allows users to view new features and updates in WordPress Studio.

It can also be opened manually through the app menu via _Help → What's New_.

## Implementation

The modal is a guide in `apps/ui`: its pages (copy, illustrations and links) are defined in `apps/ui/src/components/onboarding-guide/whats-new.ts`.

It relies on the `lastSeenVersion` value stored in `app.json` (`useLastSeenVersion` in `apps/ui/src/data/queries/use-whats-new-seen.ts`). `hasUnseenWhatsNew` in `packages/common/lib/whats-new.ts` decides whether it is due:

- when `lastSeenVersion` is not set, the modal is due;
- otherwise it is due only when `FORCE_SHOW_WHATS_NEW` is `true` and the app version changed. Flip the flag to `true` when shipping new modal content, and back to `false` once the next release no longer needs to announce it.

`deriveWhatsNewAutostart` (`apps/ui/src/components/onboarding-guide/use-whats-new-autostart.ts`) opens it only once the user has a site and has been through the orientation guide. A first-run user gets the orientation guide instead, and the current version is marked as seen.
