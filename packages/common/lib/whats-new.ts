// Flip to `true` when shipping new modal content so users who haven't seen the
// current app version get the modal once. Keep at `false` otherwise — the modal
// will only auto-show for first-time users of Studio.
export const FORCE_SHOW_WHATS_NEW = true;

// Whether the announcements should auto-show; see apps/ui/src/features/onboarding/onboarding-guide.
export function hasUnseenWhatsNew(
	lastSeenVersion: string | undefined,
	currentVersion: string | undefined
): boolean {
	if ( ! lastSeenVersion ) {
		return true;
	}
	return FORCE_SHOW_WHATS_NEW && lastSeenVersion !== currentVersion;
}
