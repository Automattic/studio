import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as migrationClient from 'cli/lib/pull/migration-client';
import { shouldRestartFilesSyncIndex } from 'cli/lib/pull/reprint-state';
import {
	applyDownloadedDatabase,
	downloadSkippedFiles,
	findMatchingWpComSite,
	formatWpComSitesList,
	getReprintApiUrlForSite,
	getPrivateDirNameForImportSession,
	inferSiteNameFromUrl,
	normalizeSiteUrl,
} from '../pull-reprint';

describe( 'CLI: studio pull-reprint helpers', () => {
	it( 'normalizes URLs by stripping hashes and trailing slashes', () => {
		expect( normalizeSiteUrl( 'https://example.com/foo//#section' ) ).toBe(
			'https://example.com/foo'
		);
	} );

	it( 'accepts a bare domain and defaults it to https', () => {
		expect( normalizeSiteUrl( 'example.com/foo' ) ).toBe( 'https://example.com/foo' );
	} );

	it( 'strips the site export API marker from the canonical site URL', () => {
		expect( normalizeSiteUrl( 'https://example.com/?reprint-api' ) ).toBe( 'https://example.com/' );
	} );

	it( 'adds the site export API marker exactly once to the importer URL', () => {
		expect(
			getReprintApiUrlForSite( normalizeSiteUrl( 'https://example.com/?reprint-api' ) )
		).toBe( 'https://example.com/?reprint-api' );
	} );

	it( 'infers the default site name from the URL host only', () => {
		expect( inferSiteNameFromUrl( 'https://subdomain.example.com/path/to/site?foo=bar' ) ).toBe(
			'subdomain.example.com'
		);
	} );

	it( 'reuses the same import key for unnamed imports of the same normalized URL', () => {
		expect( getPrivateDirNameForImportSession( 'https://example.com/', undefined ) ).toBe(
			getPrivateDirNameForImportSession( 'https://example.com/', undefined )
		);
		expect( getPrivateDirNameForImportSession( 'https://example.com/', 'Explicit Name' ) ).not.toBe(
			getPrivateDirNameForImportSession( 'https://example.com/', undefined )
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

	it( 'formats the truncated WordPress.com site list with a remaining-count suffix', () => {
		expect(
			formatWpComSitesList(
				[
					{ id: 1, name: 'One', url: 'https://one.wordpress.com' },
					{ id: 2, name: 'Two', url: 'https://two.wordpress.com' },
				],
				1
			)
		).toContain( '... and 1 more.' );
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

	it( 'rewrites the reprint state before downloading skipped-earlier files', async () => {
		const technicalSiteDirectory = fs.mkdtempSync(
			path.join( os.tmpdir(), 'studio-import-skipped-' )
		);
		const stateDirectory = path.join( technicalSiteDirectory, 'state' );
		const rawDirectory = path.join( technicalSiteDirectory, 'raw' );
		fs.mkdirSync( stateDirectory, { recursive: true } );
		fs.mkdirSync( rawDirectory, { recursive: true } );

		// Pre-existing state from a previous db-apply run + a non-empty
		// skipped-download list is the signal that there's a tail of files
		// to fetch.
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

		vi.spyOn( migrationClient, 'runReprintCommandUntilComplete' ).mockResolvedValue( {
			stdout: '{"ok":true}',
			stderr: '',
			exitCode: 0,
		} );

		await downloadSkippedFiles(
			{
				normalizedUrl: 'https://example.com/',
				stateDirectory,
				rawDirectory,
			} as never,
			'https://example.com/?reprint-api',
			'hmac-secret',
			false
		);

		// Reprint state was rewritten to the shape reprint's next
		// files-sync call expects when resuming into skipped-earlier.
		const nextState = JSON.parse(
			fs.readFileSync( path.join( stateDirectory, '.import-state.json' ), 'utf-8' )
		);
		expect( nextState.command ).toBe( 'files-sync' );
		expect( nextState.status ).toBe( 'complete' );
		expect( nextState.stage ).toBeNull();
		expect( nextState.filter ).toBe( 'essential-files' );
		expect( nextState.preflight ).toEqual( { data: { ok: true } } );

		fs.rmSync( technicalSiteDirectory, { recursive: true, force: true } );
	} );
} );

describe( 'CLI: studio pull-reprint db-apply phase', () => {
	afterEach( () => {
		vi.restoreAllMocks();
	} );

	it( 'runs reprint db-apply against the content dir from preflight, mounts nothing extra, and advances the stage', async () => {
		const technicalSiteDirectory = fs.mkdtempSync(
			path.join( os.tmpdir(), 'studio-import-db-apply-' )
		);
		const stateDirectory = path.join( technicalSiteDirectory, 'state' );
		const rawDirectory = path.join( technicalSiteDirectory, 'raw' );
		const sitePath = path.join( technicalSiteDirectory, 'site' );
		fs.mkdirSync( stateDirectory, { recursive: true } );
		fs.mkdirSync( rawDirectory, { recursive: true } );

		// Preflight reported the remote site's wp-content path at
		// database.wp.paths_urls.content_dir; db-apply should target an
		// sqlite file under rawDirectory + that path — no extra mount
		// needed because rawDirectory is already mounted.
		fs.writeFileSync(
			path.join( stateDirectory, '.import-state.json' ),
			JSON.stringify( {
				preflight: {
					data: {
						database: {
							wp: {
								paths_urls: {
									content_dir: '/srv/htdocs/wp-content',
								},
							},
						},
					},
				},
			} )
		);

		const reprint = vi
			.spyOn( migrationClient, 'runReprintCommandUntilComplete' )
			.mockResolvedValue( { stdout: '{"ok":true}', stderr: '', exitCode: 0 } );

		const metadata = {
			version: 1,
			importKey: 'abc',
			normalizedUrl: 'https://example.com/',
			siteName: 'example',
			sitePath,
			technicalSiteDirectory,
			rawDirectory,
			stateDirectory,
			runtimeDirectory: path.join( technicalSiteDirectory, 'runtime' ),
			runtimeBlueprintPath: path.join( technicalSiteDirectory, 'runtime', 'blueprint.json' ),
			stage: 'db-downloaded',
			localUrl: 'http://localhost:8881',
			remoteSiteUrl: 'https://example.com',
		} as never;

		await applyDownloadedDatabase( metadata, 'hmac-secret', false );

		expect( reprint ).toHaveBeenCalledTimes( 1 );
		const [ passedState, passedRaw, passedArgs, , passedOptions ] = reprint.mock.calls[ 0 ];
		expect( passedState ).toBe( stateDirectory );
		expect( passedRaw ).toBe( rawDirectory );
		expect( passedArgs ).toEqual( [
			'db-apply',
			'https://example.com/?reprint-api',
			`--state-dir=${ stateDirectory }`,
			`--fs-root=${ rawDirectory }`,
			'--target-engine=sqlite',
			`--target-sqlite-path=${ rawDirectory }/srv/htdocs/wp-content/database/.ht.sqlite`,
			'--new-site-url=http://localhost:8881',
			'--secret=hmac-secret',
			'--no-adaptive',
		] );
		// No extra mount needed — reprint can already see the sqlite target
		// through the rawDirectory mount.
		expect( passedOptions?.mounts ).toEqual( [] );

		// Stage is bumped + persisted so a resumed run skips db-apply.
		const persisted = JSON.parse(
			fs.readFileSync( path.join( technicalSiteDirectory, 'pull.json' ), 'utf-8' )
		);
		expect( persisted.stage ).toBe( 'db-applied' );

		fs.rmSync( technicalSiteDirectory, { recursive: true, force: true } );
	} );

	it( 'mounts the flattened site path when preflight did not expose a content dir', async () => {
		const technicalSiteDirectory = fs.mkdtempSync(
			path.join( os.tmpdir(), 'studio-import-db-apply-fallback-' )
		);
		const stateDirectory = path.join( technicalSiteDirectory, 'state' );
		const rawDirectory = path.join( technicalSiteDirectory, 'raw' );
		const sitePath = path.join( technicalSiteDirectory, 'site' );
		fs.mkdirSync( stateDirectory, { recursive: true } );
		fs.mkdirSync( rawDirectory, { recursive: true } );

		fs.writeFileSync(
			path.join( stateDirectory, '.import-state.json' ),
			JSON.stringify( { preflight: { data: {} } } )
		);

		const reprint = vi
			.spyOn( migrationClient, 'runReprintCommandUntilComplete' )
			.mockResolvedValue( { stdout: '{"ok":true}', stderr: '', exitCode: 0 } );

		const metadata = {
			version: 1,
			importKey: 'def',
			normalizedUrl: 'https://example.com/',
			siteName: 'example',
			sitePath,
			technicalSiteDirectory,
			rawDirectory,
			stateDirectory,
			runtimeDirectory: path.join( technicalSiteDirectory, 'runtime' ),
			runtimeBlueprintPath: path.join( technicalSiteDirectory, 'runtime', 'blueprint.json' ),
			stage: 'db-downloaded',
			localUrl: 'http://localhost:8881',
			remoteSiteUrl: 'https://example.com',
		} as never;

		await applyDownloadedDatabase( metadata, 'hmac-secret', false );

		const [ , , passedArgs, , passedOptions ] = reprint.mock.calls[ 0 ];
		// Sqlite now lands under the flattened site directly, and we mount
		// that host path so reprint can reach it inside PHP WASM.
		expect( passedArgs ).toContain(
			`--target-sqlite-path=${ sitePath }/wp-content/database/.ht.sqlite`
		);
		expect( passedOptions?.mounts ).toEqual( [ { hostPath: sitePath, vfsPath: sitePath } ] );

		fs.rmSync( technicalSiteDirectory, { recursive: true, force: true } );
	} );

	it( 'propagates the reprint error and leaves stage at db-downloaded for a safe resume', async () => {
		const technicalSiteDirectory = fs.mkdtempSync(
			path.join( os.tmpdir(), 'studio-import-db-apply-fail-' )
		);
		const stateDirectory = path.join( technicalSiteDirectory, 'state' );
		const rawDirectory = path.join( technicalSiteDirectory, 'raw' );
		const sitePath = path.join( technicalSiteDirectory, 'site' );
		fs.mkdirSync( stateDirectory, { recursive: true } );
		fs.mkdirSync( rawDirectory, { recursive: true } );
		fs.writeFileSync(
			path.join( stateDirectory, '.import-state.json' ),
			JSON.stringify( { preflight: { data: {} } } )
		);

		vi.spyOn( migrationClient, 'runReprintCommandUntilComplete' ).mockRejectedValue(
			new Error( 'reprint exited with code 1' )
		);

		const metadata = {
			version: 1,
			importKey: 'fail',
			normalizedUrl: 'https://example.com/',
			siteName: 'example',
			sitePath,
			technicalSiteDirectory,
			rawDirectory,
			stateDirectory,
			runtimeDirectory: path.join( technicalSiteDirectory, 'runtime' ),
			runtimeBlueprintPath: path.join( technicalSiteDirectory, 'runtime', 'blueprint.json' ),
			stage: 'db-downloaded' as const,
			localUrl: 'http://localhost:8881',
			remoteSiteUrl: 'https://example.com',
		};

		await expect(
			applyDownloadedDatabase( metadata as never, 'hmac-secret', false )
		).rejects.toThrow( 'reprint exited with code 1' );

		// Stage must NOT advance — otherwise a resume would skip db-apply
		// even though the database never made it into sqlite.
		expect( metadata.stage ).toBe( 'db-downloaded' );
		expect( fs.existsSync( path.join( technicalSiteDirectory, 'pull.json' ) ) ).toBe( false );

		fs.rmSync( technicalSiteDirectory, { recursive: true, force: true } );
	} );
} );
