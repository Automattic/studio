import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readAuthToken } from '@studio/common/lib/shared-config';
import { SITE_RUNTIME_PLAYGROUND } from '@studio/common/lib/site-runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableReprintExporter, rotateReprintSecret } from 'cli/lib/api';
import * as migrationClient from 'cli/lib/pull/migration-client';
import { shouldRestartFilesSyncIndex } from 'cli/lib/pull/reprint-state';
import { fetchSyncableSites } from 'cli/lib/sync-api';
import { pickSyncSite } from 'cli/lib/sync-site-picker';
import {
	runFullPull,
	downloadSkippedFiles,
	findMatchingWpComSite,
	getReprintApiUrlForSite,
	getPrivateDirNameForImportSession,
	inferSiteNameFromUrl,
	normalizeSiteUrl,
	resolveSourceSite,
} from '../pull-reprint';
import type { SyncSite } from '@studio/common/types/sync';

vi.mock( '@studio/common/lib/shared-config', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('@studio/common/lib/shared-config') >() ),
	readAuthToken: vi.fn(),
} ) );
vi.mock( 'cli/lib/api', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('cli/lib/api') >() ),
	rotateReprintSecret: vi.fn(),
	enableReprintExporter: vi.fn(),
} ) );
vi.mock( 'cli/lib/sync-api', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('cli/lib/sync-api') >() ),
	fetchSyncableSites: vi.fn(),
} ) );
vi.mock( 'cli/lib/sync-site-picker', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('cli/lib/sync-site-picker') >() ),
	pickSyncSite: vi.fn(),
} ) );

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
				[ { id: 1, name: 'Example', url: 'https://example.wordpress.com/' } ],
				'https://example.wordpress.com'
			)
		).toEqual( { id: 1, name: 'Example', url: 'https://example.wordpress.com/' } );
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
			SITE_RUNTIME_PLAYGROUND,
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

describe( 'CLI: studio pull-reprint single pull phase', () => {
	afterEach( () => {
		vi.restoreAllMocks();
	} );

	it( 'runs one reprint pull with sqlite under the content dir, mounts the site + runtime, and advances the stage', async () => {
		const technicalSiteDirectory = fs.mkdtempSync(
			path.join( os.tmpdir(), 'studio-import-pull-' )
		);
		const stateDirectory = path.join( technicalSiteDirectory, 'state' );
		const rawDirectory = path.join( technicalSiteDirectory, 'raw' );
		const sitePath = path.join( technicalSiteDirectory, 'site' );
		const runtimeDirectory = path.join( technicalSiteDirectory, 'runtime' );
		fs.mkdirSync( stateDirectory, { recursive: true } );
		fs.mkdirSync( rawDirectory, { recursive: true } );

		// Preflight reported the remote site's wp-content path at
		// database.wp.paths_urls.content_dir; the pull's db-apply stage targets
		// an sqlite file under rawDirectory + that path so flat-docroot can
		// symlink it into the flattened site.
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
			runtimeDirectory,
			runtimeBlueprintPath: path.join( runtimeDirectory, 'blueprint.json' ),
			stage: 'initialized',
			localUrl: 'http://localhost:8881',
			remoteSiteUrl: 'https://example.com',
		} as never;

		await runFullPull(
			SITE_RUNTIME_PLAYGROUND,
			metadata,
			'https://example.com/?reprint-api',
			'hmac-secret',
			false
		);

		expect( reprint ).toHaveBeenCalledTimes( 1 );
		const [ passedState, passedRaw, passedArgs, , passedOptions ] = reprint.mock.calls[ 0 ];
		expect( passedState ).toBe( stateDirectory );
		expect( passedRaw ).toBe( rawDirectory );
		expect( passedArgs ).toEqual( [
			'pull',
			'https://example.com/?reprint-api',
			'--secret=hmac-secret',
			'--filter=essential-files',
			'--target-engine=sqlite',
			`--target-sqlite-path=${ rawDirectory }/srv/htdocs/wp-content/database/.ht.sqlite`,
			'--new-site-url=http://localhost:8881',
			`--flatten-to=${ sitePath }`,
			'--runtime=playground-cli',
			'--start-runtime=none',
			`--output-dir=${ runtimeDirectory }`,
			'--no-adaptive',
			`--state-dir=${ stateDirectory }`,
			`--fs-root=${ rawDirectory }`,
		] );
		// The flattened site and runtime output dirs are mounted up front so
		// the single fork can write them to the host filesystem.
		expect( passedOptions?.mounts ).toEqual( [
			{ hostPath: sitePath, vfsPath: sitePath },
			{ hostPath: runtimeDirectory, vfsPath: runtimeDirectory },
		] );

		// Stage is bumped + persisted so a resumed run skips the pull.
		const persisted = JSON.parse(
			fs.readFileSync( path.join( technicalSiteDirectory, 'pull.json' ), 'utf-8' )
		);
		expect( persisted.stage ).toBe( 'pulled' );

		fs.rmSync( technicalSiteDirectory, { recursive: true, force: true } );
	} );

	it( 'falls back to the flattened wp-content sqlite path when preflight exposes no content dir', async () => {
		const technicalSiteDirectory = fs.mkdtempSync(
			path.join( os.tmpdir(), 'studio-import-pull-fallback-' )
		);
		const stateDirectory = path.join( technicalSiteDirectory, 'state' );
		const rawDirectory = path.join( technicalSiteDirectory, 'raw' );
		const sitePath = path.join( technicalSiteDirectory, 'site' );
		const runtimeDirectory = path.join( technicalSiteDirectory, 'runtime' );
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
			runtimeDirectory,
			runtimeBlueprintPath: path.join( runtimeDirectory, 'blueprint.json' ),
			stage: 'initialized',
			localUrl: 'http://localhost:8881',
			remoteSiteUrl: 'https://example.com',
		} as never;

		await runFullPull(
			SITE_RUNTIME_PLAYGROUND,
			metadata,
			'https://example.com/?reprint-api',
			'hmac-secret',
			false
		);

		const [ , , passedArgs, , passedOptions ] = reprint.mock.calls[ 0 ];
		// With no content dir from preflight, the sqlite target falls back to
		// the flattened site's wp-content.
		expect( passedArgs ).toContain(
			`--target-sqlite-path=${ sitePath }/wp-content/database/.ht.sqlite`
		);
		// The site + runtime dirs are always mounted for the single fork.
		expect( passedOptions?.mounts ).toEqual( [
			{ hostPath: sitePath, vfsPath: sitePath },
			{ hostPath: runtimeDirectory, vfsPath: runtimeDirectory },
		] );

		fs.rmSync( technicalSiteDirectory, { recursive: true, force: true } );
	} );

	it( 'propagates the reprint error and leaves the stage before "pulled" for a safe resume', async () => {
		const technicalSiteDirectory = fs.mkdtempSync(
			path.join( os.tmpdir(), 'studio-import-pull-fail-' )
		);
		const stateDirectory = path.join( technicalSiteDirectory, 'state' );
		const rawDirectory = path.join( technicalSiteDirectory, 'raw' );
		const sitePath = path.join( technicalSiteDirectory, 'site' );
		const runtimeDirectory = path.join( technicalSiteDirectory, 'runtime' );
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
			runtimeDirectory,
			runtimeBlueprintPath: path.join( runtimeDirectory, 'blueprint.json' ),
			stage: 'initialized' as const,
			localUrl: 'http://localhost:8881',
			remoteSiteUrl: 'https://example.com',
		};

		await expect(
			runFullPull(
				SITE_RUNTIME_PLAYGROUND,
				metadata as never,
				'https://example.com/?reprint-api',
				'hmac-secret',
				false
			)
		).rejects.toThrow( 'reprint exited with code 1' );

		// Stage must NOT advance to 'pulled' — otherwise a resume would skip
		// the pull even though the site never finished importing.
		expect( metadata.stage ).toBe( 'initialized' );
		expect( fs.existsSync( path.join( technicalSiteDirectory, 'pull.json' ) ) ).toBe( false );

		fs.rmSync( technicalSiteDirectory, { recursive: true, force: true } );
	} );
} );

