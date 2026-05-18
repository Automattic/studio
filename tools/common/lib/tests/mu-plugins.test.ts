import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { mkdtemp, readdir, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
	cleanupLegacyMuPlugins,
	STUDIO_LOADER_MU_PLUGIN_FILENAME,
	writeStudioMuPluginsForNativePhpRuntime,
} from '@studio/common/lib/mu-plugins';

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

describe( 'writeStudioMuPluginsForNativePhpRuntime', () => {
	let sitePath: string;

	beforeEach( async () => {
		sitePath = await mkdtemp( join( tmpdir(), 'studio-test-site-' ) );
	} );

	it( 'should preserve the auto-update setting for native PHP mu-plugins', async () => {
		await writeStudioMuPluginsForNativePhpRuntime( sitePath, true );

		const loaderPath = join(
			sitePath,
			'wp-content',
			'mu-plugins',
			STUDIO_LOADER_MU_PLUGIN_FILENAME
		);
		const loaderContent = await readFile( loaderPath, 'utf8' );
		const muPluginsDir = loaderContent.match( /\$studio_mu_plugins_dir = '([^']+)';/ )?.[ 1 ];

		expect( muPluginsDir ).toBeTruthy();

		const generatedPlugins = await readdir( muPluginsDir as string );
		expect( generatedPlugins ).toContain( '0-enable-auto-updates.php' );
		expect( generatedPlugins ).not.toContain( '0-disable-auto-updates.php' );
	} );

	it( 'should strip MailPit-managed headers and preserve recipient headers', async () => {
		await writeStudioMuPluginsForNativePhpRuntime( sitePath, true, {
			enabled: true,
			httpPort: 8025,
			smtpPort: 1025,
		} );

		const loaderPath = join(
			sitePath,
			'wp-content',
			'mu-plugins',
			STUDIO_LOADER_MU_PLUGIN_FILENAME
		);
		const loaderContent = await readFile( loaderPath, 'utf8' );
		const muPluginsDir = loaderContent.match( /\$studio_mu_plugins_dir = '([^']+)';/ )?.[ 1 ];

		expect( muPluginsDir ).toBeTruthy();

		const mailpitContent = await readFile(
			join( muPluginsDir as string, '0-mailpit.php' ),
			'utf8'
		);

		expect( mailpitContent ).toContain( 'studio_mailpit_filter_headers' );
		expect( mailpitContent ).toContain( "'content-type'" );
		expect( mailpitContent ).toContain( "'subject'" );
		expect( mailpitContent ).toContain( "$payload['Cc'] = $cc;" );
		expect( mailpitContent ).toContain(
			"$payload['Bcc'] = studio_mailpit_get_recipient_emails( $bcc );"
		);
		expect( mailpitContent ).toContain( "$payload['ReplyTo'] = $reply_to;" );
	} );
} );
