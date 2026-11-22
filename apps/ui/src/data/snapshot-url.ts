import type { Snapshot } from '@/data/core';

export function getSnapshotHostname( snapshot: Snapshot ): string {
	return snapshot.url.replace( /^https?:\/\//, '' ).replace( /\/$/, '' );
}

// The link to give out: a WordPress.com preview opens for others only through its preview link.
export function getSnapshotUrl( snapshot: Snapshot ): string {
	return snapshot.shareUrl ?? `https://${ getSnapshotHostname( snapshot ) }`;
}

// A WordPress.com preview's WP Admin, which signs its owner in through WordPress.com on the way
// (Jetpack SSO). The preview itself opens through its preview link, as visitors see it, the moment it
// is built; signing in to it can take a little longer. Jurassic Ninja previews have none.
export function getSnapshotAdminUrl( snapshot: Snapshot ): string | undefined {
	if ( ! snapshot.shareUrl ) {
		return undefined;
	}
	const home = `https://${ getSnapshotHostname( snapshot ) }/`;
	return `${ home }wp-login.php?redirect_to=${ encodeURIComponent( `${ home }wp-admin/` ) }`;
}
