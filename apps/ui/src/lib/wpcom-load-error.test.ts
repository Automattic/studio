import { describe, expect, it } from 'vitest';
import { getWpcomLoadErrorDetail } from './wpcom-load-error';

describe( 'getWpcomLoadErrorDetail', () => {
	it( 'suggests connectivity for empty errors', () => {
		expect( getWpcomLoadErrorDetail( undefined ) ).toMatch( /internet connection/ );
		expect( getWpcomLoadErrorDetail( new Error( '' ) ) ).toMatch( /internet connection/ );
	} );

	it( 'classifies expired-session errors', () => {
		expect( getWpcomLoadErrorDetail( new Error( 'Unauthorized (401)' ) ) ).toMatch( /expired/ );
		expect( getWpcomLoadErrorDetail( new Error( 'invalid token' ) ) ).toMatch( /expired/ );
	} );

	it( 'classifies network errors', () => {
		expect( getWpcomLoadErrorDetail( new Error( 'request timed out' ) ) ).toMatch(
			/internet connection/
		);
		expect( getWpcomLoadErrorDetail( new Error( 'fetch failed: ECONNREFUSED' ) ) ).toMatch(
			/internet connection/
		);
	} );

	it( 'classifies rate limiting and server errors', () => {
		expect( getWpcomLoadErrorDetail( new Error( 'Too many requests' ) ) ).toMatch(
			/too many requests/
		);
		expect( getWpcomLoadErrorDetail( new Error( '502 Bad Gateway' ) ) ).toMatch(
			/temporarily unavailable/
		);
	} );

	it( 'strips the Electron IPC prefix and surfaces short raw messages', () => {
		expect(
			getWpcomLoadErrorDetail(
				new Error( "Error invoking remote method 'wpcom:sites': Something specific went wrong" )
			)
		).toBe( 'Something specific went wrong' );
	} );

	it( 'hides long messages and raw HTTP dumps', () => {
		expect( getWpcomLoadErrorDetail( new Error( 'x'.repeat( 200 ) ) ) ).toMatch(
			/internet connection/
		);
		expect( getWpcomLoadErrorDetail( new Error( 'GET /rest/v1.1/me/sites failed' ) ) ).toMatch(
			/internet connection/
		);
	} );
} );
