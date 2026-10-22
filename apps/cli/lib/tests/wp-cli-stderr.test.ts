import { summarizeWpCliStderr } from 'cli/lib/wp-cli-stderr';

describe( 'summarizeWpCliStderr', () => {
	it( 'picks the WP-CLI error line after PHP deprecation notices', () => {
		const stderr = [
			'Deprecated: Implicitly marking parameter $a as nullable is deprecated in /wp-cli/a.php on line 12',
			'Deprecated: Implicitly marking parameter $b as nullable is deprecated in /wp-cli/b.php on line 34',
			'Error: no such table: wp_options',
			'',
		].join( '\n' );

		expect( summarizeWpCliStderr( stderr ) ).toBe( 'Error: no such table: wp_options' );
	} );

	it( 'picks the last error line when there are several', () => {
		expect( summarizeWpCliStderr( 'Error: first\nWarning: noise\nError: second\n' ) ).toBe(
			'Error: second'
		);
	} );

	it( 'recognizes PHP fatal errors', () => {
		const stderr =
			'Deprecated: noise\nPHP Fatal error:  Allowed memory size exhausted\nStack trace:\n#0 {main}';

		expect( summarizeWpCliStderr( stderr ) ).toBe(
			'PHP Fatal error:  Allowed memory size exhausted'
		);
	} );

	it( 'falls back to the last non-empty line', () => {
		expect( summarizeWpCliStderr( 'Deprecated: noise\nsomething went wrong\n\n' ) ).toBe(
			'something went wrong'
		);
	} );

	it( 'truncates very long lines', () => {
		const summary = summarizeWpCliStderr( `Error: ${ 'x'.repeat( 1000 ) }` );

		expect( summary ).toHaveLength( 501 );
		expect( summary.endsWith( '…' ) ).toBe( true );
	} );

	it( 'returns an empty string for empty stderr', () => {
		expect( summarizeWpCliStderr( ' \n\n' ) ).toBe( '' );
	} );
} );
