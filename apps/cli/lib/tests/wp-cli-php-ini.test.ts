import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { WpCliResponse } from 'cli/lib/run-wp-cli-command';
import { getWpCliPhpIniArgs, WP_CLI_PHP_INI_ENTRIES } from 'cli/lib/wp-cli-php-ini';

const PHP_85_DEPRECATION =
	'Deprecated: Case statements followed by a semicolon (;) are deprecated, use a colon (:) instead in phar:///wp-cli.phar/vendor/react/promise/src/functions.php on line 369\n';
const JSON_STDOUT = '[{"name":"akismet","status":"active"}]\n';

describe( 'WP-CLI PHP ini policy', () => {
	it( 'configures native -d arguments that route diagnostics to stderr', () => {
		expect( getWpCliPhpIniArgs() ).toEqual( [
			'-d',
			`error_reporting=${ WP_CLI_PHP_INI_ENTRIES.error_reporting }`,
			'-d',
			'display_errors=stderr',
			'-d',
			'log_errors=0',
		] );
		expect( Number( WP_CLI_PHP_INI_ENTRIES.error_reporting ) ).toBe( 32767 & ~8192 );
	} );

	it( 'keeps JSON stdout parseable when PHP diagnostics are on stderr', async () => {
		expect( () => JSON.parse( `${ PHP_85_DEPRECATION }${ JSON_STDOUT }` ) ).toThrow();

		const response = new WpCliResponse(
			Readable.from( [ Buffer.from( JSON_STDOUT ) ] ),
			Readable.from( [ Buffer.from( PHP_85_DEPRECATION ) ] ),
			Promise.resolve( 0 )
		);

		expect( JSON.parse( await response.stdoutText ) ).toEqual( [
			{ name: 'akismet', status: 'active' },
		] );
		expect( await response.stderrText ).toBe( PHP_85_DEPRECATION );
	} );
} );
