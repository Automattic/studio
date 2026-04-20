import { deriveSlotAssignments } from './slot-derivation';
import type { SyncSite } from '../../types/sync';

export function migrateConnectedSitesToSlots( sites: SyncSite[] ): SyncSite[] {
	if ( sites.length <= 2 ) {
		return sites;
	}
	const { production, staging, archived } = deriveSlotAssignments( sites );
	const archivedIds = new Set( archived.map( ( s ) => s.id ) );
	return sites.map( ( s ) => {
		if ( archivedIds.has( s.id ) ) {
			if ( s.slotOverride === 'archived' ) {
				return s;
			}
			return { ...s, slotOverride: 'archived' as const };
		}
		if ( s.id === production?.id || s.id === staging?.id ) {
			// Ensure no stale override remains on sites that hold a slot naturally.
			if ( s.slotOverride === 'archived' ) {
				const copy = { ...s };
				delete copy.slotOverride;
				return copy;
			}
		}
		return s;
	} );
}
