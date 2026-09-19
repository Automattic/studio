import { assertPublicHost, parseSiteUrl } from './guards.ts';
import { isPublicAddress } from './network.mjs';

describe( 'parseSiteUrl', () => {
	it( 'accepts bare domains and full URLs', () => {
		expect( parseSiteUrl( ' mysite.com ' ).href ).toBe( 'https://mysite.com/' );
		expect( parseSiteUrl( 'http://www.mysite.com/blog#top' ).href ).toBe(
			'http://www.mysite.com/blog'
		);
		expect( parseSiteUrl( 'https://mysite.com:443/' ).href ).toBe( 'https://mysite.com/' );
	} );

	it.each( [
		'',
		'not a url',
		'ftp://mysite.com',
		'javascript:alert(1)',
		'https://user:pass@mysite.com',
		'https://mysite.com:8080',
		'https://intranet',
		'https://printer.local',
		'https://app.localhost',
		'x'.repeat( 3000 ),
	] )( 'rejects %j', ( input ) => {
		expect( () => parseSiteUrl( input ) ).toThrow();
	} );
} );

describe( 'isPublicAddress', () => {
	it.each( [
		'127.0.0.1',
		'10.1.2.3',
		'172.20.0.1',
		'192.168.1.1',
		'169.254.169.254',
		'100.64.0.1',
		'0.0.0.0',
		'::1',
		'::',
		'fd00::1',
		'fe80::1',
		'::ffff:127.0.0.1',
		'not-an-ip',
	] )( 'rejects %s', ( address ) => {
		expect( isPublicAddress( address ) ).toBe( false );
	} );

	it.each( [ '93.184.215.14', '2606:4700::1111', '::ffff:93.184.215.14' ] )(
		'accepts %s',
		( address ) => {
			expect( isPublicAddress( address ) ).toBe( true );
		}
	);
} );

describe( 'assertPublicHost', () => {
	const resolvesTo =
		( ...addresses: string[] ) =>
		async () =>
			addresses.map( ( address ) => ( { address } ) );

	it( 'accepts hosts that only resolve to public addresses', async () => {
		await expect(
			assertPublicHost( 'mysite.com', resolvesTo( '93.184.215.14' ) )
		).resolves.toBeUndefined();
	} );

	it( 'rejects hosts with any private address, or none', async () => {
		await expect(
			assertPublicHost( 'mysite.com', resolvesTo( '93.184.215.14', '10.0.0.1' ) )
		).rejects.toThrow( 'isn’t a public website' );
		await expect( assertPublicHost( 'mysite.com', resolvesTo() ) ).rejects.toThrow(
			'couldn’t find'
		);
		await expect(
			assertPublicHost( 'mysite.com', () => Promise.reject( new Error( 'ENOTFOUND' ) ) )
		).rejects.toThrow( 'couldn’t find' );
	} );
} );
