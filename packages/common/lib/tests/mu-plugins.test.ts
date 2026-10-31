import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { mkdtemp, readdir, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
	cleanupLegacyMuPlugins,
	getMuPlugins,
	STUDIO_LOADER_MU_PLUGIN_FILENAME,
	writeStudioMuPlugins,
} from '@studio/common/lib/mu-plugins';

let configDir: string;
const originalConfigDir = process.env.DEV_CONFIG_DIR;

beforeAll( async () => {
	configDir = await mkdtemp( join( tmpdir(), 'studio-test-config-' ) );
	process.env.DEV_CONFIG_DIR = configDir;
} );

afterAll( async () => {
	if ( originalConfigDir === undefined ) {
		delete process.env.DEV_CONFIG_DIR;
	} else {
		process.env.DEV_CONFIG_DIR = originalConfigDir;
	}
	await rm( configDir, { recursive: true, force: true } );
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

describe( 'writeStudioMuPlugins', () => {
	let sitePath: string;

	beforeEach( async () => {
		sitePath = await mkdtemp( join( tmpdir(), 'studio-test-site-' ) );
	} );

	afterEach( async () => {
		await rm( sitePath, { recursive: true, force: true } );
	} );

	it( 'should preserve the auto-update setting for native PHP mu-plugins', async () => {
		await writeStudioMuPlugins( sitePath, true );

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

	it.each( [
		[ 'enables them when the flag is true', true, '0-enable-auto-updates.php' ],
		[ 'disables them only on an explicit false', false, '0-disable-auto-updates.php' ],
		// Sites created before the flag existed have no value. The settings UI reads
		// that as auto-updating, so the mu-plugins must agree (STU-2348).
		[ 'enables them when the flag is unset', undefined, '0-enable-auto-updates.php' ],
	] )( 'auto-updates: %s', async ( _label, flag, expected ) => {
		const muPluginsDir = await writeStudioMuPlugins( sitePath, flag );
		const generatedPlugins = await readdir( muPluginsDir );

		const other =
			expected === '0-enable-auto-updates.php'
				? '0-disable-auto-updates.php'
				: '0-enable-auto-updates.php';
		expect( generatedPlugins ).toContain( expected );
		expect( generatedPlugins ).not.toContain( other );
	} );

	it( 'should reuse the existing mu-plugins directory when contents are up to date', async () => {
		const firstDir = await writeStudioMuPlugins( sitePath, false );
		const secondDir = await writeStudioMuPlugins( sitePath, false );

		expect( secondDir ).toBe( firstDir );
	} );

	it( 'should restore a mu-plugin file with stale content', async () => {
		const firstDir = await writeStudioMuPlugins( sitePath, false );

		const pluginFilename = '0-deactivate-jetpack-modules.php';
		const expectedContent = await readFile( join( firstDir, pluginFilename ), 'utf8' );
		writeFileSync( join( firstDir, pluginFilename ), '<?php // stale content from older Studio' );

		const secondDir = await writeStudioMuPlugins( sitePath, false );
		const restoredContent = await readFile( join( secondDir, pluginFilename ), 'utf8' );

		expect( secondDir ).toBe( firstDir );
		expect( restoredContent ).toBe( expectedContent );
	} );

	it( 'should use a different directory when the mu-plugins differ', async () => {
		const enabledDir = await writeStudioMuPlugins( sitePath, true );
		const disabledDir = await writeStudioMuPlugins( sitePath, false );

		expect( disabledDir ).not.toBe( enabledDir );
	} );

	it( 'should keep the loader on the same directory when another TMPDIR writes it (STU-2532)', async () => {
		const loaderPath = join(
			sitePath,
			'wp-content',
			'mu-plugins',
			STUDIO_LOADER_MU_PLUGIN_FILENAME
		);
		const serverTmpdir = await mkdtemp( join( tmpdir(), 'studio-test-server-tmp-' ) );
		const cliTmpdir = await mkdtemp( join( tmpdir(), 'studio-test-cli-tmp-' ) );
		try {
			vi.stubEnv( 'TMPDIR', serverTmpdir );
			const serverDir = await writeStudioMuPlugins( sitePath, false );
			const loaderContent = await readFile( loaderPath, 'utf8' );

			// A cleared /tmp, or an agent sandbox with its own /tmp, hides the first
			// process's temp files from the next one.
			await rm( serverTmpdir, { recursive: true, force: true } );
			vi.stubEnv( 'TMPDIR', cliTmpdir );
			const cliDir = await writeStudioMuPlugins( sitePath, false );

			expect( cliDir ).toBe( serverDir );
			expect( await readFile( loaderPath, 'utf8' ) ).toBe( loaderContent );
			expect( await readdir( cliTmpdir ) ).toEqual( [] );
		} finally {
			vi.unstubAllEnvs();
			await rm( serverTmpdir, { recursive: true, force: true } );
			await rm( cliTmpdir, { recursive: true, force: true } );
		}
	} );

	it( 'should repoint a loader that points to another directory (STU-2532)', async () => {
		const loaderPath = join(
			sitePath,
			'wp-content',
			'mu-plugins',
			STUDIO_LOADER_MU_PLUGIN_FILENAME
		);
		const muPluginsDir = await writeStudioMuPlugins( sitePath, false );
		const loaderContent = await readFile( loaderPath, 'utf8' );
		writeFileSync(
			loaderPath,
			loaderContent.replace( muPluginsDir, '/home/user/.hermes/cache/scratch/studio-mu-plugins-x' )
		);

		await writeStudioMuPlugins( sitePath, false );

		expect( await readFile( loaderPath, 'utf8' ) ).toBe( loaderContent );
		expect( await readdir( join( sitePath, 'wp-content', 'mu-plugins' ) ) ).toEqual( [
			STUDIO_LOADER_MU_PLUGIN_FILENAME,
		] );
	} );

	it( 'should disable Jetpack modules that affect local development', async () => {
		await writeStudioMuPlugins( sitePath, false );

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
		const withCapture = await getMuPlugins( {
			errorLogPath: "/wordpress/wp-content/it's-a-log.log",
		} );
		const capturePath = join( withCapture, '0-error-capture.php' );
		expect( existsSync( capturePath ) ).toBe( true );
		const content = await readFile( capturePath, 'utf8' );
		expect( content ).toContain( "ini_set( 'log_errors', '1' );" );
		expect( content ).toContain( "'/wordpress/wp-content/it\\'s-a-log.log'" );
		// Defers to logging the user already configured.
		expect( content ).toContain( "if ( ! ini_get( 'log_errors' ) || ! ini_get( 'error_log' ) )" );

		const withoutCapture = await getMuPlugins();
		expect( existsSync( join( withoutCapture, '0-error-capture.php' ) ) ).toBe( false );
	} );

	it( 'should stop capturing after boot only when errorLogStopAfterBoot is set', async () => {
		const bootOnly = await getMuPlugins( {
			errorLogPath: '/wordpress/wp-content/studio-error.log',
			errorLogStopAfterBoot: true,
		} );
		const bootOnlyContent = await readFile( join( bootOnly, '0-error-capture.php' ), 'utf8' );
		expect( bootOnlyContent ).toContain( "add_action( 'wp_loaded'" );

		const session = await getMuPlugins( {
			errorLogPath: '/wordpress/wp-content/debug.log',
		} );
		const sessionContent = await readFile( join( session, '0-error-capture.php' ), 'utf8' );
		expect( sessionContent ).not.toContain( 'wp_loaded' );
	} );
} );

describe( 'getMuPlugins localhost framing', () => {
	it( 'should replace core frame options with a localhost-only frame-ancestors policy', async () => {
		const muPluginsDir = await getMuPlugins();
		const content = await readFile( join( muPluginsDir, '0-allow-localhost-framing.php' ), 'utf8' );

		expect( content ).toContain(
			"remove_action( current_action(), 'send_frame_options_header' );"
		);
		expect( content ).toContain( "frame-ancestors 'self' http://localhost:* http://127.0.0.1:*" );
		expect( content ).toContain(
			"add_action( 'admin_init', 'studio_send_frame_options_header', 0 );"
		);
		expect( content ).toContain(
			"add_action( 'login_init', 'studio_send_frame_options_header', 0 );"
		);
	} );
} );

describe( 'getMuPlugins admin API', () => {
	it( 'should set the admin password only when it differs from the stored one', async () => {
		const muPluginsDir = await getMuPlugins();
		const content = await readFile( join( muPluginsDir, '0-studio-admin-api.php' ), 'utf8' );

		// Rewriting an unchanged password produces a new hash, which invalidates
		// the wp-admin auth cookie on every site start.
		expect( content ).toMatch( /!\s*wp_check_password\([^)]*\)[^{]*\{\s*wp_set_password\(/ );
	} );

	it( 'should rename the Studio-managed admin instead of inserting a second one', async () => {
		const muPluginsDir = await getMuPlugins();
		const content = await readFile( join( muPluginsDir, '0-studio-admin-api.php' ), 'utf8' );

		// A second administrator can't reuse the existing admin's email, which
		// made every start fail after a username-only change (STU-2516).
		const renameIndex = content.indexOf( '$wpdb->update( $wpdb->users, $renamed' );
		const insertIndex = content.indexOf( 'wp_insert_user(' );
		expect( content ).toContain( "get_user_by( 'login', $previous_username )" );
		expect( renameIndex ).toBeGreaterThan( -1 );
		expect( renameIndex ).toBeLessThan( insertIndex );
		expect( content ).toContain( 'clean_user_cache( $previous_user )' );
	} );
} );

describe( 'getMuPlugins headless', () => {
	it( 'should write the headless mu-plugin only for a headless site', async () => {
		const withoutFrontend = await getMuPlugins();
		expect( existsSync( join( withoutFrontend, '0-headless.php' ) ) ).toBe( false );

		const withFrontend = await getMuPlugins( { headless: true } );
		expect( withFrontend ).not.toBe( withoutFrontend );
		const content = await readFile( join( withFrontend, '0-headless.php' ), 'utf8' );
		expect( content ).toContain( "! defined( 'STUDIO_FRONTEND_URL' )" );
		expect( content ).toContain( "'X-Studio-Revalidate-Secret' => STUDIO_REVALIDATE_SECRET" );
		expect( content ).toContain( "studio_headless_frontend_url( '/api/draft' )" );
		expect( content ).toContain( "'template_redirect'" );
	} );
} );

describe( 'writeStudioMuPlugins headless', () => {
	let sitePaths: string[] = [];

	async function makeSite(): Promise< string > {
		const sitePath = await mkdtemp( join( tmpdir(), 'studio-test-site-' ) );
		sitePaths.push( sitePath );
		return sitePath;
	}

	function readLoader( sitePath: string ): Promise< string > {
		return readFile(
			join( sitePath, 'wp-content', 'mu-plugins', STUDIO_LOADER_MU_PLUGIN_FILENAME ),
			'utf8'
		);
	}

	afterEach( async () => {
		await Promise.all(
			sitePaths.map( ( sitePath ) => rm( sitePath, { recursive: true, force: true } ) )
		);
		sitePaths = [];
	} );

	it( "defines the site's settings in its loader, before it loads the bundle", async () => {
		const sitePath = await makeSite();
		const muPluginsDir = await writeStudioMuPlugins( sitePath, false, {
			url: 'http://localhost:3000/',
			previewSecret: "pre'view\\secret",
			revalidateSecret: 'revalidate-secret',
			headlessMode: true,
			api: 'graphql',
		} );

		const loader = await readLoader( sitePath );
		expect( loader ).toContain(
			"if ( ! defined( 'STUDIO_FRONTEND_URL' ) ) define( 'STUDIO_FRONTEND_URL', 'http://localhost:3000' );"
		);
		expect( loader ).toContain( "define( 'STUDIO_PREVIEW_SECRET', 'pre\\'view\\\\secret' );" );
		expect( loader ).toContain( "define( 'STUDIO_REVALIDATE_SECRET', 'revalidate-secret' );" );
		expect( loader ).toContain( "define( 'STUDIO_FRONTEND_API', 'graphql' );" );
		expect( loader ).toContain( "define( 'STUDIO_HEADLESS_MODE', true );" );
		expect( loader.indexOf( 'STUDIO_FRONTEND_URL' ) ).toBeLessThan(
			loader.indexOf( 'require_once' )
		);
		expect( loader ).toContain( muPluginsDir );

		const bundled = await readFile( join( muPluginsDir, '0-headless.php' ), 'utf8' );
		expect( bundled ).not.toContain( "pre\\'view" );
		expect( bundled ).not.toContain( 'revalidate-secret' );
		expect( bundled ).not.toContain( 'localhost:3000' );
	} );

	it( 'shares one bundle directory between headless sites', async () => {
		const firstSite = await makeSite();
		const secondSite = await makeSite();
		const classicSite = await makeSite();

		const firstDir = await writeStudioMuPlugins( firstSite, false, {
			url: 'http://localhost:3001',
			previewSecret: 'first',
		} );
		const secondDir = await writeStudioMuPlugins( secondSite, false, {
			url: 'http://localhost:3002',
			previewSecret: 'second',
			headlessMode: true,
		} );
		const classicDir = await writeStudioMuPlugins( classicSite, false );

		expect( secondDir ).toBe( firstDir );
		expect( classicDir ).not.toBe( firstDir );
		expect( await readLoader( firstSite ) ).toContain( "'http://localhost:3001'" );
		expect( await readLoader( secondSite ) ).toContain( "'http://localhost:3002'" );
		expect( await readLoader( firstSite ) ).toContain( "define( 'STUDIO_HEADLESS_MODE', false );" );
		expect( await readLoader( classicSite ) ).not.toContain( 'STUDIO_FRONTEND_URL' );
	} );
} );
