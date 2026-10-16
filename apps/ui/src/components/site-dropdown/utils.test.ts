import { DAY_MS } from '@studio/common/constants';
import { describe, expect, it } from 'vitest';
import {
	deriveSiteStatus,
	getSiteStatusName,
	getSnapshotExpiredLabel,
	getSnapshotTimesLabel,
} from './utils';
import type { SiteDetails } from '@/data/core';

function createSite( overrides: Partial< SiteDetails > = {} ): SiteDetails {
	return {
		id: 'site-1',
		name: 'Site',
		path: '/sites/site',
		port: 8881,
		running: false,
		phpVersion: '8.2',
		...overrides,
	} as SiteDetails;
}

describe( 'deriveSiteStatus', () => {
	it( 'reports a stopped site', () => {
		const { status, statusLabel } = deriveSiteStatus( createSite(), false, false, null );

		expect( status ).toBe( 'stopped' );
		expect( statusLabel ).toBe( 'Site is stopped' );
	} );

	it( 'reports this window’s own start', () => {
		const { status, localSublabel } = deriveSiteStatus( createSite(), true, false, null );

		expect( status ).toBe( 'transitioning' );
		expect( localSublabel ).toBe( 'Starting…' );
	} );

	// An operation covers work this window didn't start — an agent settings
	// change, another Studio window. Without it a running site reads as plain
	// "running" while every control beside it is disabled.
	it( 'names an operation over the running state', () => {
		const { status, statusLabel, localSublabel } = deriveSiteStatus(
			createSite( { running: true } ),
			false,
			false,
			'settings'
		);

		expect( status ).toBe( 'transitioning' );
		expect( statusLabel ).toBe( 'Saving settings' );
		expect( localSublabel ).toBe( 'Saving settings…' );
	} );

	it( 'names a duplicate, which has no CLI operation behind it', () => {
		const { localSublabel } = deriveSiteStatus( createSite(), false, false, 'duplicate' );

		expect( localSublabel ).toBe( 'Duplicating…' );
	} );
} );

// Shared by the site dropdown's toggle and the sidebar's status button, so the
// two can't drift on how a busy site is described.
describe( 'getSiteStatusName', () => {
	const base = { running: false, starting: false, stopping: false, operation: null };

	it( 'reports the plain running state', () => {
		expect( getSiteStatusName( { ...base, running: true } ) ).toBe( 'Running' );
		expect( getSiteStatusName( base ) ).toBe( 'Stopped' );
	} );

	it( 'reports this window’s own transition', () => {
		expect( getSiteStatusName( { ...base, starting: true } ) ).toBe( 'Starting' );
		expect( getSiteStatusName( { ...base, stopping: true } ) ).toBe( 'Stopping' );
	} );

	it( 'names an operation over everything else', () => {
		expect( getSiteStatusName( { ...base, running: true, operation: 'settings' } ) ).toBe(
			'Saving settings'
		);
	} );
} );

describe( 'getSnapshotTimesLabel', () => {
	const now = Date.parse( '2026-10-01T12:00:00Z' );
	const snapshot = { url: 'a.example.com', atomicSiteId: 1, localSiteId: 'site-1' };

	it( 'states when a preview was updated and when it expires', () => {
		expect( getSnapshotTimesLabel( { ...snapshot, date: now - 23 * 60_000 }, 'en', now ) ).toBe(
			'Updated 23 min. ago · expires in 7 days'
		);
		expect( getSnapshotTimesLabel( { ...snapshot, date: now }, 'en', now ) ).toBe(
			'Updated now · expires in 7 days'
		);
	} );

	it( 'states how long ago an expired preview expired', () => {
		expect( getSnapshotExpiredLabel( { ...snapshot, date: now - 10 * DAY_MS }, 'en', now ) ).toBe(
			'Expired 3 days ago'
		);
	} );
} );
