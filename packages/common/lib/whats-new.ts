// Flip to `true` when shipping new modal content so users who haven't seen the
// current app version get the modal once. Keep at `false` otherwise — the modal
// will only auto-show for first-time users of Studio.
//
// Lives here rather than in either app because both renderers read it, and both
// compare it against the same stored `lastSeenVersion`: flipping it once shows
// the announcements in whichever UI the user is running, and dismissing them in
// one settles it for the other.
export const FORCE_SHOW_WHATS_NEW = false;

// Whether the announcements should auto-show. Shared so the two UIs can't drift
// apart on the rule; see apps/studio/src/stores/app-version-api.ts for the
// classic renderer's selector and apps/ui/src/data/onboarding for the agentic
// one.
export function hasUnseenWhatsNew(
	lastSeenVersion: string | undefined,
	currentVersion: string | undefined
): boolean {
	if ( ! lastSeenVersion ) {
		return true;
	}
	return FORCE_SHOW_WHATS_NEW && lastSeenVersion !== currentVersion;
}
