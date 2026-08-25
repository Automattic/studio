import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSiteDropdownSecondary, getSyncActivityLabel } from './trigger-secondary';
import type { Snapshot, SyncSite } from '@/data/core';

const NOW = '2026-05-03T12:00:00.000Z';

describe( 'getSiteDropdownSecondary', () => {
	beforeEach( () => {
		vi.useFakeTimers();
		vi.setSystemTime( new Date( NOW ) );
	} );

	afterEach( () => {
		vi.useRealTimers();
	} );

	it( 'prioritizes active sync activity over persisted site context', () => {
		expect(
			getSiteDropdownSecondary( {
				activity: { kind: 'pending', direction: 'preview' },
				activeEnvironment: 'local',
				liveSite: createLiveSite( { lastPushTimestamp: '2026-05-03T11:00:00.000Z' } ),
				previewSnapshot: createSnapshot( { date: Date.parse( '2026-05-03T10:00:00.000Z' ) } ),
			} )
		).toEqual( {
			label: 'Publishing preview…',
			tone: 'pending',
		} );
	} );

	it( 'shows preview recency while working locally', () => {
		expect(
			getSiteDropdownSecondary( {
				activity: null,
				activeEnvironment: 'local',
				previewSnapshot: createSnapshot( { date: Date.parse( '2026-05-03T10:00:00.000Z' ) } ),
			} )
		).toEqual( {
			label: 'Preview updated 2h ago',
			tone: 'neutral',
		} );
	} );

	it( 'reports expiry instead of recency once the snapshot is too old', () => {
		expect(
			getSiteDropdownSecondary( {
				activity: null,
				activeEnvironment: 'local',
				previewSnapshot: createSnapshot( { date: Date.parse( '2026-04-25T12:00:00.000Z' ) } ),
			} )
		).toEqual( {
			label: 'Preview expired',
			tone: 'neutral',
		} );
	} );

	it( 'uses live push recency while the session targets live', () => {
		expect(
			getSiteDropdownSecondary( {
				activity: null,
				activeEnvironment: 'live',
				liveSite: createLiveSite( { lastPushTimestamp: '2026-05-03T09:00:00.000Z' } ),
			} )
		).toEqual( {
			label: 'Pushed 3h ago',
			tone: 'neutral',
		} );
	} );

	it( 'falls back to the active environment when no recency exists', () => {
		expect(
			getSiteDropdownSecondary( {
				activity: null,
				activeEnvironment: 'local',
			} )
		).toEqual( {
			label: 'Local preview',
			tone: 'neutral',
		} );

		expect(
			getSiteDropdownSecondary( {
				activity: null,
				activeEnvironment: 'live',
			} )
		).toEqual( {
			label: 'Live site',
			tone: 'neutral',
		} );
	} );
} );

describe( 'getSyncActivityLabel', () => {
	it( 'formats pending push labels by phase', () => {
		expect(
			getSyncActivityLabel( { kind: 'pending', direction: 'push', phase: 'creating-backup' } )
		).toBe( 'Backing up live site…' );
		expect(
			getSyncActivityLabel( { kind: 'pending', direction: 'push', phase: 'applying' } )
		).toBe( 'Applying live changes…' );
	} );

	it( 'formats error labels by direction', () => {
		expect( getSyncActivityLabel( { kind: 'error', direction: 'push', message: 'Nope' } ) ).toBe(
			'Pushing to live failed'
		);
		expect( getSyncActivityLabel( { kind: 'error', direction: 'pull', message: 'Nope' } ) ).toBe(
			'Pulling from live failed'
		);
		expect( getSyncActivityLabel( { kind: 'error', direction: 'preview', message: 'Nope' } ) ).toBe(
			'Publishing preview failed'
		);
	} );
} );

function createSnapshot( overrides: Partial< Snapshot > = {} ): Snapshot {
	return {
		atomicSiteId: 123,
		localSiteId: 'site-1',
		url: 'example.preview.wordpress.com',
		date: Date.parse( NOW ),
		...overrides,
	};
}

function createLiveSite( overrides: Partial< SyncSite > = {} ): SyncSite {
	return {
		id: 123,
		localSiteId: 'site-1',
		name: 'Live Site',
		url: 'example.com',
		isStaging: false,
		isPressable: false,
		syncSupport: 'already-connected',
		lastPullTimestamp: null,
		lastPushTimestamp: null,
		...overrides,
	};
}
