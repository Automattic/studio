import { describe, expect, it } from 'vitest';
import { prepareErrorEvent, redactHomePaths } from '@studio/common/lib/error-reporting';

describe( 'redactHomePaths', () => {
	it.each( [
		[ "EACCES: permission denied, open '/Users/adam/.zshrc'", "open '/Users/[REDACTED]/.zshrc'" ],
		[ 'spawn C:\\Users\\AL GALIB\\AppData\\node.exe', 'spawn C:\\Users\\[REDACTED]\\AppData' ],
		[ 'C:/Users/Амалия/.studio/php-bin', 'C:/Users/[REDACTED]/.studio' ],
		[ '{"path":"C:\\\\Users\\\\toddc\\\\AppData"}', 'C:\\\\Users\\\\[REDACTED]\\\\AppData' ],
		[ 'Failed in /home/dev/Studio/site', '/home/[REDACTED]/Studio' ],
	] )( 'redacts the account in %s', ( text, expected ) => {
		expect( redactHomePaths( text ) ).toContain( expected );
	} );

	it( 'leaves other paths alone', () => {
		expect( redactHomePaths( '/Applications/Studio.app and https://x.test/Users/1' ) ).toBe(
			'/Applications/Studio.app and https://x.test/Users/1'
		);
	} );
} );

describe( 'prepareErrorEvent', () => {
	const event = (): { message: string; fingerprint?: string[] } => ( {
		message: 'spawn /Users/adam/studio failed',
	} );

	it( 'drops expected errors', () => {
		expect( prepareErrorEvent( event(), { originalException: { expected: true } } ) ).toBeNull();
	} );

	it( 'groups macOS errors by domain and code, and redacts paths', () => {
		const error = Object.assign( new Error( 'Zeitüberschreitung' ), {
			domain: 'NSURLErrorDomain',
			code: -1001,
		} );
		expect( prepareErrorEvent( event(), { originalException: error } ) ).toEqual( {
			message: 'spawn /Users/[REDACTED]/studio failed',
			fingerprint: [ '{{ type }}', 'NSURLErrorDomain', '-1001' ],
		} );
	} );
} );
