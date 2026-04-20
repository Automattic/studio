import { describe, it, expect } from 'vitest';
import { deriveSlotAssignments } from '../../lib/slot-derivation';
import type { SyncSite } from '@studio/common/types/sync';

// Full component rendering requires the entire Redux root store + router + Auth
// provider wired up. We instead validate the slot-derivation wiring that the
// TriangleLayout depends on — this covers the core "only Local", "Local+Prod",
// and "all three" rendering decisions the component makes.

function site( o: Partial< SyncSite > ): SyncSite {
	return {
		id: 0,
		localSiteId: 'local',
		name: '',
		url: '',
		isStaging: false,
		isPressable: false,
		environmentType: 'production',
		syncSupport: 'syncable',
		lastPullTimestamp: null,
		lastPushTimestamp: null,
		...o,
	};
}

describe( 'TriangleLayout slot wiring', () => {
	it( 'no remotes → no production/staging slots', () => {
		const { production, staging, archived } = deriveSlotAssignments( [] );
		expect( production ).toBeNull();
		expect( staging ).toBeNull();
		expect( archived ).toEqual( [] );
	} );

	it( 'only production → production slot filled, staging empty', () => {
		const { production, staging } = deriveSlotAssignments( [
			site( { id: 1, environmentType: 'production' } ),
		] );
		expect( production?.id ).toBe( 1 );
		expect( staging ).toBeNull();
	} );

	it( 'production + staging → both slots filled', () => {
		const { production, staging } = deriveSlotAssignments( [
			site( { id: 1, environmentType: 'production' } ),
			site( { id: 2, environmentType: 'staging', isStaging: true } ),
		] );
		expect( production?.id ).toBe( 1 );
		expect( staging?.id ).toBe( 2 );
	} );

	it( 'three production sites → one slot + two archived', () => {
		const { production, archived } = deriveSlotAssignments( [
			site( { id: 1, environmentType: 'production' } ),
			site( { id: 2, environmentType: 'production' } ),
			site( { id: 3, environmentType: 'production' } ),
		] );
		expect( production ).not.toBeNull();
		expect( archived.length ).toBe( 2 );
	} );
} );
