import { describe, it, expect } from 'vitest';
import type { SyncSite } from '../../types/sync';
import { migrateConnectedSitesToSlots } from './slot-migration';

function s( partial: Partial< SyncSite > ): SyncSite {
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
		...partial,
	} as SyncSite;
}

describe( 'migrateConnectedSitesToSlots', () => {
	it( 'no-ops for 0, 1, or 2 connections', () => {
		expect( migrateConnectedSitesToSlots( [] ) ).toEqual( [] );
		const one = [ s( { id: 1 } ) ];
		expect( migrateConnectedSitesToSlots( one ) ).toEqual( one );
		const two = [ s( { id: 1 } ), s( { id: 2, environmentType: 'staging' } ) ];
		expect( migrateConnectedSitesToSlots( two ) ).toEqual( two );
	} );

	it( 'archives sites that fall out of slots when >2 connections', () => {
		const sites = [
			s( { id: 1, environmentType: 'production', lastPushTimestamp: '2026-03-01T00:00:00Z' } ),
			s( { id: 2, environmentType: 'production', lastPushTimestamp: '2026-01-01T00:00:00Z' } ),
			s( { id: 3, environmentType: 'staging' } ),
			s( { id: 4, environmentType: 'production' } ),
		];
		const migrated = migrateConnectedSitesToSlots( sites );
		expect( migrated.find( ( x ) => x.id === 1 )?.slotOverride ).toBeUndefined();
		expect( migrated.find( ( x ) => x.id === 3 )?.slotOverride ).toBeUndefined();
		expect( migrated.find( ( x ) => x.id === 2 )?.slotOverride ).toBe( 'archived' );
		expect( migrated.find( ( x ) => x.id === 4 )?.slotOverride ).toBe( 'archived' );
	} );

	it( 'is idempotent (running twice yields same result)', () => {
		const sites = [
			s( { id: 1, environmentType: 'production' } ),
			s( { id: 2, environmentType: 'production' } ),
			s( { id: 3, environmentType: 'production' } ),
		];
		const once = migrateConnectedSitesToSlots( sites );
		const twice = migrateConnectedSitesToSlots( once );
		expect( twice ).toEqual( once );
	} );
} );
