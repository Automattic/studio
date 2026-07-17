import { isPhpUserError, parsePhpError } from 'src/lib/php-error-recovery';

describe( 'isPhpUserError', () => {
	test( 'returns false for non-Error values', () => {
		expect( isPhpUserError( 'boom' ) ).toBe( false );
		expect( isPhpUserError( null ) ).toBe( false );
		expect( isPhpUserError( undefined ) ).toBe( false );
	} );

	test( 'returns false for known infrastructure errors', () => {
		expect( isPhpUserError( new Error( 'Cannot allocate Wasm memory for new instance' ) ) ).toBe(
			false
		);
		expect( isPhpUserError( new Error( 'listen EADDRINUSE: address already in use' ) ) ).toBe(
			false
		);
		expect( isPhpUserError( new Error( 'Operation aborted' ) ) ).toBe( false );
		expect( isPhpUserError( new Error( '"unreachable" WASM instruction executed' ) ) ).toBe(
			false
		);
	} );

	test( 'treats any other Error as a user PHP error', () => {
		expect(
			isPhpUserError( new Error( 'Failed to start WordPress server: critical error' ) )
		).toBe( true );
	} );
} );

describe( 'parsePhpError', () => {
	test( 'extracts an HTML fatal error with its file location', () => {
		const log =
			'<b>Fatal error</b>:  Uncaught Error: Call to undefined function foo() in /wordpress/wp-content/themes/x/functions.php:12';
		expect( parsePhpError( log ) ).toBe(
			'Fatal error: Uncaught Error: Call to undefined function foo() in wp-content/themes/x/functions.php:12'
		);
	} );

	test( 'extracts an HTML fatal error without a recognizable location', () => {
		expect( parsePhpError( '<b>Fatal error</b>: Something broke' ) ).toBe(
			'Fatal error: Something broke'
		);
	} );

	test( 'extracts a plain-text PHP Fatal error line', () => {
		const log = '[16-Jul-2026] PHP Fatal error:  Uncaught Error: bad thing in file.php on line 5';
		expect( parsePhpError( log ) ).toBe(
			'PHP Fatal error: Uncaught Error: bad thing in file.php on line 5'
		);
	} );

	test( 'extracts the text of a wp-die-message block', () => {
		const log =
			'<div class="wp-die-message"><h1>Error</h1><p>There has been a critical error on this website.</p></div>';
		expect( parsePhpError( log ) ).toBe(
			'WordPress error: Error There has been a critical error on this website.'
		);
	} );

	test( 'falls back to a generic message when nothing matches', () => {
		expect( parsePhpError( 'nothing useful here' ) ).toBe( 'PHP error during startup' );
	} );
} );
