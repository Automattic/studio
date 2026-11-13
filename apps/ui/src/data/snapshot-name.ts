import { __, sprintf } from '@wordpress/i18n';
import type { Snapshot } from '@/data/core';

export function getSnapshotName( snapshot: Snapshot, snapshots: readonly Snapshot[] = [] ): string {
	if ( snapshot.name?.trim() ) return snapshot.name;
	const previews = snapshots
		.filter(
			( item ) => item.localSiteId === snapshot.localSiteId && item.userId === snapshot.userId
		)
		.sort( ( a, b ) => a.date - b.date || a.atomicSiteId - b.atomicSiteId );
	const sequence =
		snapshot.sequence ??
		Math.max(
			1,
			previews.findIndex( ( item ) => item.atomicSiteId === snapshot.atomicSiteId ) + 1
		);
	return sprintf( __( 'Preview %d' ), sequence );
}
