import { describe, expect, it } from 'vitest';
import { parseStudioWpArguments } from 'cli/lib/studio-wp-command';

describe( 'parseStudioWpArguments', () => {
	it( 'takes out the options Studio handles and keeps the rest for WP-CLI', () => {
		expect(
			parseStudioWpArguments( [
				'plugin',
				'list',
				'--path=wp-content/plugins',
				'--php-version',
				'8.3',
				'--avoid-telemetry',
				'--format=json',
			] )
		).toEqual( {
			args: [ 'plugin', 'list', '--format=json' ],
			folder: 'wp-content/plugins',
			phpVersion: '8.3',
		} );
	} );

	it( 'refuses `wp shell` and options written with a typographic dash', () => {
		expect( () => parseStudioWpArguments( [ 'shell' ] ) ).toThrow( /does not support/ );
		expect( () => parseStudioWpArguments( [ 'post', 'list', '–porcelain' ] ) ).toThrow(
			/typographic dash/
		);
	} );
} );
