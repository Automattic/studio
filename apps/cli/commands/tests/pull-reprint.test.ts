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
	normalizeSiteUrl,
	resolveSourceSite,
} from '../pull-reprint';
import type { SyncSite } from '@studio/common/types/sync';

// This file contains integration-style tests that reload the CLI module graph
// and perform multiple atomic config writes. Those can exceed the default
// timeout on CI.
vi.setConfig( { testTimeout: 15_000 } );

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

/**
 * A minimal valid `SiteData` record (as produced by `studio create`):
 * has identity + port + php version but no pull-specific fields.
 */
function makeSiteRecord( over: Record< string, unknown > = {} ): Record< string, unknown > {
	return {
		id: 'site-1',
		name: 'Test Site',
		path: '/tmp/test-site',
		port: 8901,
		phpVersion: '8.2',
		running: false,
		isWpAutoUpdating: true,
		enableHttps: false,
		...over,
	};
}

function mockWpComPullSource( url = 'https://example.com' ): SyncSite {
	const token = {
		accessToken: 'access-token',
		id: 1,
		email: 'user@example.com',
		displayName: 'User',
		expiresIn: 1209600,
		expirationTime: Date.now() + 1209600000,
	};
	const site: SyncSite = {
		id: 22,
		name: 'Example',
		url,
		localSiteId: '',
		isStaging: false,
		isPressable: false,
		syncSupport: 'syncable',
		lastPullTimestamp: null,
		lastPushTimestamp: null,
	};

	vi.mocked( readAuthToken ).mockResolvedValue( token );
	vi.mocked( fetchSyncableSites ).mockResolvedValue( [ site ] );
	vi.mocked( rotateReprintSecret ).mockResolvedValue( 'hmac-secret' );
	vi.mocked( enableReprintExporter ).mockResolvedValue( undefined );

	return site;
}

/** Seeds `~/.studio/cli.json` (under the fake home) with the given sites. */
function seedCliConfigSite( homeDir: string, sites: Record< string, unknown >[] ): void {
	const configDir = path.join( homeDir, '.studio' );
	fs.mkdirSync( configDir, { recursive: true } );
	fs.writeFileSync(
		path.join( configDir, 'cli.json' ),
		JSON.stringify( { version: 1, sites, snapshots: [] } )
	);
}

function readSeededCliConfig( homeDir: string ): {
	sites: ( Record< string, unknown > & { id: string } )[];
} {
	return JSON.parse( fs.readFileSync( path.join( homeDir, '.studio', 'cli.json' ), 'utf-8' ) );
}

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
			false,
			true
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
			'--force',
		] );
		// The flattened site and runtime output dirs are mounted up front so
		// the single fork can write them to the host filesystem.
		expect( passedOptions?.mounts ).toEqual( [
			{ hostPath: sitePath, vfsPath: sitePath },
			{ hostPath: runtimeDirectory, vfsPath: runtimeDirectory },
		] );

		// No Studio-owned progress file is written: resume is by derivation
		// (reprint's own `.import-state.json` + the site's `status`), so the
		// pull is always re-invoked rather than skipped via a stage cursor.
		expect( fs.existsSync( path.join( technicalSiteDirectory, 'pull.json' ) ) ).toBe( false );

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

		// force=false models a delta re-pull, which must not force-overwrite
		// the live site.
		await runFullPull(
			SITE_RUNTIME_PLAYGROUND,
			metadata,
			'https://example.com/?reprint-api',
			'hmac-secret',
			false,
			false
		);

		const [ , , passedArgs, , passedOptions ] = reprint.mock.calls[ 0 ];
		// With no content dir from preflight, the sqlite target falls back to
		// the flattened site's wp-content.
		expect( passedArgs ).toContain(
			`--target-sqlite-path=${ sitePath }/wp-content/database/.ht.sqlite`
		);
		// A delta re-pull (force=false) omits --force.
		expect( passedArgs ).not.toContain( '--force' );
		// The site + runtime dirs are always mounted for the single fork.
		expect( passedOptions?.mounts ).toEqual( [
			{ hostPath: sitePath, vfsPath: sitePath },
			{ hostPath: runtimeDirectory, vfsPath: runtimeDirectory },
		] );

		fs.rmSync( technicalSiteDirectory, { recursive: true, force: true } );
	} );

	it( 'propagates the reprint error and writes no progress file (resume is by derivation)', async () => {
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
				false,
				true
			)
		).rejects.toThrow( 'reprint exited with code 1' );

		// No progress file is written on failure either — a re-run resumes by
		// re-invoking the idempotent pull, not by reading a stage cursor.
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

		await expect( resolveSourceSite() ).rejects.toThrow(
			/No pullable WordPress\.com or Pressable sites/
		);
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

	it( 'rejects a URL that is not connected to the WordPress.com account', async () => {
		setTTY( true );
		vi.mocked( fetchSyncableSites ).mockResolvedValue( sites );

		await expect( resolveSourceSite( 'https://third-party.example' ) ).rejects.toThrow(
			/not a WordPress\.com or Pressable site connected to your account/
		);
		expect( pickSyncSite ).not.toHaveBeenCalled();
		expect( rotateReprintSecret ).not.toHaveBeenCalled();
	} );
} );

