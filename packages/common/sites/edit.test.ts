import { buildSiteSetArgs } from './edit';

const base = { path: '/sites/example', siteId: 'abc123' };

describe( 'buildSiteSetArgs', () => {
	it( 'forwards only the path when nothing changed', () => {
		expect( buildSiteSetArgs( base ) ).toEqual( [ 'site', 'set', '--path', '/sites/example' ] );
	} );

	it( 'forwards --script-debug when script debug is enabled', () => {
		expect( buildSiteSetArgs( { ...base, scriptDebug: true } ) ).toContain( '--script-debug' );
	} );

	it( 'forwards --no-script-debug when script debug is disabled', () => {
		expect( buildSiteSetArgs( { ...base, scriptDebug: false } ) ).toContain( '--no-script-debug' );
	} );

	it( 'forwards the environment type as a value', () => {
		expect( buildSiteSetArgs( { ...base, environmentType: 'staging' } ) ).toEqual(
			expect.arrayContaining( [ '--environment-type', 'staging' ] )
		);
	} );

	it( 'omits both flags when neither is set', () => {
		const args = buildSiteSetArgs( { ...base, name: 'Example' } );
		expect( args ).not.toContain( '--script-debug' );
		expect( args ).not.toContain( '--no-script-debug' );
		expect( args ).not.toContain( '--environment-type' );
	} );
} );
