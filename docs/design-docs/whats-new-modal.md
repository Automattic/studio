# What's New modal

The What's New modal allows users to view new features and updates in WordPress Studio.

It can also be opened manually through the app menu via _Help → What's New_, or from the ⌘K command palette in both apps.

## Implementation

The modal is a guide in `apps/ui`: its pages (copy and illustrations) are defined in `apps/ui/src/features/onboarding/onboarding-guide/whats-new.ts`, and the illustrations are scenes drawn with the theme tokens in `illustrations/whats-new.tsx`.

`WHATS_NEW_VERSION`, next to the pages, is the content version. Bump it in the same change that replaces the pages. The user's last seen version is `whatsNewSeenVersion` in the onboarding hints in `app.json`, shared by the Desktop app and `studio ui`, so seeing the pages in one settles both. Closing the guide any way (Done, Skip or Esc) records the current version.

`deriveWhatsNewAutostart` (`apps/ui/src/features/onboarding/onboarding-guide/use-whats-new-autostart.ts`) opens it once the user has a site, the workspace state has loaded, and no guide, Welcome, Settings or Add site dialog is open. A first-run user gets the orientation guide instead, and the current version is marked as seen.
