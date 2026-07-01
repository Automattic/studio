import { siteNeedsRestart } from '../site-needs-restart';

describe( 'siteNeedsRestart', () => {
	it( 'returns false when no changes are provided', () => {
		expect( siteNeedsRestart( {} ) ).toBe( false );
	} );

	it( 'returns false when all changes are false', () => {
		expect(
			siteNeedsRestart( {
				domainChanged: false,
				httpsChanged: false,
				phpChanged: false,
				wpChanged: false,
				xdebugChanged: false,
			} )
		).toBe( false );
	} );

	it( 'returns true when domain changed', () => {
		expect( siteNeedsRestart( { domainChanged: true } ) ).toBe( true );
	} );

	it( 'returns true when https changed', () => {
		expect( siteNeedsRestart( { httpsChanged: true } ) ).toBe( true );
	} );

	it( 'returns true when php changed', () => {
		expect( siteNeedsRestart( { phpChanged: true } ) ).toBe( true );
	} );

	it( 'returns true when wp changed', () => {
		expect( siteNeedsRestart( { wpChanged: true } ) ).toBe( true );
	} );

	it( 'returns true when xdebug changed', () => {
		expect( siteNeedsRestart( { xdebugChanged: true } ) ).toBe( true );
	} );

	it( 'returns true when multiple settings changed', () => {
		expect(
			siteNeedsRestart( {
				phpChanged: true,
				wpChanged: true,
			} )
		).toBe( true );
	} );

	it( 'returns true when one change is true among false values', () => {
		expect(
			siteNeedsRestart( {
				domainChanged: false,
				httpsChanged: false,
				phpChanged: true,
				wpChanged: false,
				xdebugChanged: false,
			} )
		).toBe( true );
	} );
} );