describe( 'CLI: studio pull-reprint source resolution', () => {
	const token = {
		accessToken: 'access-token',
		id: 1,
		email: 'user@example.com',
		displayName: 'User',
		expiresIn: 1209600,
		expirationTime: Date.now() + 1209600000,
	};

	function syncSite(
		over: Partial< SyncSite > & { id: number; name: string; url: string }
	): SyncSite {
		return {
			localSiteId: '',
			isStaging: false,
			isPressable: false,
			syncSupport: 'syncable',
			lastPullTimestamp: null,
			lastPushTimestamp: null,
			...over,
		};
	}

	const sites: SyncSite[] = [
		syncSite( { id: 11, name: 'One', url: 'https://one.wordpress.com' } ),
		syncSite( { id: 22, name: 'Two', url: 'https://two.wordpress.com', isStaging: true } ),
	];

	const originalIsTTY = process.stdin.isTTY;

	function setTTY( value: boolean ): void {
		Object.defineProperty( process.stdin, 'isTTY', {
			value,
			configurable: true,
		} );
	}

	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( readAuthToken ).mockResolvedValue( token );
		vi.mocked( rotateReprintSecret ).mockResolvedValue( 'fresh-secret' );
	} );

	afterEach( () => {
		setTTY( originalIsTTY );
		vi.restoreAllMocks();
	} );

	it( 'opens the interactive picker for multiple syncable sites in a TTY and returns the chosen site', async () => {
		setTTY( true );
		vi.mocked( fetchSyncableSites ).mockResolvedValue( sites );
		vi.mocked( pickSyncSite ).mockResolvedValue( sites[ 1 ] );

		const source = await resolveSourceSite();

		expect( pickSyncSite ).toHaveBeenCalledWith( sites, expect.any( String ) );
		expect( source ).toMatchObject( {
			url: 'https://two.wordpress.com',
			secret: 'fresh-secret',
			wpComSite: sites[ 1 ],
		} );
		// A fresh secret is rotated for the picked site only.
		expect( rotateReprintSecret ).toHaveBeenCalledWith( 22, token.accessToken );
	} );

	it( 'returns null without rotating a secret when the user cancels the picker', async () => {
		setTTY( true );
		vi.mocked( fetchSyncableSites ).mockResolvedValue( sites );
		vi.mocked( pickSyncSite ).mockResolvedValue( undefined );

		const source = await resolveSourceSite();

		expect( source ).toBeNull();
		expect( rotateReprintSecret ).not.toHaveBeenCalled();
	} );

	it( 'aborts with an error for multiple sites when not in a TTY (no picker)', async () => {
		setTTY( false );
		vi.mocked( fetchSyncableSites ).mockResolvedValue( sites );

		await expect( resolveSourceSite() ).rejects.toThrow( /Re-run with `--url/ );
		expect( pickSyncSite ).not.toHaveBeenCalled();
		expect( rotateReprintSecret ).not.toHaveBeenCalled();
	} );

	it( 'auto-picks the only connected site without prompting (single-site path unchanged)', async () => {
		setTTY( true );
		vi.mocked( fetchSyncableSites ).mockResolvedValue( [ sites[ 0 ] ] );

		const source = await resolveSourceSite();

		expect( pickSyncSite ).not.toHaveBeenCalled();
		expect( source ).toMatchObject( {
			url: 'https://one.wordpress.com',
			secret: 'fresh-secret',
			wpComSite: sites[ 0 ],
		} );
	} );

	it( 'errors when no syncable sites exist', async () => {
		setTTY( true );
		vi.mocked( fetchSyncableSites ).mockResolvedValue( [] );

		await expect( resolveSourceSite() ).rejects.toThrow( /No pullable WordPress\.com sites/ );
		expect( pickSyncSite ).not.toHaveBeenCalled();
	} );

	it( 'passes the full site list to the picker so non-syncable sites can be shown disabled', async () => {
		setTTY( true );
		const nonSyncable = syncSite( {
			id: 33,
			name: 'Simple',
			url: 'https://simple.wordpress.com',
			syncSupport: 'needs-transfer',
		} );
		const all = [ sites[ 0 ], nonSyncable, sites[ 1 ] ];
		vi.mocked( fetchSyncableSites ).mockResolvedValue( all );
		vi.mocked( pickSyncSite ).mockResolvedValue( sites[ 1 ] );

		const source = await resolveSourceSite();

		// pickSyncSite itself disables non-syncable entries, so it receives the
		// full list rather than a pre-filtered one.
		expect( pickSyncSite ).toHaveBeenCalledWith( all, expect.any( String ) );
		expect( source ).toMatchObject( { wpComSite: sites[ 1 ] } );
	} );

	it( 'auto-picks the only syncable site when the rest are non-syncable', async () => {
		setTTY( true );
		const nonSyncable = syncSite( {
			id: 33,
			name: 'Simple',
			url: 'https://simple.wordpress.com',
			syncSupport: 'needs-upgrade',
		} );
		vi.mocked( fetchSyncableSites ).mockResolvedValue( [ nonSyncable, sites[ 0 ] ] );

		const source = await resolveSourceSite();

		expect( pickSyncSite ).not.toHaveBeenCalled();
		expect( source ).toMatchObject( { url: 'https://one.wordpress.com', wpComSite: sites[ 0 ] } );
	} );

	it( 'rotates a secret for a syncable site matched by --url', async () => {
		setTTY( true );
		vi.mocked( fetchSyncableSites ).mockResolvedValue( sites );

		const source = await resolveSourceSite( 'https://two.wordpress.com' );

		expect( source ).toMatchObject( {
			url: 'https://two.wordpress.com',
			secret: 'fresh-secret',
			wpComSite: sites[ 1 ],
		} );
		expect( rotateReprintSecret ).toHaveBeenCalledWith( 22, token.accessToken );
		expect( pickSyncSite ).not.toHaveBeenCalled();
	} );

	it( 'rejects a non-syncable site passed via --url with a clear message', async () => {
		setTTY( true );
		vi.mocked( fetchSyncableSites ).mockResolvedValue( [
			syncSite( {
				id: 44,
				name: 'Simple',
				url: 'https://only-simple.example.com',
				syncSupport: 'needs-transfer',
			} ),
		] );

		await expect( resolveSourceSite( 'https://only-simple.example.com' ) ).rejects.toThrow(
			/cannot be pulled/
		);
		expect( rotateReprintSecret ).not.toHaveBeenCalled();
	} );

	it( 'bypasses the picker entirely when --url and --secret are provided', async () => {
		setTTY( true );

		const source = await resolveSourceSite( 'https://self-hosted.example', 'my-secret' );

		expect( source ).toEqual( {
			url: 'https://self-hosted.example',
			secret: 'my-secret',
		} );
		expect( fetchSyncableSites ).not.toHaveBeenCalled();
		expect( pickSyncSite ).not.toHaveBeenCalled();
	} );
} );

describe( 'CLI: studio pull-reprint --path overwrite', () => {
	let fakeHome: string;

	afterEach( () => {
		vi.resetModules();
		vi.doUnmock( 'os' );
		if ( fakeHome ) {
			fs.rmSync( fakeHome, { recursive: true, force: true } );
		}
	} );

	/**
	 * Loads a fresh `pull-reprint` module whose `PULLS_ROOT` (~/.studio/pulls)
	 * resolves under a throwaway home directory, so writing the pull session
	 * never touches the developer's machine.
	 */
	async function loadWithFakeHome() {
		fakeHome = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-pull-overwrite-home-' ) );
		vi.resetModules();
		vi.doMock( 'os', async () => {
			const actual = await vi.importActual< typeof import('os') >( 'os' );
			return {
				...actual,
				default: { ...actual, homedir: () => fakeHome },
				homedir: () => fakeHome,
			};
		} );
		return import( '../pull-reprint' );
	}

	it( 'reuses the targeted site (path, name, id) and skips the non-empty-dir guard', async () => {
		const { getPullSessionMetadata } = await loadWithFakeHome();

		// An existing, non-empty Studio site directory we intend to overwrite —
		// in create mode this would throw "already exists and is not empty".
		const sitePath = path.join( fakeHome, 'Studio', 'existing-site' );
		fs.mkdirSync( sitePath, { recursive: true } );
		fs.writeFileSync( path.join( sitePath, 'wp-config.php' ), '<?php' );

		const targetSite = {
			id: 'site-123',
			name: 'Existing Site',
			path: sitePath,
			port: 8881,
		} as never;

		const { created, studioMetadata } = await getPullSessionMetadata(
			'https://example.com',
			undefined,
			targetSite
		);

		// A fresh pull session, but pointed at the existing site instead of a
		// brand-new ~/Studio directory.
		expect( created ).toBe( true );
		expect( studioMetadata.sitePath ).toBe( sitePath );
		expect( studioMetadata.siteName ).toBe( 'Existing Site' );
		expect( studioMetadata.siteId ).toBe( 'site-123' );
	} );

	it( 'keys the resume directory by site id so it does not collide with a create-mode pull', async () => {
		const { getPullSessionMetadata, getPrivateDirNameForImportSession, normalizeSiteUrl } =
			await loadWithFakeHome();

		const sitePath = path.join( fakeHome, 'Studio', 'existing-site' );
		fs.mkdirSync( sitePath, { recursive: true } );

		const targetSite = {
			id: 'site-abc',
			name: 'Existing Site',
			path: sitePath,
			port: 8881,
		} as never;

		const { studioMetadata } = await getPullSessionMetadata(
			'https://example.com',
			undefined,
			targetSite
		);

		const overwriteKey = getPrivateDirNameForImportSession(
			normalizeSiteUrl( 'https://example.com' ),
			'site:site-abc'
		);
		const createKey = getPrivateDirNameForImportSession(
			normalizeSiteUrl( 'https://example.com' ),
			undefined
		);
		expect( path.basename( studioMetadata.technicalSiteDirectory ) ).toBe( overwriteKey );
		expect( overwriteKey ).not.toBe( createKey );
	} );

	it( 'creates a new site at an explicit --path when no site is registered there', async () => {
		const { getPullSessionMetadata } = await loadWithFakeHome();

		// A brand-new location the user wants the pulled site to live at — no
		// registered site, so this is a create (not an overwrite).
		const sitePath = path.join( fakeHome, 'Studio', 'my-new-pulled-site' );

		const { created, studioMetadata } = await getPullSessionMetadata(
			'https://example.com',
			undefined,
			undefined,
			sitePath
		);

		expect( created ).toBe( true );
		// Honors --path rather than falling back to ~/Studio/<name-from-url>.
		expect( studioMetadata.sitePath ).toBe( sitePath );
		// Named after the target folder.
		expect( studioMetadata.siteName ).toBe( 'my-new-pulled-site' );
		// Brand-new site: no existing id is reused.
		expect( studioMetadata.siteId ).toBeUndefined();
	} );

	it( 'resumes the same session when an explicit --path later resolves to a registered site', async () => {
		const { getPullSessionMetadata } = await loadWithFakeHome();
		const sitePath = path.join( fakeHome, 'Studio', 'created-by-path' );

		// Run 1: explicit --path, nothing registered there yet → a path-keyed
		// create session.
		const first = await getPullSessionMetadata(
			'https://example.com',
			undefined,
			undefined,
			sitePath
		);
		expect( first.created ).toBe( true );

		// Run 2: same --path, but the first pull has since registered a site at
		// that location. The session must resume the SAME technical directory
		// instead of switching to a site-id key and forking a second one.
		const targetSite = {
			id: 'site-xyz',
			name: 'created-by-path',
			path: sitePath,
			port: 8881,
		} as never;
		const second = await getPullSessionMetadata(
			'https://example.com',
			undefined,
			targetSite,
			sitePath
		);
		expect( second.created ).toBe( false );
		expect( second.studioMetadata.technicalSiteDirectory ).toBe(
			first.studioMetadata.technicalSiteDirectory
		);
	} );

	it( 'resumes a site-id-keyed session when later looked up with an explicit --path', async () => {
		const { getPullSessionMetadata } = await loadWithFakeHome();
		const sitePath = path.join( fakeHome, 'Studio', 'cwd-site' );
		fs.mkdirSync( sitePath, { recursive: true } );
		const targetSite = { id: 'site-cwd', name: 'cwd-site', path: sitePath, port: 8881 } as never;

		// Run 1: started from inside the registered site dir (no explicit --path)
		// → keyed by site id.
		const first = await getPullSessionMetadata(
			'https://example.com',
			undefined,
			targetSite,
			undefined
		);
		expect( first.created ).toBe( true );

		// Run 2: the same site, but invoked with an explicit --path (which derives
		// a `path:` primary key). It must fall back to the site-id key and resume
		// the SAME session rather than forking a second one.
		const second = await getPullSessionMetadata(
			'https://example.com',
			undefined,
			targetSite,
			sitePath
		);
		expect( second.created ).toBe( false );
		expect( second.studioMetadata.technicalSiteDirectory ).toBe(
			first.studioMetadata.technicalSiteDirectory
		);
	} );

	it( 'reuses a cached secret found under the site-id key when looked up via explicit --path', async () => {
		const { resolveSourceSite, getPrivateDirNameForImportSession, normalizeSiteUrl } =
			await loadWithFakeHome();
		const url = 'https://example.com';
		const sitePath = path.join( fakeHome, 'Studio', 'cwd-site-2' );
		const targetSite = { id: 'site-sec', name: 'cwd-site-2', path: sitePath, port: 8881 } as never;

		// Seed a site-id-keyed session that carries a cached secret.
		const key = getPrivateDirNameForImportSession(
			normalizeSiteUrl( url ),
			`site:${ targetSite.id }`
		);
		const techDir = path.join( fakeHome, '.studio', 'pulls', key );
		fs.mkdirSync( techDir, { recursive: true } );
		fs.writeFileSync(
			path.join( techDir, 'pull.json' ),
			JSON.stringify( {
				version: 1,
				normalizedUrl: normalizeSiteUrl( url ),
				secret: 'cached-secret',
			} )
		);

		// An explicit --path derives a `path:` key with no cached secret, so it
		// must fall back to the site-id key and reuse the cached secret instead of
		// rotating a fresh one.
		const source = await resolveSourceSite(
			url,
			undefined,
			undefined,
			false,
			targetSite,
			sitePath
		);
		expect( source ).toEqual( { url, secret: 'cached-secret' } );
	} );
} );

describe( 'CLI: studio pull-reprint confirmation before creating a site', () => {
	const confirmMock = vi.fn();
	let fakeHome: string;
	let originalIsTty: boolean | undefined;

	afterEach( () => {
		vi.restoreAllMocks();
		vi.resetModules();
		confirmMock.mockReset();
		if ( fakeHome ) {
			fs.rmSync( fakeHome, { recursive: true, force: true } );
		}
		Object.defineProperty( process.stdin, 'isTTY', {
			value: originalIsTty,
			configurable: true,
		} );
	} );

	/**
	 * Loads a fresh `pull-reprint` module whose `PULLS_ROOT` (~/.studio/pulls)
	 * and `STUDIO_SITES_ROOT` (~/Studio) are anchored to a throwaway home
	 * directory, so the real `runCommand` never touches the developer's
	 * machine.  `@inquirer/prompts` `confirm` is replaced with a spy so we
	 * can drive the accept/decline branch deterministically.
	 */
	async function loadRunCommandWithFakeHome() {
		fakeHome = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-pull-confirm-home-' ) );

		vi.resetModules();
		vi.doMock( 'os', async () => {
			const actual = await vi.importActual< typeof import('os') >( 'os' );
			return {
				...actual,
				default: { ...actual, homedir: () => fakeHome },
				homedir: () => fakeHome,
			};
		} );
		vi.doMock( '@inquirer/prompts', () => ( { confirm: confirmMock } ) );

		const mod = await import( '../pull-reprint' );
		return mod;
	}

	function setTty( isTty: boolean ) {
		originalIsTty = process.stdin.isTTY;
		Object.defineProperty( process.stdin, 'isTTY', {
			value: isTty,
			configurable: true,
		} );
	}

	function pullsRoot() {
		return path.join( fakeHome, '.studio', 'pulls' );
	}

	function studioSitesRoot() {
		return path.join( fakeHome, 'Studio' );
	}

	it( 'declining the prompt creates no site dirs, removes the technical dir, and returns early', async () => {
		setTty( true );
		confirmMock.mockResolvedValue( false );
		const { runCommand } = await loadRunCommandWithFakeHome();

		const logSpy = vi.spyOn( console, 'log' ).mockImplementation( () => undefined );

		await runCommand(
			'https://example.com',
			'hmac-secret',
			'My Declined Site',
			false,
			false,
			false
		);

		// The prompt was shown exactly once.
		expect( confirmMock ).toHaveBeenCalledTimes( 1 );

		// No site directory was created under ~/Studio.
		expect( fs.existsSync( studioSitesRoot() ) ).toBe( false );

		// The technical dir that getPullSessionMetadata just created (with its
		// pull.json) was cleaned up so a later run won't treat it as resumable.
		const pullsDirEntries = fs.existsSync( pullsRoot() ) ? fs.readdirSync( pullsRoot() ) : [];
		expect( pullsDirEntries ).toEqual( [] );

		// User saw a cancellation message.
		expect( logSpy.mock.calls.flat().join( '\n' ) ).toContain( 'Cancelled.' );
	} );

	it( 'skips the prompt entirely when --yes is passed', async () => {
		setTty( true );
		confirmMock.mockResolvedValue( false );
		const { runCommand } = await loadRunCommandWithFakeHome();

		// Stop the pipeline right after the (skipped) prompt by failing the
		// first reprint command; we only care that confirm() was never called.
		const migrationClientMod = await import( 'cli/lib/pull/migration-client' );
		vi.spyOn( migrationClientMod, 'runReprintCommandUntilComplete' ).mockRejectedValue(
			new Error( 'stop after prompt gate' )
		);
		vi.spyOn( console, 'log' ).mockImplementation( () => undefined );
		vi.spyOn( console, 'error' ).mockImplementation( () => undefined );

		// The pipeline runs past the prompt gate and then fails on the mocked
		// reprint call — we only assert the prompt was never shown.
		await expect(
			runCommand( 'https://example.com', 'hmac-secret', 'My Yes Site', false, false, true )
		).rejects.toThrow();

		expect( confirmMock ).not.toHaveBeenCalled();
	} );

	it( 'does not prompt on a resumed pull (created === false)', async () => {
		setTty( true );
		confirmMock.mockResolvedValue( false );
		const { runCommand, getPrivateDirNameForImportSession, normalizeSiteUrl } =
			await loadRunCommandWithFakeHome();

		// Seed a pre-existing pull.json so getPullSessionMetadata reports a
		// resume (created === false) and the prompt gate is bypassed.
		const normalizedUrl = normalizeSiteUrl( 'https://example.com' );
		const pullKey = getPrivateDirNameForImportSession( normalizedUrl, 'My Resumed Site' );
		const technicalSiteDirectory = path.join( pullsRoot(), pullKey );
		const sitePath = path.join( studioSitesRoot(), 'My-Resumed-Site' );
		fs.mkdirSync( technicalSiteDirectory, { recursive: true } );
		fs.writeFileSync(
			path.join( technicalSiteDirectory, 'pull.json' ),
			JSON.stringify( {
				version: 1,
				pullKey,
				normalizedUrl,
				siteName: 'My Resumed Site',
				sitePath,
				technicalSiteDirectory,
				rawDirectory: path.join( technicalSiteDirectory, 'raw' ),
				stateDirectory: path.join( technicalSiteDirectory, 'state' ),
				runtimeDirectory: path.join( technicalSiteDirectory, 'runtime' ),
				runtimeBlueprintPath: path.join( technicalSiteDirectory, 'runtime', 'blueprint.json' ),
				stage: 'initialized',
			} )
		);

		// Fail the first reprint call so the resume stops quickly after the
		// (skipped) prompt gate.
		const migrationClientMod = await import( 'cli/lib/pull/migration-client' );
		vi.spyOn( migrationClientMod, 'runReprintCommandUntilComplete' ).mockRejectedValue(
			new Error( 'stop after prompt gate' )
		);
		vi.spyOn( console, 'log' ).mockImplementation( () => undefined );
		vi.spyOn( console, 'error' ).mockImplementation( () => undefined );

		// The resume runs past the (skipped) prompt gate and then fails on the
		// mocked reprint call — we only assert the prompt was never shown and
		// the pre-existing technical dir survived.
		await expect(
			runCommand( 'https://example.com', 'hmac-secret', 'My Resumed Site', false, false, false )
		).rejects.toThrow();

		expect( confirmMock ).not.toHaveBeenCalled();

		// The pre-existing technical dir must NOT be deleted by the prompt gate.
		expect( fs.existsSync( technicalSiteDirectory ) ).toBe( true );
	} );
} );

describe( 'CLI: studio pull-reprint delta re-pull of a completed pull', () => {
	let fakeHome: string;

	afterEach( () => {
		vi.restoreAllMocks();
		vi.resetModules();
		if ( fakeHome ) {
			fs.rmSync( fakeHome, { recursive: true, force: true } );
		}
	} );

	/**
	 * Same throwaway-home harness as the confirmation tests: anchors
	 * PULLS_ROOT and the Studio sites root to a temp directory so the
	 * real runCommand never touches the developer's machine.
	 */
	async function loadRunCommandWithFakeHome() {
		fakeHome = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-pull-repull-home-' ) );

		vi.resetModules();
		vi.doMock( 'os', async () => {
			const actual = await vi.importActual< typeof import('os') >( 'os' );
			return {
				...actual,
				default: { ...actual, homedir: () => fakeHome },
				homedir: () => fakeHome,
			};
		} );

		const mod = await import( '../pull-reprint' );
		return mod;
	}

	it( 'resets a completed pull for a delta re-run instead of exiting early', async () => {
		const { runCommand, getPrivateDirNameForImportSession, normalizeSiteUrl } =
			await loadRunCommandWithFakeHome();

		const normalizedUrl = normalizeSiteUrl( 'https://example.com' );
		const pullKey = getPrivateDirNameForImportSession( normalizedUrl, 'My Completed Site' );
		const pullsRoot = path.join( fakeHome, '.studio', 'pulls' );
		const technicalSiteDirectory = path.join( pullsRoot, pullKey );
		const stateDirectory = path.join( technicalSiteDirectory, 'state' );
		const sitePath = path.join( fakeHome, 'Studio', 'My-Completed-Site' );

		// Seed a completed pull whose site directory is non-empty (it holds
		// the previous pull's output) and whose preflight response is cached.
		fs.mkdirSync( stateDirectory, { recursive: true } );
		fs.mkdirSync( sitePath, { recursive: true } );
		fs.writeFileSync( path.join( sitePath, 'wp-config.php' ), '<?php // flattened output' );
		fs.writeFileSync(
			path.join( stateDirectory, 'preflight.json' ),
			JSON.stringify( { siteurl: 'https://example.com' } )
		);
		fs.writeFileSync(
			path.join( technicalSiteDirectory, 'pull.json' ),
			JSON.stringify( {
				version: 1,
				pullKey,
				normalizedUrl,
				siteName: 'My Completed Site',
				sitePath,
				technicalSiteDirectory,
				rawDirectory: path.join( technicalSiteDirectory, 'raw' ),
				stateDirectory,
				runtimeDirectory: path.join( technicalSiteDirectory, 'runtime' ),
				runtimeBlueprintPath: path.join( technicalSiteDirectory, 'runtime', 'blueprint.json' ),
				stage: 'completed',
				port: 8901,
				localUrl: 'http://localhost:8901',
				secret: 'cached-secret',
			} )
		);

		// Fail the first reprint invocation so the re-pull stops right after
		// the stage reset — we assert on the persisted metadata, not on a
		// full pipeline run.
		const migrationClientMod = await import( 'cli/lib/pull/migration-client' );
		const reprintSpy = vi
			.spyOn( migrationClientMod, 'runReprintCommandUntilComplete' )
			.mockRejectedValue( new Error( 'stop after repull reset' ) );
		const logSpy = vi.spyOn( console, 'log' ).mockImplementation( () => undefined );
		vi.spyOn( console, 'error' ).mockImplementation( () => undefined );

		await expect(
			runCommand( 'https://example.com', 'hmac-secret', 'My Completed Site', false, false, false )
		).rejects.toThrow();

		// The old behavior exited early without ever invoking reprint; the
		// re-pull must re-enter the pipeline (preflight is its first call).
		expect( reprintSpy ).toHaveBeenCalled();
		expect( reprintSpy.mock.calls[ 0 ][ 2 ][ 0 ] ).toBe( 'preflight' );

		// The stage machine was reset and the re-pull marker persisted.
		const metadata = JSON.parse(
			fs.readFileSync( path.join( technicalSiteDirectory, 'pull.json' ), 'utf-8' )
		);
		expect( metadata.stage ).toBe( 'initialized' );
		expect( metadata.hasCompletedOnce ).toBe( true );

		// The cached preflight was dropped so connectivity is re-verified.
		expect( fs.existsSync( path.join( stateDirectory, 'preflight.json' ) ) ).toBe( false );

		// The non-empty site directory did not trip the clobber guard.
		expect( fs.existsSync( path.join( sitePath, 'wp-config.php' ) ) ).toBe( true );

		// The user sees update messaging, not a no-op success.
		expect( logSpy.mock.calls.flat().join( '\n' ) ).toContain( 'Updating "My Completed Site"' );
	} );
} );

describe( 'CLI: studio pull-reprint preflight retry re-enables the exporter', () => {
	let fakeHome: string;

	const token = {
		accessToken: 'access-token',
		id: 1,
		email: 'user@example.com',
		displayName: 'User',
		expiresIn: 1209600,
		expirationTime: Date.now() + 1209600000,
	};

	const sites: SyncSite[] = [
		{
			id: 22,
			name: 'Example',
			url: 'https://example.com',
			localSiteId: '',
			isStaging: false,
			isPressable: false,
			syncSupport: 'syncable',
			lastPullTimestamp: null,
			lastPushTimestamp: null,
		},
	];

	afterEach( () => {
		vi.restoreAllMocks();
		vi.resetModules();
		if ( fakeHome ) {
			fs.rmSync( fakeHome, { recursive: true, force: true } );
		}
	} );

	async function loadRunCommandWithFakeHome() {
		fakeHome = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-pull-retry-home-' ) );

		vi.resetModules();
		vi.doMock( 'os', async () => {
			const actual = await vi.importActual< typeof import('os') >( 'os' );
			return {
				...actual,
				default: { ...actual, homedir: () => fakeHome },
				homedir: () => fakeHome,
			};
		} );

		const mod = await import( '../pull-reprint' );
		return mod;
	}

	it( 're-enables the exporter (not just rotates the secret) before retrying a failed preflight', async () => {
		const { runCommand, getPrivateDirNameForImportSession, normalizeSiteUrl } =
			await loadRunCommandWithFakeHome();

		// Seed a previously-completed pull with a cached secret but no
		// wpComSite/wpComToken — exactly the delta-re-pull shape that makes
		// resolveSourceSite short-circuit on the cached secret and skip the
		// happy-path exporter enable.
		const normalizedUrl = normalizeSiteUrl( 'https://example.com' );
		const pullKey = getPrivateDirNameForImportSession( normalizedUrl, 'My Retry Site' );
		const pullsRoot = path.join( fakeHome, '.studio', 'pulls' );
		const technicalSiteDirectory = path.join( pullsRoot, pullKey );
		const stateDirectory = path.join( technicalSiteDirectory, 'state' );
		const sitePath = path.join( fakeHome, 'Studio', 'My-Retry-Site' );

		fs.mkdirSync( stateDirectory, { recursive: true } );
		fs.mkdirSync( sitePath, { recursive: true } );
		fs.writeFileSync( path.join( sitePath, 'wp-config.php' ), '<?php // flattened output' );
		fs.writeFileSync(
			path.join( technicalSiteDirectory, 'pull.json' ),
			JSON.stringify( {
				version: 1,
				pullKey,
				normalizedUrl,
				siteName: 'My Retry Site',
				sitePath,
				technicalSiteDirectory,
				rawDirectory: path.join( technicalSiteDirectory, 'raw' ),
				stateDirectory,
				runtimeDirectory: path.join( technicalSiteDirectory, 'runtime' ),
				runtimeBlueprintPath: path.join( technicalSiteDirectory, 'runtime', 'blueprint.json' ),
				stage: 'initialized',
				hasCompletedOnce: true,
				secret: 'cached-secret',
			} )
		);

		vi.mocked( readAuthToken ).mockResolvedValue( token );
		vi.mocked( fetchSyncableSites ).mockResolvedValue( sites );
		vi.mocked( rotateReprintSecret ).mockResolvedValue( 'fresh-secret' );
		vi.mocked( enableReprintExporter ).mockResolvedValue( undefined );

		// Every preflight attempt fails (the closed wpcomsh gate returns HTML),
		// so the command ultimately rejects — but the retry path must still
		// rotate the secret AND re-enable the exporter before giving up.
		const migrationClientMod = await import( 'cli/lib/pull/migration-client' );
		vi.spyOn( migrationClientMod, 'runReprintCommandUntilComplete' ).mockRejectedValue(
			new Error( 'preflight failed: HTML response' )
		);
		vi.spyOn( console, 'log' ).mockImplementation( () => undefined );
		vi.spyOn( console, 'error' ).mockImplementation( () => undefined );

		await expect(
			runCommand( 'https://example.com', undefined, 'My Retry Site', false, false, true )
		).rejects.toThrow();

		// The fix: the retry resolves the WP.com site, rotates the secret, AND
		// re-opens the exporter gate. Without the enable call the retry would
		// hit the same closed window and fail identically.
		expect( rotateReprintSecret ).toHaveBeenCalledWith( 22, token.accessToken );
		expect( enableReprintExporter ).toHaveBeenCalledWith( 22, token.accessToken, false );
	} );
} );

describe( 'CLI: studio pull-reprint admin credentials re-apply', () => {
	afterEach( () => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	} );

	function makeSite( overrides: Record< string, unknown > = {} ) {
		return {
			id: 'site-1',
			name: 'Test Site',
			path: '/tmp/test-site',
			port: 8901,
			phpVersion: '8.2',
			running: true,
			...overrides,
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
		} as any;
	}

	it( 'skips when the site record has no admin credentials', async () => {
		const { reapplyAdminCredentials } = await import( '../pull-reprint' );
		const fetchSpy = vi.fn();
		vi.stubGlobal( 'fetch', fetchSpy );

		await expect( reapplyAdminCredentials( makeSite() ) ).resolves.toBe( 'skipped' );
		expect( fetchSpy ).not.toHaveBeenCalled();
	} );

	it( 'posts the stored credentials to the running site admin API', async () => {
		const { reapplyAdminCredentials } = await import( '../pull-reprint' );
		const { encodePassword } = await import( '@studio/common/lib/passwords' );
		const fetchSpy = vi.fn().mockResolvedValue( { ok: true, status: 200 } );
		vi.stubGlobal( 'fetch', fetchSpy );

		const site = makeSite( { adminPassword: encodePassword( 'secret-pw' ) } );
		await expect( reapplyAdminCredentials( site ) ).resolves.toBe( 'applied' );

		expect( fetchSpy ).toHaveBeenCalledTimes( 1 );
		const [ url, init ] = fetchSpy.mock.calls[ 0 ];
		expect( String( url ) ).toContain( 'studio-admin-api' );
		expect( init.method ).toBe( 'POST' );
		const params = init.body as URLSearchParams;
		expect( params.get( 'action' ) ).toBe( 'set_admin_password' );
		expect( params.get( 'password' ) ).toBe( 'secret-pw' );
	} );

	it( 'reports an unreachable server instead of throwing on connection failure', async () => {
		const { reapplyAdminCredentials } = await import( '../pull-reprint' );
		const { encodePassword } = await import( '@studio/common/lib/passwords' );
		vi.stubGlobal( 'fetch', vi.fn().mockRejectedValue( new Error( 'ECONNREFUSED' ) ) );

		const site = makeSite( { adminPassword: encodePassword( 'secret-pw' ) } );
		await expect( reapplyAdminCredentials( site ) ).resolves.toBe( 'unreachable' );
	} );

	it( 'throws when the admin API answers with an error status', async () => {
		const { reapplyAdminCredentials } = await import( '../pull-reprint' );
		const { encodePassword } = await import( '@studio/common/lib/passwords' );
		vi.stubGlobal( 'fetch', vi.fn().mockResolvedValue( { ok: false, status: 400 } ) );

		const site = makeSite( { adminPassword: encodePassword( 'secret-pw' ) } );
		await expect( reapplyAdminCredentials( site ) ).rejects.toThrow(
			'Failed to re-apply the admin credentials'
		);
	} );
} );

describe( 'CLI: studio pull-reprint --abort key fallback', () => {
	let fakeHome: string;

	afterEach( () => {
		vi.resetModules();
		vi.doUnmock( 'os' );
		vi.doUnmock( 'trash' );
		vi.doUnmock( 'cli/lib/cli-config/sites' );
		if ( fakeHome ) {
			fs.rmSync( fakeHome, { recursive: true, force: true } );
		}
	} );

	it( 'aborts a site-id-keyed overwrite session when given an explicit --path', async () => {
		fakeHome = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-pull-abort-' ) );
		const trashMock = vi.fn();
		const site = {
			id: 'site-zzz',
			name: 'My Site',
			path: path.join( fakeHome, 'Studio', 'my-site' ),
			port: 8881,
		};

		vi.resetModules();
		vi.doMock( 'os', async () => {
			const actual = await vi.importActual< typeof import('os') >( 'os' );
			return {
				...actual,
				default: { ...actual, homedir: () => fakeHome },
				homedir: () => fakeHome,
			};
		} );
		vi.doMock( 'trash', () => ( { default: trashMock } ) );
		vi.doMock( 'cli/lib/cli-config/sites', async () => {
			const actual = await vi.importActual< typeof import('cli/lib/cli-config/sites') >(
				'cli/lib/cli-config/sites'
			);
			return {
				...actual,
				findSiteByFolder: vi.fn( async ( p: string ) => ( p === site.path ? site : undefined ) ),
			};
		} );

		const mod = await import( '../pull-reprint' );
		const url = 'https://example.com';

		// Seed a pull.json under the SITE-ID key — how a session started from
		// inside a registered site directory (no explicit --path) is keyed.
		const seed = `site:${ site.id }`;
		const key = mod.getPrivateDirNameForImportSession( mod.normalizeSiteUrl( url ), seed );
		const techDir = path.join( fakeHome, '.studio', 'pulls', key );
		fs.mkdirSync( techDir, { recursive: true } );
		fs.writeFileSync(
			path.join( techDir, 'pull.json' ),
			JSON.stringify( {
				version: 1,
				pullKey: key,
				normalizedUrl: mod.normalizeSiteUrl( url ),
				siteName: site.name,
				sitePath: site.path,
				technicalSiteDirectory: techDir,
				rawDirectory: path.join( techDir, 'raw' ),
				stateDirectory: path.join( techDir, 'state' ),
				runtimeDirectory: path.join( techDir, 'runtime' ),
				runtimeBlueprintPath: path.join( techDir, 'runtime', 'blueprint.json' ),
				stage: 'site-registered',
				siteId: site.id,
				isOverwrite: true,
			} )
		);

		// Abort with an EXPLICIT --path: that derives a `path:<path>` key which
		// has no session, so it must fall back to the site-id key and find it.
		await mod.abortPull( url, undefined, site.path, true, false );

		// Overwrite session → only the technical dir is trashed, never the site.
		expect( trashMock ).toHaveBeenCalledTimes( 1 );
		expect( trashMock ).toHaveBeenCalledWith( [ techDir ] );
	} );
} );
