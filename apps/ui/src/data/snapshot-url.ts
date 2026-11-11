import type { Snapshot } from '@/data/core';

export function getSnapshotHostname( snapshot: Snapshot ): string {
	return snapshot.url.replace( /^https?:\/\//, '' ).replace( /\/$/, '' );
}

// The link to give out: a WordPress.com preview opens for others only through its preview link.
export function getSnapshotUrl( snapshot: Snapshot ): string {
	return snapshot.shareUrl ?? `https://${ getSnapshotHostname( snapshot ) }`;
}

// Opening your own preview: a WordPress.com preview signs its owner in through WordPress.com on the way
// (Jetpack SSO), so they land on it as its owner, not as a visitor with the preview link. Until
// WordPress.com reports it can sign them straight in, which on a new preview comes a little after the
// frontend is up, it opens through the preview link instead of stopping at Jetpack's sign-in screen.
// Other previews are public, so they open as they are.
export function getSnapshotOpenUrl( snapshot: Snapshot ): string {
	if ( ! snapshot.shareUrl || ! snapshot.ownerCanSignIn ) {
		return getSnapshotUrl( snapshot );
	}
	const home = `https://${ getSnapshotHostname( snapshot ) }/`;
	return `${ home }wp-login.php?redirect_to=${ encodeURIComponent( home ) }`;
}
