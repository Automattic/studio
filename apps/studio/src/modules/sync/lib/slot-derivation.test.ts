import { describe, it, expect } from 'vitest';
import { deriveSlotAssignments } from './slot-derivation';
import type { SyncSite } from '@studio/common/types/sync';

function site( overrides: Partial< SyncSite > ): SyncSite {
	return {
		id: Math.floor( Math.random() * 1e9 ),
		localSiteId: 'local-1',
		name: 'Site',
		url: 'https://example.com',
		isStaging: false,
		isPressable: false,
		environmentType: 'production',
		syncSupport: 'syncable',
		lastPullTimestamp: null,
		lastPushTimestamp: null,
		...overrides,
	};
}

describe( 'deriveSlotAssignments', () => {
	it( 'returns empty assignments for zero connections', () => {
		expect( deriveSlotAssignments( [] ) ).toEqual( {
			production: null,
			staging: null,
			archived: [],
		} );
	} );

	it( 'assigns a single production site to the production slot', () => {
		const p = site( { id: 1, environmentType: 'production' } );
		const result = deriveSlotAssignments( [ p ] );
		expect( result.production ).toEqual( p );
		expect( result.staging ).toBeNull();
		expect( result.archived ).toEqual( [] );
	} );

	it( 'assigns a staging site (by environmentType) to staging', () => {
		const s = site( { id: 2, environmentType: 'staging', isStaging: true } );
		const result = deriveSlotAssignments( [ s ] );
		expect( result.staging ).toEqual( s );
	} );

	it( 'picks the newest-pushed production when multiple prod sites exist', () => {
		const older = site( {
			id: 1,
			environmentType: 'production',
			lastPushTimestamp: '2026-01-01T00:00:00Z',
		} );
		const newer = site( {
			id: 2,
			environmentType: 'production',
			lastPushTimestamp: '2026-04-01T00:00:00Z',
		} );
		const result = deriveSlotAssignments( [ older, newer ] );
		expect( result.production?.id ).toBe( 2 );
		expect( result.archived.map( ( s ) => s.id ) ).toEqual( [ 1 ] );
	} );

	it( 'honours slotOverride above derivation', () => {
		const prodTyped = site( { id: 1, environmentType: 'production' } );
		const stagingTyped = site( {
			id: 2,
			environmentType: 'staging',
			isStaging: true,
			slotOverride: 'production',
		} );
		const result = deriveSlotAssignments( [ prodTyped, stagingTyped ] );
		expect( result.production?.id ).toBe( 2 );
		expect( result.archived.map( ( s ) => s.id ) ).toEqual( [ 1 ] );
	} );

	it( 'archives sites with slotOverride="archived" even if type matches an open slot', () => {
		const prod = site( {
			id: 1,
			environmentType: 'production',
			slotOverride: 'archived',
		} );
		const result = deriveSlotAssignments( [ prod ] );
		expect( result.production ).toBeNull();
		expect( result.archived.map( ( s ) => s.id ) ).toEqual( [ 1 ] );
	} );

	it( 'treats development/sandbox/local environmentType as archived', () => {
		const dev = site( { id: 1, environmentType: 'development' } );
		const sb = site( { id: 2, environmentType: 'sandbox' } );
		const result = deriveSlotAssignments( [ dev, sb ] );
		expect( result.archived.map( ( s ) => s.id ).sort() ).toEqual( [ 1, 2 ] );
	} );

	it( 'is deterministic for equal-timestamp ties (lowest id wins)', () => {
		const a = site( { id: 5, environmentType: 'production' } );
		const b = site( { id: 2, environmentType: 'production' } );
		const result = deriveSlotAssignments( [ a, b ] );
		expect( result.production?.id ).toBe( 2 );
	} );
} );
