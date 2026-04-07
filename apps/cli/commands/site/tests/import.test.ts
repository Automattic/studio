import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	buildDbApplyArgs,
	findMatchingWpComSite,
	formatWpComSitesList,
	getApiUrl,
	getImportKey,
	inferSiteNameFromUrl,
	migrateLegacyImporterLayout,
	normalizeImportUrl,
	parseImporterJson,
	prepareSkippedEarlierState,
	repairBlockingRawImportPaths,
	repairCompletedImportState,
	shouldRefreshFlattenedSite,
	shouldRestartFilesSyncIndex,
} from '../import';

const hasSqlite3 =
	spawnSync( 'sqlite3', [ ':memory:', 'SELECT 1;' ], { stdio: 'ignore' } ).status === 0;

describe( 'CLI: studio site import helpers', () => {
	it( 'normalizes URLs by stripping hashes and trailing slashes', () => {
		expect( normalizeImportUrl( 'https://example.com/foo//#section' ) ).toBe(
			'https://example.com/foo'
		);
	} );

	it( 'accepts a bare domain and defaults it to https', () => {
		expect( normalizeImportUrl( 'example.com/foo' ) ).toBe( 'https://example.com/foo' );
	} );

	it( 'strips the site export API marker from the canonical site URL', () => {
		expect( normalizeImportUrl( 'https://example.com/?site-export-api' ) ).toBe(
			'https://example.com/'
		);
	} );

	it( 'adds the site export API marker exactly once to the importer URL', () => {
		expect( getApiUrl( normalizeImportUrl( 'https://example.com/?site-export-api' ) ) ).toBe(
			'https://example.com/?site-export-api'
		);
	} );

	it( 'parses the final JSON envelope from a JSON stream on stdout', () => {
		expect(
			parseImporterJson( {
				stdout:
					'{"debug":"Waiting for server response..."}\n' +
					'{\n  "ok": true,\n  "data": {\n    "protocol_version": 1\n  }\n}',
				stderr: '',
			} as never )
		).toEqual( {
			ok: true,
			data: {
				protocol_version: 1,
			},
		} );
	} );

	it( 'infers the default site name from the URL host only', () => {
		expect( inferSiteNameFromUrl( 'https://subdomain.example.com/path/to/site?foo=bar' ) ).toBe(
			'subdomain.example.com'
		);
	} );

	it( 'reuses the same import key for unnamed imports of the same normalized URL', () => {
		expect( getImportKey( 'https://example.com/', undefined ) ).toBe(
			getImportKey( 'https://example.com/', undefined )
		);
		expect( getImportKey( 'https://example.com/', 'Explicit Name' ) ).not.toBe(
			getImportKey( 'https://example.com/', undefined )
		);
	} );

	it( 'matches WordPress.com sites by normalized URL or host', () => {
		expect(
			findMatchingWpComSite(
				[
					{
						id: 1,
						name: 'Example',
						url: 'https://example.wordpress.com/',
					},
				],
				'https://example.wordpress.com'
			)
		).toEqual( {
			id: 1,
			name: 'Example',
			url: 'https://example.wordpress.com/',
		} );
	} );

	it( 'formats the truncated WordPress.com site list with a full-list hint', () => {
		expect(
			formatWpComSitesList(
				[
					{ id: 1, name: 'One', url: 'https://one.wordpress.com' },
					{ id: 2, name: 'Two', url: 'https://two.wordpress.com' },
				],
				1
			)
		).toContain( '--list-wpcom-sites' );
	} );

	it( 'restarts files-sync indexing only when the saved state has no resumable cursor', () => {
		const stateDirectory = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-import-state-' ) );

		try {
			fs.writeFileSync(
				path.join( stateDirectory, '.import-state.json' ),
				JSON.stringify( {
					command: 'files-sync',
					status: 'in_progress',
					stage: 'index',
					cursor: null,
				} )
			);
			fs.writeFileSync(
				path.join( stateDirectory, '.import-remote-index.jsonl' ),
				'{"type":"file"}\n'
			);

			expect( shouldRestartFilesSyncIndex( stateDirectory ) ).toBe( true );

			fs.writeFileSync(
				path.join( stateDirectory, '.import-state.json' ),
				JSON.stringify( {
					command: 'files-sync',
					status: 'in_progress',
					stage: 'index',
					cursor: { path: 'saved' },
				} )
			);

			expect( shouldRestartFilesSyncIndex( stateDirectory ) ).toBe( false );
		} finally {
			fs.rmSync( stateDirectory, { recursive: true, force: true } );
		}
	} );

	it( 'repairs blocking raw root files for directories referenced by preflight paths', () => {
		const stateDirectory = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-import-state-' ) );
		const rawDirectory = path.join( stateDirectory, 'raw' );

		try {
			fs.mkdirSync( rawDirectory, { recursive: true } );
			fs.writeFileSync( path.join( rawDirectory, 'wordpress' ), '' );
			fs.writeFileSync(
				path.join( stateDirectory, '.import-state.json' ),
				JSON.stringify( {
					preflight: {
						data: {
							wp_detect: {
								roots: [
									{
										path: `base64:${ Buffer.from( '/wordpress/core/6.9.4' ).toString( 'base64' ) }`,
									},
								],
							},
						},
					},
				} )
			);

			expect( repairBlockingRawImportPaths( stateDirectory, rawDirectory ) ).toEqual( [
				path.join( rawDirectory, 'wordpress' ),
			] );
			expect( fs.existsSync( path.join( rawDirectory, 'wordpress' ) ) ).toBe( false );
		} finally {
			fs.rmSync( stateDirectory, { recursive: true, force: true } );
		}
	} );

	it( 'builds db-apply args for SQLite with the new site URL', () => {
		expect(
			buildDbApplyArgs( {
				normalizedUrl: 'https://example.com/',
				remoteSiteUrl: 'https://example.com',
				localUrl: 'http://localhost:8881',
				sitePath: '/tmp/site',
			} as never )
		).toEqual( [
			'db-apply',
			'https://example.com/?site-export-api',
			'--state-dir=/state',
			'--fs-root=/docroot',
			'--target-engine=sqlite',
			'--target-sqlite-path=/site/wp-content/database/.ht.sqlite',
			'--new-site-url=http://localhost:8881',
		] );
	} );

	it( 'migrates importer state from the legacy /tmp/export mount layout', () => {
		const technicalSiteDirectory = fs.mkdtempSync(
			path.join( os.tmpdir(), 'studio-import-legacy-layout-' )
		);
		const stateDirectory = path.join( technicalSiteDirectory, 'state' );
		const rawDirectory = path.join( technicalSiteDirectory, 'raw' );
		const legacyStateDirectory = path.join( technicalSiteDirectory, 'tmp', 'export', 'state' );
		const legacyRawDirectory = path.join( technicalSiteDirectory, 'tmp', 'export', 'docroot' );

		try {
			fs.mkdirSync( stateDirectory, { recursive: true } );
			fs.mkdirSync( legacyStateDirectory, { recursive: true } );
			fs.mkdirSync( legacyRawDirectory, { recursive: true } );

			fs.writeFileSync( path.join( stateDirectory, 'preflight.json' ), '{}' );
			fs.writeFileSync(
				path.join( legacyStateDirectory, '.import-state.json' ),
				JSON.stringify( { command: 'files-sync' } )
			);
			fs.writeFileSync(
				path.join( legacyStateDirectory, '.import-remote-index.jsonl' ),
				'{"type":"file"}\n'
			);
			fs.mkdirSync( path.join( legacyRawDirectory, 'wp-content' ), { recursive: true } );
			fs.writeFileSync( path.join( legacyRawDirectory, 'wp-content', 'index.php' ), '<?php' );

			expect(
				migrateLegacyImporterLayout( technicalSiteDirectory, stateDirectory, rawDirectory )
			).toBe( true );
			expect( fs.existsSync( path.join( stateDirectory, '.import-state.json' ) ) ).toBe( true );
			expect( fs.existsSync( path.join( stateDirectory, '.import-remote-index.jsonl' ) ) ).toBe(
				true
			);
			expect( fs.existsSync( path.join( rawDirectory, 'wp-content', 'index.php' ) ) ).toBe( true );
			expect( fs.existsSync( legacyStateDirectory ) ).toBe( false );
		} finally {
			fs.rmSync( technicalSiteDirectory, { recursive: true, force: true } );
		}
	} );

	it( 'restores files-sync completion state before downloading skipped files', () => {
		const stateDirectory = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-import-state-' ) );

		try {
			fs.writeFileSync(
				path.join( stateDirectory, '.import-state.json' ),
				JSON.stringify( {
					command: 'db-apply',
					status: 'complete',
					stage: 'sql',
					filter: 'skipped-earlier',
					preflight: { data: { ok: true } },
				} )
			);
			fs.writeFileSync(
				path.join( stateDirectory, '.import-download-list-skipped.jsonl' ),
				'{"path":"foo"}\n'
			);

			prepareSkippedEarlierState( {
				stateDirectory,
			} as never );

			const nextState = JSON.parse(
				fs.readFileSync( path.join( stateDirectory, '.import-state.json' ), 'utf-8' )
			);
			expect( nextState.command ).toBe( 'files-sync' );
			expect( nextState.status ).toBe( 'complete' );
			expect( nextState.stage ).toBeNull();
			expect( nextState.filter ).toBe( 'essential-files' );
			expect( nextState.preflight ).toEqual( { data: { ok: true } } );
		} finally {
			fs.rmSync( stateDirectory, { recursive: true, force: true } );
		}
	} );

	it.skipIf( ! hasSqlite3 )(
		'repairs a completed import when the local database is a fresh WordPress install',
		() => {
			const technicalSiteDirectory = fs.mkdtempSync(
				path.join( os.tmpdir(), 'studio-import-repair-' )
			);
			const sitePath = path.join( technicalSiteDirectory, 'site' );
			const stateDirectory = path.join( technicalSiteDirectory, 'state' );
			const runtimeDirectory = path.join( technicalSiteDirectory, 'runtime' );
			const sqlitePath = path.join( sitePath, 'wp-content', 'database', '.ht.sqlite' );

			try {
				fs.mkdirSync( path.dirname( sqlitePath ), { recursive: true } );
				fs.mkdirSync( stateDirectory, { recursive: true } );
				fs.mkdirSync( runtimeDirectory, { recursive: true } );
				fs.writeFileSync( path.join( stateDirectory, 'db.sql' ), '-- imported dump' );
				fs.writeFileSync( path.join( runtimeDirectory, 'blueprint.json' ), '{}' );

				spawnSync( 'sqlite3', [
					sqlitePath,
					[
						'CREATE TABLE wp_options (option_name TEXT, option_value TEXT);',
						'CREATE TABLE wp_posts (ID INTEGER, post_title TEXT, post_status TEXT, post_type TEXT);',
						"INSERT INTO wp_options VALUES ('blogname','My WordPress Website');",
						"INSERT INTO wp_posts VALUES (1,'Hello world!','publish','post');",
						"INSERT INTO wp_posts VALUES (2,'Sample Page','publish','page');",
					].join( ' ' ),
				] );

				const metadata = {
					stage: 'completed',
					sitePath,
					stateDirectory,
					runtimeBlueprintPath: path.join( runtimeDirectory, 'blueprint.json' ),
					tablePrefix: 'wp_',
					technicalSiteDirectory,
				} as Parameters< typeof repairCompletedImportState >[ 0 ];

				expect( repairCompletedImportState( metadata ) ).toContain(
					'Reapplying the imported database'
				);
				expect( metadata.stage ).toBe( 'db-downloaded' );
				expect( fs.existsSync( sqlitePath ) ).toBe( false );
			} finally {
				fs.rmSync( technicalSiteDirectory, { recursive: true, force: true } );
			}
		}
	);

	it.skipIf( ! hasSqlite3 )(
		'repairs a completed import when the imported database still has the remote site URL',
		() => {
			const technicalSiteDirectory = fs.mkdtempSync(
				path.join( os.tmpdir(), 'studio-import-rewrite-repair-' )
			);
			const sitePath = path.join( technicalSiteDirectory, 'site' );
			const stateDirectory = path.join( technicalSiteDirectory, 'state' );
			const runtimeDirectory = path.join( technicalSiteDirectory, 'runtime' );
			const sqlitePath = path.join( sitePath, 'wp-content', 'database', '.ht.sqlite' );

			try {
				fs.mkdirSync( path.dirname( sqlitePath ), { recursive: true } );
				fs.mkdirSync( stateDirectory, { recursive: true } );
				fs.mkdirSync( runtimeDirectory, { recursive: true } );
				fs.writeFileSync( path.join( stateDirectory, 'db.sql' ), '-- imported dump' );
				fs.writeFileSync( path.join( runtimeDirectory, 'blueprint.json' ), '{}' );

				spawnSync( 'sqlite3', [
					sqlitePath,
					[
						'CREATE TABLE wp_options (option_name TEXT, option_value TEXT);',
						"INSERT INTO wp_options VALUES ('home','https://example.com');",
						"INSERT INTO wp_options VALUES ('siteurl','https://example.com');",
					].join( ' ' ),
				] );

				const metadata = {
					stage: 'completed',
					sitePath,
					stateDirectory,
					runtimeBlueprintPath: path.join( runtimeDirectory, 'blueprint.json' ),
					tablePrefix: 'wp_',
					technicalSiteDirectory,
					localUrl: 'http://localhost:8881',
					rawDirectory: path.join( technicalSiteDirectory, 'raw' ),
				} as Parameters< typeof repairCompletedImportState >[ 0 ];

				expect( repairCompletedImportState( metadata ) ).toContain(
					'Reapplying the imported database with the local Studio URL'
				);
				expect( metadata.stage ).toBe( 'db-downloaded' );
				expect( fs.existsSync( sqlitePath ) ).toBe( false );
			} finally {
				fs.rmSync( technicalSiteDirectory, { recursive: true, force: true } );
			}
		}
	);

	it.skipIf( ! hasSqlite3 )(
		'repairs a completed import when the raw importer tree has a blocking root file',
		() => {
			const technicalSiteDirectory = fs.mkdtempSync(
				path.join( os.tmpdir(), 'studio-import-layout-repair-' )
			);
			const sitePath = path.join( technicalSiteDirectory, 'site' );
			const stateDirectory = path.join( technicalSiteDirectory, 'state' );
			const runtimeDirectory = path.join( technicalSiteDirectory, 'runtime' );
			const rawDirectory = path.join( technicalSiteDirectory, 'raw' );
			const sqlitePath = path.join( sitePath, 'wp-content', 'database', '.ht.sqlite' );

			try {
				fs.mkdirSync( path.dirname( sqlitePath ), { recursive: true } );
				fs.mkdirSync( stateDirectory, { recursive: true } );
				fs.mkdirSync( runtimeDirectory, { recursive: true } );
				fs.mkdirSync( rawDirectory, { recursive: true } );
				fs.writeFileSync( path.join( runtimeDirectory, 'blueprint.json' ), '{}' );
				fs.writeFileSync( path.join( rawDirectory, 'wordpress' ), '' );
				fs.writeFileSync( path.join( stateDirectory, '.import-index.jsonl' ), '{"path":"foo"}\n' );
				fs.writeFileSync(
					path.join( stateDirectory, '.import-state.json' ),
					JSON.stringify( {
						preflight: {
							data: {
								wp_detect: {
									roots: [
										{
											path: `base64:${ Buffer.from( '/wordpress/core/6.9.4' ).toString(
												'base64'
											) }`,
										},
									],
								},
							},
						},
					} )
				);

				spawnSync( 'sqlite3', [
					sqlitePath,
					[
						'CREATE TABLE wp_options (option_name TEXT, option_value TEXT);',
						"INSERT INTO wp_options VALUES ('home','http://localhost:8881');",
						"INSERT INTO wp_options VALUES ('siteurl','http://localhost:8881');",
					].join( ' ' ),
				] );

				const metadata = {
					stage: 'completed',
					sitePath,
					stateDirectory,
					runtimeBlueprintPath: path.join( runtimeDirectory, 'blueprint.json' ),
					tablePrefix: 'wp_',
					technicalSiteDirectory,
					localUrl: 'http://localhost:8881',
					rawDirectory,
				} as Parameters< typeof repairCompletedImportState >[ 0 ];

				expect( repairCompletedImportState( metadata ) ).toContain(
					'Re-downloading essential files'
				);
				expect( metadata.stage ).toBe( 'initialized' );
				expect( fs.existsSync( path.join( rawDirectory, 'wordpress' ) ) ).toBe( false );
				expect( fs.existsSync( path.join( stateDirectory, '.import-index.jsonl' ) ) ).toBe( false );
			} finally {
				fs.rmSync( technicalSiteDirectory, { recursive: true, force: true } );
			}
		}
	);

	// Creating broken symlinks requires elevated privileges on Windows.
	it.skipIf( process.platform === 'win32' )(
		'detects when the flattened site has broken theme or plugin symlinks',
		() => {
			const technicalSiteDirectory = fs.mkdtempSync(
				path.join( os.tmpdir(), 'studio-import-flatten-refresh-' )
			);
			const sitePath = path.join( technicalSiteDirectory, 'site' );

			try {
				fs.mkdirSync( path.join( sitePath, 'wp-content', 'themes' ), { recursive: true } );
				fs.mkdirSync( path.join( sitePath, 'wp-content', 'plugins' ), { recursive: true } );
				fs.symlinkSync(
					path.join( technicalSiteDirectory, 'missing-theme' ),
					path.join( sitePath, 'wp-content', 'themes', 'iotix' )
				);
				fs.symlinkSync(
					path.join( technicalSiteDirectory, 'missing-plugin' ),
					path.join( sitePath, 'wp-content', 'plugins', 'jetpack' )
				);

				expect(
					shouldRefreshFlattenedSite( {
						stateDirectory: path.join( technicalSiteDirectory, 'state' ),
						rawDirectory: path.join( technicalSiteDirectory, 'raw' ),
						sitePath,
					} as never )
				).toBe( true );
			} finally {
				fs.rmSync( technicalSiteDirectory, { recursive: true, force: true } );
			}
		}
	);
} );
