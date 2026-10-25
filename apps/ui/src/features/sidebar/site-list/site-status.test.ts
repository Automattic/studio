import { describe, expect, it } from 'vitest';
import { getSiteStatus, getSiteStatusName } from './site-status';
import type { SiteDetails } from '@/data/core';

const site = { id: 'site-1', running: true } as SiteDetails;

describe( 'getSiteStatus', () => {
	// An operation covers work this window didn't start, such as an agent
	// settings change, so a running site doesn't read as idle.
	it( 'reports a transition for this window’s start or a recorded operation', () => {
		expect( getSiteStatus( site, false, false, null ) ).toBe( 'running' );
		expect( getSiteStatus( { ...site, running: false }, true, false, null ) ).toBe(
			'transitioning'
		);
		expect( getSiteStatus( site, false, false, 'settings' ) ).toBe( 'transitioning' );
	} );
} );

describe( 'getSiteStatusName', () => {
	const base = { running: false, starting: false, stopping: false, operation: null };

	it( 'names an operation over the transition and the running state', () => {
		expect( getSiteStatusName( base ) ).toBe( 'Stopped' );
		expect( getSiteStatusName( { ...base, stopping: true } ) ).toBe( 'Stopping' );
		expect( getSiteStatusName( { ...base, running: true, operation: 'settings' } ) ).toBe(
			'Saving settings'
		);
	} );
} );
