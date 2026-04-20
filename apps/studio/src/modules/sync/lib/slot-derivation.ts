import type { SyncSite } from '@studio/common/types/sync';

export type SlotAssignments = {
	production: SyncSite | null;
	staging: SyncSite | null;
	archived: SyncSite[];
};

function compareForSlot( a: SyncSite, b: SyncSite ): number {
	// Explicit slotOverride outranks natural classification.
	const aOverride = a.slotOverride ? 1 : 0;
	const bOverride = b.slotOverride ? 1 : 0;
	if ( aOverride !== bOverride ) {
		return bOverride - aOverride;
	}
	// Newer lastPushTimestamp wins; if equal or both null, lower id wins.
	const aTs = a.lastPushTimestamp ? Date.parse( a.lastPushTimestamp ) : 0;
	const bTs = b.lastPushTimestamp ? Date.parse( b.lastPushTimestamp ) : 0;
	if ( aTs !== bTs ) {
		return bTs - aTs;
	}
	return a.id - b.id;
}

function naturalSlot( s: SyncSite ): 'production' | 'staging' | 'archived' {
	if ( s.slotOverride ) {
		return s.slotOverride;
	}
	if ( s.environmentType === 'staging' || s.isStaging ) {
		return 'staging';
	}
	if ( s.environmentType === 'production' ) {
		return 'production';
	}
	return 'archived';
}

export function deriveSlotAssignments( sites: SyncSite[] ): SlotAssignments {
	const prodCandidates: SyncSite[] = [];
	const stagingCandidates: SyncSite[] = [];
	const archivedCandidates: SyncSite[] = [];

	for ( const s of sites ) {
		const slot = naturalSlot( s );
		if ( slot === 'production' ) {
			prodCandidates.push( s );
		} else if ( slot === 'staging' ) {
			stagingCandidates.push( s );
		} else {
			archivedCandidates.push( s );
		}
	}

	prodCandidates.sort( compareForSlot );
	stagingCandidates.sort( compareForSlot );

	const production = prodCandidates[ 0 ] ?? null;
	const staging = stagingCandidates[ 0 ] ?? null;
	const archived = [
		...prodCandidates.slice( 1 ),
		...stagingCandidates.slice( 1 ),
		...archivedCandidates,
	];

	return { production, staging, archived };
}
