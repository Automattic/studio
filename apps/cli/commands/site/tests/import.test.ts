import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
	findMatchingWpComSite,
	formatWpComSitesList,
	getApiUrl,
	getFlattenSourceDirectory,
	getImportKey,
	inferSiteNameFromUrl,
	migrateLegacyImporterLayout,
	normalizeImportUrl,
	parseImporterJson,
	prepareSkippedEarlierState,
	shouldRestartFilesSyncIndex,
} from '../import';

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

	it( 'uses the remote document root as the flatten source directory when available', () => {
		const stateDirectory = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-import-state-' ) );
		const rawDirectory = path.join( stateDirectory, 'raw' );

		try {
			fs.mkdirSync( rawDirectory, { recursive: true } );
			fs.writeFileSync(
				path.join( stateDirectory, '.import-state.json' ),
				JSON.stringify( {
					preflight: {
						data: {
							runtime: {
								document_root: `base64:${ Buffer.from( '/srv/htdocs' ).toString( 'base64' ) }`,
							},
						},
					},
				} )
			);

			expect( getFlattenSourceDirectory( stateDirectory, rawDirectory ) ).toBe(
				path.join( rawDirectory, 'srv', 'htdocs' )
			);
		} finally {
			fs.rmSync( stateDirectory, { recursive: true, force: true } );
		}
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
} );
