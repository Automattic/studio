import type { Snapshot } from '@/data/core';

export function getSnapshotHostname( snapshot: Snapshot ): string {
	return snapshot.url.replace( /^https?:\/\//, '' ).replace( /\/$/, '' );
}

// The link to give out: a WordPress.com preview opens for others only through its preview link.
export function getSnapshotUrl( snapshot: Snapshot ): string {
	return snapshot.shareUrl ?? `https://${ getSnapshotHostname( snapshot ) }`;
}
