import { appendFileSync, cpSync, mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { installWordPress } from 'cli/lib/native-php/site-setup';

// A real WordPress install to start, when one is given.
const WORDPRESS = process.env.STUDIO_TEST_WORDPRESS;

describe.runIf( WORDPRESS )( 'installing WordPress where it is installed', () => {
	it( "skips the installer when the site's theme fails with a fatal error", async () => {
		const root = mkdtempSync( path.join( os.tmpdir(), 'site-installed-' ) );
		cpSync( WORDPRESS!, root, { recursive: true } );
		try {
			appendFileSync(
				path.join( root, 'wp-content/themes/twentytwentyfive/functions.php' ),
				'\nundefined_function_from_a_tutorial();\n'
			);
			const logged: string[] = [];
			const ran = await installWordPress(
				{ sitePath: root, port: 1 } as Parameters< typeof installWordPress >[ 0 ],
				'8.4',
				new AbortController().signal,
				'/nonexistent',
				( message: string ) => logged.push( message )
			);
			expect( ran ).toBe( false );
			expect( logged ).toEqual( [ 'WordPress already installed; skipping installer' ] );
		} finally {
			rmSync( root, { recursive: true, force: true } );
		}
	}, 60000 );
} );
