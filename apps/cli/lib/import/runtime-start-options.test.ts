import fs from 'fs';
import os from 'os';
import path from 'path';
import { vi } from 'vitest';
import {
	ensureImportedSiteSqliteReady,
	loadImportedRuntimeStartOptions,
	loadRuntimeBlueprint,
	normalizeImportedSqliteDatabasePath,
} from './runtime-start-options';

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

	it( 'loads Playground runtime mounts from the importer start script', () => {
		// Normalize path separators so the mock works on both Unix (forward
		// slashes) and Windows (backslashes from path.join, double backslashes
		// from escaped shell paths like C:\\Sites\\...).
		const normalizePath = ( p: unknown ) => String( p ).replace( /[\\/]+/g, '/' );
		const existingPaths = new Set( [
			'/test/runtime/blueprint.json',
			'/test/runtime/start.sh',
			'/test/runtime/runtime.php',
			'/test/raw/core',
			'C:/Sites/test/wp-content',
			'/test/state/.import-state.json',
		] );
		vi.spyOn( fs, 'existsSync' ).mockImplementation( ( filePath ) =>
			existingPaths.has( normalizePath( filePath ) )
		);
		vi.spyOn( fs, 'readFileSync' ).mockImplementation( ( filePath ) => {
			const normalized = normalizePath( filePath );
			if ( normalized === '/test/runtime/blueprint.json' ) {
				return '{"landingPage":"/"}';
			}

			if ( normalized === '/test/runtime/runtime.php' ) {
				return `<?php
if (!defined('WP_CONTENT_DIR')) {
    define('WP_CONTENT_DIR', '/wordpress/wp-content');
}
if (!defined('STREAMING_SITE_MIGRATION_REMOTE_UPLOAD_PROXY_STATE_FILE')) {
    define('STREAMING_SITE_MIGRATION_REMOTE_UPLOAD_PROXY_STATE_FILE', '/tmp/streaming-site-migration/.import-state.json');
}
`;
			}

			return `npx @wp-playground/cli@latest server \\
    --mount-before-install='/test/raw/core:/wordpress' \\
    --mount-before-install='C:\\\\Sites\\\\test\\\\wp-content:/wordpress/wp-content' \\
    --mount='/test/runtime/runtime.php:/wordpress/wp-content/mu-plugins/0-playground-runtime.php' \\
    --mount='/test/state/.import-state.json:/tmp/streaming-site-migration/.import-state.json' \\
    --mount='/test/state/.import-download-list-skipped.jsonl:/tmp/streaming-site-migration/.import-download-list-skipped.jsonl' \\
    --wordpress-install-mode=do-not-attempt-installing \\
    --port=8882
`;
		} );

		expect( loadImportedRuntimeStartOptions( '/test/runtime/blueprint.json' ) ).toEqual( {
			blueprint: {
				landingPage: '/',
				constants: {
					WP_CONTENT_DIR: '/wordpress/wp-content',
					WP_PLUGIN_DIR: '/wordpress/wp-content/plugins',
					WPMU_PLUGIN_DIR: '/wordpress/wp-content/mu-plugins',
					STREAMING_SITE_MIGRATION_REMOTE_UPLOAD_PROXY_STATE_FILE:
						'/tmp/streaming-site-migration/.import-state.json',
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

	it( 'normalizes the importer sqlite filename to .ht.sqlite', () => {
		const sitePath = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-import-site-' ) );
		const databaseDirectory = path.join( sitePath, 'wp-content', 'database' );
		const sqlitePhpPath = path.join( databaseDirectory, '.ht.sqlite.php' );
		const sqlitePath = path.join( databaseDirectory, '.ht.sqlite' );

		try {
			fs.mkdirSync( databaseDirectory, { recursive: true } );
			fs.writeFileSync( sqlitePhpPath, 'sqlite' );

			expect( normalizeImportedSqliteDatabasePath( sitePath ) ).toBe( sqlitePath );
			expect( fs.existsSync( sqlitePath ) ).toBe( true );
			expect( fs.existsSync( sqlitePhpPath ) ).toBe( false );
		} finally {
			fs.rmSync( sitePath, { recursive: true, force: true } );
		}
	} );

	it( 'ensures sqlite integration is installed for imported sites', async () => {
		const sitePath = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-import-site-' ) );
		const databaseDirectory = path.join( sitePath, 'wp-content', 'database' );
		const sqlitePath = path.join( databaseDirectory, '.ht.sqlite' );

		try {
			fs.mkdirSync( databaseDirectory, { recursive: true } );
			fs.writeFileSync( sqlitePath, 'sqlite' );
			const sqliteIntegrationModule = await import( 'cli/lib/sqlite-integration' );
			const keepSqliteIntegrationUpdatedMock = vi
				.spyOn( sqliteIntegrationModule, 'keepSqliteIntegrationUpdated' )
				.mockResolvedValue( true );

			await expect( ensureImportedSiteSqliteReady( sitePath ) ).resolves.toBe( sqlitePath );
			expect( keepSqliteIntegrationUpdatedMock ).toHaveBeenCalledWith( sitePath );
		} finally {
			fs.rmSync( sitePath, { recursive: true, force: true } );
		}
	} );
} );
