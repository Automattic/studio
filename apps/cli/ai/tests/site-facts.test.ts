import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { readActiveSiteFacts } from '../site-facts';

describe( 'readActiveSiteFacts', () => {
	it( 'states the WordPress a local site runs and where its block types are declared', async () => {
		const sitePath = mkdtempSync( path.join( os.tmpdir(), 'site-facts-' ) );
		mkdirSync( path.join( sitePath, 'wp-includes' ) );
		writeFileSync(
			path.join( sitePath, 'wp-includes', 'version.php' ),
			"<?php\n$wp_version = '7.1.3';\n"
		);

		const facts = await readActiveSiteFacts( { name: 'Site', path: sitePath, running: true } );

		expect( facts ).toEqual( [ 'WordPress 7.1.3.' ] );
	} );

	it( 'has no facts for a WordPress.com site or no site', async () => {
		expect(
			await readActiveSiteFacts( { name: 'Live', path: '', running: false, remote: true } )
		).toEqual( [] );
		expect( await readActiveSiteFacts( null ) ).toEqual( [] );
	} );
} );
