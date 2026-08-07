import { describe, expect, it } from 'vitest';
import { deriveSiteStatus } from './utils';
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

	// An operation covers work this window didn't start — an agent export,
	// another Studio window. Without it a running site reads as plain "running"
	// while every control beside it is disabled.
	it( 'names an operation over the running state', () => {
		const { status, statusLabel, localSublabel } = deriveSiteStatus(
			createSite( { running: true } ),
			false,
			false,
			'export'
		);

		expect( status ).toBe( 'transitioning' );
		expect( statusLabel ).toBe( 'Exporting' );
		expect( localSublabel ).toBe( 'Exporting…' );
	} );

	it( 'names a duplicate, which has no CLI lease behind it', () => {
		const { localSublabel } = deriveSiteStatus( createSite(), false, false, 'duplicate' );

		expect( localSublabel ).toBe( 'Duplicating…' );
	} );
} );