describe( 'CLI: studio pull-reprint requires an existing site', () => {
	let fakeHome: string;

	afterEach( () => {
		vi.restoreAllMocks();
		vi.resetModules();
		if ( fakeHome ) {
			fs.rmSync( fakeHome, { recursive: true, force: true } );
		}
	} );

	/**
	 * Loads a fresh `pull-reprint` module whose config + pulls directories
	 * are anchored to a throwaway home, so the real `runCommand` never
	 * touches the developer's machine.
	 */
	async function loadRunCommandWithFakeHome() {
		fakeHome = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-pull-existing-home-' ) );

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

	function pullsRoot() {
		return path.join( fakeHome, '.studio', 'pulls' );
	}

	it( 'errors when no Studio site exists at --path, before touching the remote', async () => {
		const { runCommand } = await loadRunCommandWithFakeHome();
		const sitePath = path.join( fakeHome, 'Studio', 'Missing-Site' );

		const migrationClientMod = await import( 'cli/lib/pull/migration-client' );
		const reprintSpy = vi.spyOn( migrationClientMod, 'runReprintCommandUntilComplete' );

		await expect( runCommand( sitePath, 'https://example.com', false ) ).rejects.toThrow(
			'The specified directory is not added to Studio.'
		);

		// The site lookup fails up front, so the remote is never contacted and
		// no pull scratch directory is created.
		expect( reprintSpy ).not.toHaveBeenCalled();
		expect( fs.existsSync( pullsRoot() ) ).toBe( false );
	} );

	it( 'pulls into the site resolved by --path, sourcing identity from the record and creating no new site', async () => {
		const { runCommand } = await loadRunCommandWithFakeHome();
		mockWpComPullSource();
		const sitePath = path.join( fakeHome, 'Studio', 'Existing-Site' );
		seedCliConfigSite( fakeHome, [
			makeSiteRecord( { id: 'existing-id', name: 'Existing Site', path: sitePath } ),
		] );

		// Fail the first reprint call (preflight) so the pull stops before any
		// runtime is wired onto the record — we only assert it got past the
		// site lookup and drove the pipeline off the resolved record.
		const migrationClientMod = await import( 'cli/lib/pull/migration-client' );
		const reprintSpy = vi
			.spyOn( migrationClientMod, 'runReprintCommandUntilComplete' )
			.mockRejectedValue( new Error( 'stop after preflight' ) );
		const logSpy = vi.spyOn( console, 'log' ).mockImplementation( () => undefined );
		vi.spyOn( console, 'error' ).mockImplementation( () => undefined );

		await expect( runCommand( sitePath, 'https://example.com', false ) ).rejects.toThrow();

		// The pipeline reached the remote (preflight is its first reprint call).
		expect( reprintSpy ).toHaveBeenCalled();
		expect( reprintSpy.mock.calls[ 0 ][ 2 ][ 0 ] ).toBe( 'preflight' );

		// Messaging is driven off the existing record's name and path.
		const logged = logSpy.mock.calls.flat().join( '\n' );
		expect( logged ).toContain( 'Pulling "Existing Site"' );
		expect( logged ).toContain( sitePath );

		// The scratch directory is keyed by siteId; no Studio-owned progress
		// file is written — resume is by derivation.
		expect( fs.existsSync( path.join( pullsRoot(), 'existing-id' ) ) ).toBe( true );
		expect( fs.existsSync( path.join( pullsRoot(), 'existing-id', 'pull.json' ) ) ).toBe( false );

		// No second site was created. The single record keeps its scratch
		// location (`technicalSiteDirectory`, recorded at pull start so `studio
		// delete` can clean it up even though this pull never reached the
		// linking step). Its status is untouched: the site is only marked
		// `pulling`/`pull-failed` once preflight succeeds and the pull starts
		// writing into the site directory, so a preflight-stage failure leaves
		// the record as it was (`ready`).
		const config = readSeededCliConfig( fakeHome );
		expect( config.sites ).toHaveLength( 1 );
		expect( config.sites[ 0 ].id ).toBe( 'existing-id' );
		expect( config.sites[ 0 ].status ).toBe( 'ready' );
		expect( config.sites[ 0 ].technicalSiteDirectory ).toBe(
			path.join( pullsRoot(), 'existing-id' )
		);
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

	it( 'runs a delta re-pull for a site that already completed a full import', async () => {
		const { runCommand } = await loadRunCommandWithFakeHome();
		mockWpComPullSource();

		const pullsRoot = path.join( fakeHome, '.studio', 'pulls' );
		// Scratch is keyed by siteId now.
		const technicalSiteDirectory = path.join( pullsRoot, 'completed-id' );
		const stateDirectory = path.join( technicalSiteDirectory, 'state' );
		const sitePath = path.join( fakeHome, 'Studio', 'My-Completed-Site' );

		// The local site is resolved by --path against the CLI config record.
		// `importComplete: true` is the durable marker that a full pull already
		// happened — it (not a pull.json stage) is what makes this a delta.
		seedCliConfigSite( fakeHome, [
			makeSiteRecord( {
				id: 'completed-id',
				name: 'My Completed Site',
				path: sitePath,
				importComplete: true,
				status: 'ready',
			} ),
		] );

		// Seed the prior pull's non-empty site directory and a cached preflight
		// response. There is no pull.json any more.
		fs.mkdirSync( stateDirectory, { recursive: true } );
		fs.mkdirSync( sitePath, { recursive: true } );
		fs.writeFileSync( path.join( sitePath, 'wp-config.php' ), '<?php // flattened output' );
		fs.writeFileSync(
			path.join( stateDirectory, 'preflight.json' ),
			JSON.stringify( { siteurl: 'https://example.com' } )
		);

		// Fail the first reprint invocation so the re-pull stops right after
		// the preflight cache is dropped — we assert on the persisted state,
		// not on a full pipeline run.
		const migrationClientMod = await import( 'cli/lib/pull/migration-client' );
		const reprintSpy = vi
			.spyOn( migrationClientMod, 'runReprintCommandUntilComplete' )
			.mockRejectedValue( new Error( 'stop after repull reset' ) );
		const logSpy = vi.spyOn( console, 'log' ).mockImplementation( () => undefined );
		vi.spyOn( console, 'error' ).mockImplementation( () => undefined );

		await expect( runCommand( sitePath, undefined, false ) ).rejects.toThrow();

		// A delta re-pull re-enters the pipeline (preflight is its first call)
		// rather than short-circuiting on the existing import.
		expect( reprintSpy ).toHaveBeenCalled();
		expect( reprintSpy.mock.calls[ 0 ][ 2 ][ 0 ] ).toBe( 'preflight' );

		const config = readSeededCliConfig( fakeHome );
		// The durable importComplete marker is preserved across the re-pull…
		expect( config.sites[ 0 ].importComplete ).toBe( true );
		// …and a preflight-stage failure leaves the site's status untouched: it
		// is only marked `pulling`/`pull-failed` once preflight succeeds and the
		// re-pull begins writing into the site directory.
		expect( config.sites[ 0 ].status ).toBe( 'ready' );

		// The cached preflight was dropped so connectivity is re-verified.
		expect( fs.existsSync( path.join( stateDirectory, 'preflight.json' ) ) ).toBe( false );

		// The non-empty site directory was not clobbered.
		expect( fs.existsSync( path.join( sitePath, 'wp-config.php' ) ) ).toBe( true );

		// The user sees delta-update messaging, not a no-op success.
		expect( logSpy.mock.calls.flat().join( '\n' ) ).toContain( 'Updating "My Completed Site"' );
	} );

	it( 'normalizes stale skipped-earlier reprint state before starting an essential-files re-pull', async () => {
		const { runCommand } = await loadRunCommandWithFakeHome();
		mockWpComPullSource();

		const pullsRoot = path.join( fakeHome, '.studio', 'pulls' );
		const technicalSiteDirectory = path.join( pullsRoot, 'stale-filter-id' );
		const stateDirectory = path.join( technicalSiteDirectory, 'state' );
		const sitePath = path.join( fakeHome, 'Studio', 'Stale-Filter-Site' );

		seedCliConfigSite( fakeHome, [
			makeSiteRecord( { id: 'stale-filter-id', name: 'Stale Filter Site', path: sitePath } ),
		] );

		fs.mkdirSync( stateDirectory, { recursive: true } );
		fs.mkdirSync( sitePath, { recursive: true } );
		fs.writeFileSync(
			path.join( technicalSiteDirectory, 'pull.json' ),
			JSON.stringify( { version: 1, stage: 'completed' } )
		);
		fs.writeFileSync(
			path.join( stateDirectory, '.import-state.json' ),
			JSON.stringify( {
				command: 'files-pull',
				status: 'in_progress',
				filter: 'skipped-earlier',
				preflight: {
					data: {
						database: {
							wp: {
								paths_urls: { content_dir: '/srv/htdocs/wp-content' },
							},
						},
					},
				},
			} )
		);
		fs.writeFileSync( path.join( stateDirectory, '.import-index.jsonl' ), '{"path":"old"}\n' );
		fs.writeFileSync(
			path.join( stateDirectory, '.import-download-list-skipped.jsonl' ),
			'{"path":"tail"}\n'
		);

		const migrationClientMod = await import( 'cli/lib/pull/migration-client' );
		const reprintSpy = vi
			.spyOn( migrationClientMod, 'runReprintCommandUntilComplete' )
			.mockImplementation( async ( _stateDir, _rawDir, args ) => {
				if ( args[ 0 ] === 'preflight' ) {
					return {
						stdout: JSON.stringify( {
							data: {
								ok: true,
								database: {
									wp: {
										siteurl: 'https://example.com',
										table_prefix: 'wp_',
									},
								},
								php: { version: '8.3' },
							},
						} ),
						stderr: '',
						exitCode: 0,
					};
				}

				if ( args[ 0 ] === 'pull' ) {
					const state = JSON.parse(
						fs.readFileSync( path.join( stateDirectory, '.import-state.json' ), 'utf-8' )
					);
					expect( state ).toMatchObject( {
						command: 'files-pull',
						status: 'complete',
						stage: null,
						filter: 'essential-files',
						preflight: {
							data: {
								database: {
									wp: {
										paths_urls: { content_dir: '/srv/htdocs/wp-content' },
									},
								},
							},
						},
					} );
					expect( fs.existsSync( path.join( stateDirectory, '.import-index.jsonl' ) ) ).toBe(
						true
					);
					throw new Error( 'stop after essential-files state normalization' );
				}

				throw new Error( `Unexpected reprint command: ${ args[ 0 ] }` );
			} );
		vi.spyOn( console, 'log' ).mockImplementation( () => undefined );
		vi.spyOn( console, 'error' ).mockImplementation( () => undefined );

		await expect( runCommand( sitePath, 'https://example.com', false ) ).rejects.toThrow(
			/stop after essential-files state normalization/
		);

		expect( reprintSpy.mock.calls.map( ( call ) => call[ 2 ][ 0 ] ) ).toEqual( [
			'preflight',
			'pull',
		] );
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
