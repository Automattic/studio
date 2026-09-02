import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { mkdtemp, readdir, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
	cleanupLegacyMuPlugins,
	getMuPlugins,
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

	it( 'should reuse the existing mu-plugins directory when contents are up to date', async () => {
		const firstDir = await writeStudioMuPluginsForNativePhpRuntime( sitePath, false );
		const secondDir = await writeStudioMuPluginsForNativePhpRuntime( sitePath, false );

		expect( secondDir ).toBe( firstDir );
	} );

	it( 'should regenerate mu-plugins when an existing file has stale content', async () => {
		const firstDir = await writeStudioMuPluginsForNativePhpRuntime( sitePath, false );

		const pluginFilename = '0-deactivate-jetpack-modules.php';
		const expectedContent = await readFile( join( firstDir, pluginFilename ), 'utf8' );
		writeFileSync( join( firstDir, pluginFilename ), '<?php // stale content from older Studio' );

		const secondDir = await writeStudioMuPluginsForNativePhpRuntime( sitePath, false );
		const regeneratedContent = await readFile( join( secondDir, pluginFilename ), 'utf8' );

		expect( secondDir ).not.toBe( firstDir );
		expect( regeneratedContent ).toBe( expectedContent );
	} );

	it( 'should disable Jetpack modules that affect local development', async () => {
		await writeStudioMuPluginsForNativePhpRuntime( sitePath, false );

		const loaderPath = join(
			sitePath,
			'wp-content',
			'mu-plugins',
			STUDIO_LOADER_MU_PLUGIN_FILENAME
		);
		const loaderContent = await readFile( loaderPath, 'utf8' );
		const muPluginsDir = loaderContent.match( /\$studio_mu_plugins_dir = '([^']+)';/ )?.[ 1 ];

		expect( muPluginsDir ).toBeTruthy();

		const content = await readFile(
			join( muPluginsDir as string, '0-deactivate-jetpack-modules.php' ),
			'utf8'
		);

		expect( content ).toContain( "add_filter( 'jetpack_active_modules'" );
		expect( content ).toContain( "$disabled_modules = array( 'protect', 'stats' );" );
		expect( content ).toContain( 'array_diff( $active, $disabled_modules )' );
	} );
} );

describe( 'getMuPlugins error capture', () => {
	it( 'should write the error-capture mu-plugin only when errorLogPath is set', async () => {
		const [ withCapture ] = await getMuPlugins( {
			errorLogPath: "/wordpress/wp-content/it's-a-log.log",
		} );
		const capturePath = join( withCapture, '0-error-capture.php' );
		expect( existsSync( capturePath ) ).toBe( true );
		const content = await readFile( capturePath, 'utf8' );
		expect( content ).toContain( "ini_set( 'log_errors', '1' );" );
		expect( content ).toContain( "'/wordpress/wp-content/it\\'s-a-log.log'" );
		// Defers to logging the user already configured.
		expect( content ).toContain( "if ( ! ini_get( 'log_errors' ) || ! ini_get( 'error_log' ) )" );

		const [ withoutCapture ] = await getMuPlugins();
		expect( existsSync( join( withoutCapture, '0-error-capture.php' ) ) ).toBe( false );
	} );

	it( 'should stop capturing after boot only when errorLogStopAfterBoot is set', async () => {
		const [ bootOnly ] = await getMuPlugins( {
			errorLogPath: '/wordpress/wp-content/studio-error.log',
			errorLogStopAfterBoot: true,
		} );
		const bootOnlyContent = await readFile( join( bootOnly, '0-error-capture.php' ), 'utf8' );
		expect( bootOnlyContent ).toContain( "add_action( 'wp_loaded'" );

		const [ session ] = await getMuPlugins( {
			errorLogPath: '/wordpress/wp-content/debug.log',
		} );
		const sessionContent = await readFile( join( session, '0-error-capture.php' ), 'utf8' );
		expect( sessionContent ).not.toContain( 'wp_loaded' );
	} );
} );

describe( 'getMuPlugins admin API', () => {
	it( 'should set the admin password only when it differs from the stored one', async () => {
		const [ muPluginsDir ] = await getMuPlugins();
		const content = await readFile( join( muPluginsDir, '0-studio-admin-api.php' ), 'utf8' );

		// Rewriting an unchanged password produces a new hash, which invalidates
		// the wp-admin auth cookie on every site start.
		expect( content ).toMatch( /!\s*wp_check_password\([^)]*\)[^{]*\{\s*wp_set_password\(/ );
	} );
} );

describe( 'getMuPlugins tunnel URL rewrite', () => {
	it( 'should include the tunnel URL rewrite mu-plugin', async () => {
		const [ muPluginsDir ] = await getMuPlugins( {} );
		const files = await readdir( muPluginsDir );
		expect( files ).toContain( '0-tunnel-url-rewrite.php' );

		const content = await readFile( join( muPluginsDir, '0-tunnel-url-rewrite.php' ), 'utf8' );
		expect( content ).toContain( 'HTTP_X_FORWARDED_HOST' );
		expect( content ).toContain( "'home_url'" );
		expect( content ).toContain( "'site_url'" );
		expect( content ).toContain( 'redirect_canonical' );
	} );
} );
