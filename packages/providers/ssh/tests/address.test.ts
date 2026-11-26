import { describe, expect, it } from 'vitest';
import { formatSshAddress, parseSshAddress } from '../address';

describe( 'parseSshAddress', () => {
	it( 'reads scp addresses and ssh URLs', () => {
		expect( parseSshAddress( ' deploy@acme.com:/srv/www/ ' ) ).toEqual( {
			destination: 'deploy@acme.com',
			path: '/srv/www',
		} );
		expect( parseSshAddress( 'acme:public_html' ) ).toEqual( {
			destination: 'acme',
			path: 'public_html',
		} );
		expect( parseSshAddress( 'ssh://deploy@acme.com:2222/srv/www' ) ).toEqual( {
			destination: 'deploy@acme.com',
			port: 2222,
			path: '/srv/www',
		} );
	} );

	it( 'refuses what ssh would read as an option, or a shell would run', () => {
		for ( const address of [
			'-oProxyCommand=evil:/srv',
			'acme.com;rm:/srv',
			'acme.com',
			'acme.com:/',
			'acme.com:/srv\nrm',
		] ) {
			expect( parseSshAddress( address ) ).toBeUndefined();
		}
	} );

	it( 'formats the address it read the same way each time', () => {
		for ( const address of [ 'deploy@acme.com:/srv/www/', 'ssh://acme.com:2222/srv/www' ] ) {
			const once = formatSshAddress( parseSshAddress( address )! );
			expect( formatSshAddress( parseSshAddress( once )! ) ).toBe( once );
		}
	} );
} );
