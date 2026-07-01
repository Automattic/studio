import fs from 'fs';
import os from 'os';
import path from 'path';
import { vi } from 'vitest';
import {
	ensureImportedSiteSqliteReady,
	getExtraDirectoryMountsFromImporterState,
	getImportedSiteAutoPrependFile,
	loadImportedRuntimeStartOptions,
	loadRuntimeBlueprint,
} from './runtime-start-options';
import type { SiteData } from '../cli-config/core';

describe( 'imported runtime start options', () => {
	afterEach( () => {
		vi.restoreAllMocks();
	} );

	it( 'loads the runtime blueprint', () => {
		vi.spyOn( fs, 'existsSync' ).mockImplementation(
			( filePath ) => filePath === '/test/runtime/blueprint.json'
		);
		vi.spyOn( fs, 'readFileSync' ).mockReturnValue( '{"landingPage":"/"}' );

		expect( loadRuntimeBlueprint( '/test/runtime/blueprint.json' ) ).toEqual( {
			landingPage: '/',
		} );
	} );

	it( 'loads Playground runtime mounts from the importer start.json', async () => {
		const normalizePath = ( p: unknown ) => String( p ).replace( /[\\/]+/g, '/' );
		const existingPaths = new Set( [
			'/test/runtime/blueprint.json',
			'/test/runtime/start.json',
			'/test/runtime/runtime.php',
			'/test/raw/core',
			'C:/Sites/test/wp-content',
			'/test/state/.import-state.json',
		] );
		const testFileContents: Record< string, string > = {
			'/test/runtime/blueprint.json': '{"landingPage":"/"}',
			'/test/runtime/runtime.php': `<?php
if (!defined('WP_CONTENT_DIR')) {
    define('WP_CONTENT_DIR', '/wordpress/wp-content');
}
if (!defined('STREAMING_SITE_MIGRATION_REMOTE_UPLOAD_PROXY_STATE_FILE')) {
    define('STREAMING_SITE_MIGRATION_REMOTE_UPLOAD_PROXY_STATE_FILE', '/tmp/streaming-site-migration/.import-state.json');
}
`,
			'/test/runtime/start.json': JSON.stringify( {
				mounts_before_install: [
					{ source: '/test/raw/core', target: '/wordpress' },
					{ source: 'C:\\\\Sites\\\\test\\\\wp-content', target: '/wordpress/wp-content' },
				],
				mounts: [
					{
						source: '/test/runtime/runtime.php',
						target: '/wordpress/wp-content/mu-plugins/0-playground-runtime.php',
					},
					{
						source: '/test/state/.import-state.json',
						target: '/tmp/streaming-site-migration/.import-state.json',
					},
					{
						source: '/test/state/.import-download-list-skipped.jsonl',
						target: '/tmp/streaming-site-migration/.import-download-list-skipped.jsonl',
					},
				],
				wordpress_install_mode: 'do-not-attempt-installing',
			} ),
		};
		// Pass through to the real fs for paths that are not test fixtures
		// (e.g. WASM binaries loaded by @php-wasm/node).
		const realExistsSync = fs.existsSync;
		const realReadFileSync = fs.readFileSync;
		vi.spyOn( fs, 'existsSync' ).mockImplementation( ( filePath ) => {
			const normalized = normalizePath( filePath );
			if ( existingPaths.has( normalized ) ) {
				return true;
			}
			return realExistsSync( filePath );
		} );
		vi.spyOn( fs, 'readFileSync' ).mockImplementation( ( (
			filePath: fs.PathOrFileDescriptor,
			...args: unknown[]
		) => {
			const normalized = normalizePath( filePath );
			if ( normalized in testFileContents ) {
				return testFileContents[ normalized ];
			}
			// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
			return ( realReadFileSync as Function )( filePath, ...args ) as string;
		} ) as typeof fs.readFileSync );

		await expect(
			loadImportedRuntimeStartOptions( '/test/runtime/blueprint.json' )
		).resolves.toEqual( {
			blueprint: {
				landingPage: '/',
				constants: {
					WP_CONTENT_DIR: '/wordpress/wp-content',
					WP_PLUGIN_DIR: '/wordpress/wp-content/plugins',
					WPMU_PLUGIN_DIR: '/wordpress/wp-content/mu-plugins',
					STREAMING_SITE_MIGRATION_REMOTE_UPLOAD_PROXY_STATE_FILE:
						'/tmp/streaming-site-migration/.import-state.json',
					DB_NAME: 'wordpress',
					DB_USER: 'wordpress',
					DB_PASSWORD: 'wordpress',
					DB_HOST: 'localhost',
				},
			},
			blueprintUri: '/test/runtime/blueprint.json',
			mountsBeforeInstall: [
				{ hostPath: '/test/raw/core', vfsPath: '/wordpress' },
				{ hostPath: 'C:\\\\Sites\\\\test\\\\wp-content', vfsPath: '/wordpress/wp-content' },
			],
			mounts: [
				{
					hostPath: '/test/runtime/runtime.php',
					vfsPath: '/wordpress/wp-content/mu-plugins/0-playground-runtime.php',
				},
				{
					hostPath: '/test/state/.import-state.json',
					vfsPath: '/tmp/streaming-site-migration/.import-state.json',
				},
			],
			wordpressInstallMode: 'do-not-attempt-installing',
			skipSqliteSetup: true,
			useExactMountLayout: true,
		} );
	} );

	describe( 'getExtraDirectoryMountsFromImporterState', () => {
		it( 'rejects path traversal in auto_prepend_file', () => {
			const importRoot = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-import-traversal-' ) );
			const runtimeDir = path.join( importRoot, 'runtime' );
			const stateDir = path.join( importRoot, 'state' );
			const rawDir = path.join( importRoot, 'raw' );

			try {
				fs.mkdirSync( runtimeDir, { recursive: true } );
				fs.mkdirSync( stateDir, { recursive: true } );
				fs.mkdirSync( rawDir, { recursive: true } );

				// A malicious server could set auto_prepend_file to a path
				// with ../ segments to escape the raw directory.
				fs.writeFileSync(
					path.join( stateDir, '.import-state.json' ),
					JSON.stringify( {
						preflight: {
							data: {
								runtime: {
									ini_get_all: {
										auto_prepend_file: '/../../../etc/passwd',
									},
								},
							},
						},
					} )
				);

				// Even if the traversed path exists on the host, it must be
				// rejected because it escapes the raw/ directory.
				const result = getExtraDirectoryMountsFromImporterState( runtimeDir );
				expect( result ).toEqual( [] );
			} finally {
				fs.rmSync( importRoot, { recursive: true, force: true } );
			}
		} );

		it( 'allows a valid auto_prepend_file within the raw directory', () => {
			const importRoot = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-import-valid-' ) );
			const runtimeDir = path.join( importRoot, 'runtime' );
			const stateDir = path.join( importRoot, 'state' );
			const rawDir = path.join( importRoot, 'raw' );
			const scriptsDir = path.join( rawDir, 'scripts' );

			try {
				fs.mkdirSync( runtimeDir, { recursive: true } );
				fs.mkdirSync( stateDir, { recursive: true } );
				fs.mkdirSync( scriptsDir, { recursive: true } );

				fs.writeFileSync(
					path.join( stateDir, '.import-state.json' ),
					JSON.stringify( {
						preflight: {
							data: {
								runtime: {
									ini_get_all: {
										auto_prepend_file: '/scripts/env.php',
									},
								},
							},
						},
					} )
				);

				const result = getExtraDirectoryMountsFromImporterState( runtimeDir );
				expect( result ).toEqual( [ { hostPath: scriptsDir, vfsPath: '/scripts' } ] );
			} finally {
				fs.rmSync( importRoot, { recursive: true, force: true } );
			}
		} );
	} );

	it( 'ensures sqlite integration is installed for imported sites', async () => {
		const importRoot = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-import-site-' ) );
		const rawWpContent = path.join( importRoot, 'raw', 'wp-content' );
		const databaseDirectory = path.join( rawWpContent, 'database' );
		const runtimeDir = path.join( importRoot, 'runtime' );
		const runtimeBlueprintPath = path.join( runtimeDir, 'blueprint.json' );
		const sqlitePath = path.join( databaseDirectory, '.ht.sqlite' );

		try {
			fs.mkdirSync( databaseDirectory, { recursive: true } );
			fs.mkdirSync( runtimeDir, { recursive: true } );
			fs.writeFileSync( runtimeBlueprintPath, '{}' );
			fs.writeFileSync( sqlitePath, 'sqlite' );
			const sqliteIntegrationModule = await import( 'cli/lib/sqlite-integration' );
			const installSqliteIntegrationMock = vi
				.spyOn( sqliteIntegrationModule, 'installSqliteIntegration' )
				.mockResolvedValue( undefined );

			await expect( ensureImportedSiteSqliteReady( runtimeBlueprintPath ) ).resolves.toBe(
				sqlitePath
			);
			// Receives the parent of the resolved wp-content in the raw tree.
			expect( installSqliteIntegrationMock ).toHaveBeenCalledWith( path.join( importRoot, 'raw' ) );
		} finally {
			fs.rmSync( importRoot, { recursive: true, force: true } );
		}
	} );

	describe( 'getImportedSiteAutoPrependFile', () => {
		const makeSite = ( overrides: Partial< SiteData > = {} ): SiteData => ( {
			id: 'test-id',
			name: 'Test Site',
			path: '/tmp/test-site',
			port: 8881,
			phpVersion: '8.4',
			...overrides,
		} );

		it( 'returns the runtime.php sibling for an imported site that has it', () => {
			const importRoot = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-prepend-' ) );
			const runtimeDir = path.join( importRoot, 'runtime' );
			const runtimeBlueprintPath = path.join( runtimeDir, 'blueprint.json' );
			const runtimePhpPath = path.join( runtimeDir, 'runtime.php' );

			try {
				fs.mkdirSync( runtimeDir, { recursive: true } );
				fs.writeFileSync( runtimeBlueprintPath, '{}' );
				fs.writeFileSync( runtimePhpPath, '<?php' );

				expect( getImportedSiteAutoPrependFile( makeSite( { runtimeBlueprintPath } ) ) ).toBe(
					runtimePhpPath
				);
			} finally {
				fs.rmSync( importRoot, { recursive: true, force: true } );
			}
		} );

		it( 'returns undefined for a normal site without runtimeBlueprintPath', () => {
			expect( getImportedSiteAutoPrependFile( makeSite() ) ).toBeUndefined();
		} );

		it( 'returns undefined (does not throw) when runtime.php is missing', () => {
			const importRoot = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-prepend-missing-' ) );
			const runtimeBlueprintPath = path.join( importRoot, 'runtime', 'blueprint.json' );

			try {
				fs.mkdirSync( path.dirname( runtimeBlueprintPath ), { recursive: true } );
				fs.writeFileSync( runtimeBlueprintPath, '{}' );
				// Intentionally no runtime.php written.
				expect(
					getImportedSiteAutoPrependFile( makeSite( { runtimeBlueprintPath } ) )
				).toBeUndefined();
			} finally {
				fs.rmSync( importRoot, { recursive: true, force: true } );
			}
		} );
	} );
} );
