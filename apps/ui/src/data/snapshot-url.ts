import type { Snapshot } from '@/data/core';

export function getSnapshotHostname( snapshot: Snapshot ): string {
	return snapshot.url.replace( /^https?:\/\//, '' ).replace( /\/$/, '' );
}

// The link to give out: a WordPress.com preview opens for others only through its preview link.
export function getSnapshotUrl( snapshot: Snapshot ): string {
	return snapshot.shareUrl ?? `https://${ getSnapshotHostname( snapshot ) }`;
}

// Opening your own preview: a WordPress.com preview signs its owner in through WordPress.com on the way
// (Jetpack SSO), so they land on it as its owner, not as a visitor with the preview link. Other
// previews are public, so they open as they are.
export function getSnapshotOpenUrl( snapshot: Snapshot ): string {
	if ( ! snapshot.shareUrl ) {
		return getSnapshotUrl( snapshot );
	}
	const home = `https://${ getSnapshotHostname( snapshot ) }/`;
	return `${ home }wp-login.php?redirect_to=${ encodeURIComponent( home ) }`;
}
