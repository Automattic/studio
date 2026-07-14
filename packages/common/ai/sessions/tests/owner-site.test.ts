import { describe, expect, it } from 'vitest';
import { aiSessionBelongsToSite, findAiSessionOwnerSite } from '../owner-site';

describe( 'aiSessionBelongsToSite', () => {
	const site = { id: 'site-a', path: '/sites/my-site' };

	it( 'matches by site id when the session has one', () => {
		expect( aiSessionBelongsToSite( { ownerSiteId: 'site-a' }, site ) ).toBe( true );
		expect( aiSessionBelongsToSite( { ownerSiteId: 'site-b' }, site ) ).toBe( false );
	} );

	it( 'never falls back to path when the session has a site id', () => {
		expect(
			aiSessionBelongsToSite( { ownerSiteId: 'deleted-site', ownerSitePath: site.path }, site )
		).toBe( false );
	} );

	it( 'matches legacy sessions without a site id by path', () => {
		expect( aiSessionBelongsToSite( { ownerSitePath: site.path }, site ) ).toBe( true );
		expect( aiSessionBelongsToSite( { ownerSitePath: '/sites/other' }, site ) ).toBe( false );
		expect( aiSessionBelongsToSite( {}, site ) ).toBe( false );
	} );
} );

describe( 'findAiSessionOwnerSite', () => {
	const sites = [
		{ id: 'site-a', path: '/sites/site-a' },
		{ id: 'site-b', path: '/sites/site-b' },
	];

	it( 'prefers the site id over a stale path', () => {
		expect(
			findAiSessionOwnerSite( sites, { ownerSiteId: 'site-b', ownerSitePath: '/sites/site-a' } )
		).toBe( sites[ 1 ] );
	} );

	it( 'returns undefined for a dead site id even when the path matches a site', () => {
		expect(
			findAiSessionOwnerSite( sites, {
				ownerSiteId: 'deleted-site',
				ownerSitePath: '/sites/site-a',
			} )
		).toBeUndefined();
	} );

	it( 'falls back to path for legacy sessions and handles missing input', () => {
		expect( findAiSessionOwnerSite( sites, { ownerSitePath: '/sites/site-a' } ) ).toBe(
			sites[ 0 ]
		);
		expect( findAiSessionOwnerSite( sites, undefined ) ).toBeUndefined();
		expect( findAiSessionOwnerSite( undefined, { ownerSiteId: 'site-a' } ) ).toBeUndefined();
	} );
} );
