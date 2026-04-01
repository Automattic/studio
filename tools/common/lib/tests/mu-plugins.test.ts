import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { mkdtemp, readdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { cleanupLegacyMuPlugins, getMuPlugins } from '@studio/common/lib/mu-plugins';

describe( 'getMuPlugins', () => {
	it( 'should include the tunnel URL rewrite mu-plugin', async () => {
		const [ muPluginsDir ] = await getMuPlugins( {} );
		const files = await readdir( muPluginsDir );
		expect( files ).toContain( '0-tunnel-url-rewrite.php' );

		const content = readFileSync( join( muPluginsDir, '0-tunnel-url-rewrite.php' ), 'utf-8' );
		expect( content ).toContain( 'HTTP_X_FORWARDED_HOST' );
		expect( content ).toContain( 'option_siteurl' );
		expect( content ).toContain( 'option_home' );
		expect( content ).toContain( 'redirect_canonical' );
	} );
} );

describe( 'cleanupLegacyMuPlugins', () => {
	let sitePath: string;

	beforeEach( async () => {
		sitePath = await mkdtemp( join( tmpdir(), 'studio-test-site-' ) );
	} );

	it( 'should remove legacy Studio mu-plugin files', async () => {
		const muPluginsDir = join( sitePath, 'wp-content', 'mu-plugins' );
		mkdirSync( muPluginsDir, { recursive: true } );

		// Create legacy files that should be removed
		const legacyFiles = [
			'0-allowed-redirect-hosts.php',
			'0-check-theme-availability.php',
			'0-permalinks.php',
			'0-thumbnails.php',
			'0-sqlite.php',
			'0-dns-functions.php',
			'0-32bit-integer-warnings.php',
		];
		for ( const file of legacyFiles ) {
			writeFileSync( join( muPluginsDir, file ), '<?php // legacy' );
		}

		await cleanupLegacyMuPlugins( sitePath );

		for ( const file of legacyFiles ) {
			expect( existsSync( join( muPluginsDir, file ) ) ).toBe( false );
		}
	} );

	it( 'should not remove non-Studio mu-plugin files', async () => {
		const muPluginsDir = join( sitePath, 'wp-content', 'mu-plugins' );
		mkdirSync( muPluginsDir, { recursive: true } );

		// Create a user mu-plugin that should NOT be removed
		const userPlugin = 'my-custom-plugin.php';
		writeFileSync( join( muPluginsDir, userPlugin ), '<?php // user plugin' );

		// Also create a legacy file to verify selective removal
		writeFileSync( join( muPluginsDir, '0-check-theme-availability.php' ), '<?php // legacy' );

		await cleanupLegacyMuPlugins( sitePath );

		expect( existsSync( join( muPluginsDir, userPlugin ) ) ).toBe( true );
		expect( existsSync( join( muPluginsDir, '0-check-theme-availability.php' ) ) ).toBe( false );
	} );

	it( 'should handle missing wp-content/mu-plugins directory gracefully', async () => {
		// sitePath exists but wp-content/mu-plugins does not
		await expect( cleanupLegacyMuPlugins( sitePath ) ).resolves.toBeUndefined();
	} );

	it( 'should handle missing site path gracefully', async () => {
		await expect( cleanupLegacyMuPlugins( '/nonexistent/path/to/site' ) ).resolves.toBeUndefined();
	} );

	it( 'should not remove sqlite-database-integration directory', async () => {
		const muPluginsDir = join( sitePath, 'wp-content', 'mu-plugins' );
		const sqliteDir = join( muPluginsDir, 'sqlite-database-integration' );
		mkdirSync( sqliteDir, { recursive: true } );
		writeFileSync( join( sqliteDir, 'load.php' ), '<?php // sqlite integration' );

		await cleanupLegacyMuPlugins( sitePath );

		expect( existsSync( sqliteDir ) ).toBe( true );
		expect( existsSync( join( sqliteDir, 'load.php' ) ) ).toBe( true );
	} );

	it( 'should handle empty mu-plugins directory', async () => {
		const muPluginsDir = join( sitePath, 'wp-content', 'mu-plugins' );
		mkdirSync( muPluginsDir, { recursive: true } );

		await cleanupLegacyMuPlugins( sitePath );

		const remaining = await readdir( muPluginsDir );
		expect( remaining ).toHaveLength( 0 );
	} );
} );
