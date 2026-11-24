import { parseRemoteSite } from '@studio/providers';

/**
 * Whether `studio pull` uses Reprint instead of a Jetpack Backup. Reprint is opt-in while it is
 * trialled: set `STUDIO_ENABLE_PULL_REPRINT` in the environment of the CLI or of the Studio app,
 * whose CLI processes inherit it.
 */
export function isReprintPullEnabled(): boolean {
	return Boolean( process.env.STUDIO_ENABLE_PULL_REPRINT );
}

// Whether pulling `remoteSite`, as `--remote-site` names it, uses Reprint: only WordPress.com sites do.
export function usesReprintPull( remoteSite: string | undefined ): boolean {
	return isReprintPullEnabled() && parseRemoteSite( remoteSite ).provider === 'wpcom';
}
