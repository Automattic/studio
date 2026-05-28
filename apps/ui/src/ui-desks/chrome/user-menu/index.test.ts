import { describe, expect, it } from 'vitest';
import { getDeskMenuRouteTargets } from './index';

describe( 'getDeskMenuRouteTargets', () => {
	it( 'keeps standalone Desk navigation on the standalone routes', () => {
		expect( getDeskMenuRouteTargets( false ) ).toEqual( {
			userDesk: '/',
			siteDesk: '/sites/$siteId',
		} );
	} );

	it( 'returns to the embedded user Desk route in Studio 2.0', () => {
		expect( getDeskMenuRouteTargets( true ) ).toEqual( {
			userDesk: '/desk',
			siteDesk: '/sites/$siteId',
		} );
	} );
} );
