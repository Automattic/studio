import type { Snapshot } from '@/data/core';

export function getSnapshotHostname( snapshot: Snapshot ): string {
	return snapshot.url.replace( /^https?:\/\//, '' ).replace( /\/$/, '' );
}

export function getSnapshotUrl( snapshot: Snapshot ): string {
	return `https://${ getSnapshotHostname( snapshot ) }`;
}
