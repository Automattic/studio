import { describe, expect, it } from 'vitest';
import { getDefaultPhpArgs } from 'cli/lib/native-php/config';

describe( 'getDefaultPhpArgs', () => {
	it( 'omits Xdebug directives by default', () => {
		const args = getDefaultPhpArgs( '8.4' );

		expect( args.join( ' ' ) ).not.toContain( 'xdebug' );
	} );

	it( 'starts an Xdebug session on every request when enabled', () => {
		const args = getDefaultPhpArgs( '8.4', { enableXdebug: true } );

		expect( args ).toContain( 'xdebug.mode=debug' );
		expect( args ).toContain( 'xdebug.start_with_request=yes' );
	} );
} );
