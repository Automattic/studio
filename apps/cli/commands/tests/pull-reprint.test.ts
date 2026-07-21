import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readAuthToken } from '@studio/common/lib/shared-config';
import { SITE_RUNTIME_PLAYGROUND } from '@studio/common/lib/site-runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableReprintExporter, rotateReprintSecret } from 'cli/lib/api';
import * as migrationClient from 'cli/lib/pull/migration-client';
import { fetchSyncableSites } from 'cli/lib/sync-api';
import { pickSyncSite } from 'cli/lib/sync-site-picker';
import {
	runFullPull,
	downloadSkippedFiles,
	ensureScopedPullWpConfig,
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

	it( 'invokes reprint to download skipped-earlier files', async () => {
		const technicalSiteDirectory = fs.mkdtempSync(
			path.join( os.tmpdir(), 'studio-import-skipped-' )
		);
		const stateDirectory = path.join( technicalSiteDirectory, 'state' );
		const rawDirectory = path.join( technicalSiteDirectory, 'raw' );
		fs.mkdirSync( stateDirectory, { recursive: true } );
		fs.mkdirSync( rawDirectory, { recursive: true } );

		// State as pull-db's prepare_repull leaves it: the skipped_pending
		// flag pull-files set has been reset, though deferred files remain.
		fs.writeFileSync(
			path.join( stateDirectory, '.import-state.json' ),
			JSON.stringify( {
				filter: 'essential-files',
				pull_pipeline: { started_by_command: 'pull-db', skipped_pending: false },
			} )
		);

		const reprintSpy = vi
			.spyOn( migrationClient, 'runReprintCommandUntilComplete' )
			.mockResolvedValue( {
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

		expect( reprintSpy.mock.calls[ 0 ][ 2 ] ).toEqual(
			expect.arrayContaining( [ 'files-sync', '--filter=skipped-earlier' ] )
		);

		// The tail restored the flag its recovery keys on, preserving the
		// rest of the state file.
		const state = JSON.parse(
			fs.readFileSync( path.join( stateDirectory, '.import-state.json' ), 'utf-8' )
		);
		expect( state.pull_pipeline.skipped_pending ).toBe( true );
		expect( state.pull_pipeline.started_by_command ).toBe( 'pull-db' );
		expect( state.filter ).toBe( 'essential-files' );

		fs.rmSync( technicalSiteDirectory, { recursive: true, force: true } );
	} );

	it( 'synthesizes a wp-config when a scoped pull left only an empty symlink target', () => {
		const technicalSiteDirectory = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-wpconfig-' ) );
		const stateDirectory = path.join( technicalSiteDirectory, 'state' );
		const rawDirectory = path.join( technicalSiteDirectory, 'raw' );
		const rawAbspath = path.join( rawDirectory, 'wordpress', 'core', '7.0' );
		fs.mkdirSync( stateDirectory, { recursive: true } );
		fs.mkdirSync( rawAbspath, { recursive: true } );
		fs.mkdirSync( path.join( rawDirectory, 'srv', 'htdocs' ), { recursive: true } );

		fs.writeFileSync(
			path.join( stateDirectory, '.import-state.json' ),
			JSON.stringify( {
				preflight: {
					data: {
						database: {
							wp: {
								table_prefix: 'wp_abc123_',
								paths_urls: { abspath: '/wordpress/core/7.0' },
							},
						},
					},
				},
			} )
		);

		// The WP Cloud layout a scoped pull recreates: parent-of-ABSPATH
		// wp-config.php is a symlink to a document-root file that was never
		// fetched (empty placeholder).
		fs.writeFileSync( path.join( rawDirectory, 'srv', 'htdocs', 'wp-config.php' ), '' );
		fs.symlinkSync(
			'../../srv/htdocs/wp-config.php',
			path.join( rawDirectory, 'wordpress', 'core', 'wp-config.php' )
		);

		const metadata = { stateDirectory, rawDirectory } as never;
		ensureScopedPullWpConfig( metadata );

		// Written through the symlink into its target, with the remote prefix.
		const written = fs.readFileSync(
			path.join( rawDirectory, 'srv', 'htdocs', 'wp-config.php' ),
			'utf-8'
		);
		expect( written ).toContain( "$table_prefix = 'wp_abc123_';" );
		expect( written ).toContain( "require_once ABSPATH . 'wp-settings.php';" );

		// A non-empty config is left alone on a second run.
		fs.writeFileSync(
			path.join( rawDirectory, 'srv', 'htdocs', 'wp-config.php' ),
			'<?php // real remote config'
		);
		ensureScopedPullWpConfig( metadata );
		expect(
			fs.readFileSync( path.join( rawDirectory, 'srv', 'htdocs', 'wp-config.php' ), 'utf-8' )
		).toBe( '<?php // real remote config' );

		fs.rmSync( technicalSiteDirectory, { recursive: true, force: true } );
	} );

	it( 'escapes backslashes and quotes when writing the table prefix', () => {
		const technicalSiteDirectory = fs.mkdtempSync(
			path.join( os.tmpdir(), 'studio-wpconfig-esc-' )
		);
		const stateDirectory = path.join( technicalSiteDirectory, 'state' );
		const rawDirectory = path.join( technicalSiteDirectory, 'raw' );
		fs.mkdirSync( stateDirectory, { recursive: true } );
		fs.mkdirSync( path.join( rawDirectory, 'wordpress', 'core', '7.0' ), { recursive: true } );

		fs.writeFileSync(
			path.join( stateDirectory, '.import-state.json' ),
			JSON.stringify( {
				preflight: {
					data: {
						database: {
							wp: {
								table_prefix: "wp\\x'_",
								paths_urls: { abspath: '/wordpress/core/7.0' },
							},
						},
					},
				},
			} )
		);

		ensureScopedPullWpConfig( { stateDirectory, rawDirectory } as never );

		// With no config at either candidate, it writes to the parent-of-ABSPATH
		// location wp-load falls back to.
		const written = fs.readFileSync(
			path.join( rawDirectory, 'wordpress', 'core', 'wp-config.php' ),
			'utf-8'
		);
		// Backslash doubled, quote escaped — a valid PHP single-quoted literal.
		expect( written ).toContain( "$table_prefix = 'wp\\\\x\\'_';" );

		fs.rmSync( technicalSiteDirectory, { recursive: true, force: true } );
	} );
} );

describe( 'CLI: studio pull-reprint single pull phase', () => {
	afterEach( () => {
		vi.restoreAllMocks();
	} );

	it( 'runs pull-files → pull-db → flat-docroot → apply-runtime with the sqlite target and mounts', async () => {
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

		// The pipeline runs as separate commands so the selection can skip steps.
		expect( reprint ).toHaveBeenCalledTimes( 4 );
		const commands = reprint.mock.calls.map( ( call ) => ( call[ 2 ] as string[] )[ 0 ] );
		expect( commands ).toEqual( [ 'pull-files', 'pull-db', 'flat-docroot', 'apply-runtime' ] );

		const [ filesArgs, dbArgs, flattenArgs, runtimeArgs ] = reprint.mock.calls.map(
			( call ) => call[ 2 ] as string[]
		);
		expect( filesArgs ).toEqual( [
			'pull-files',
			'https://example.com/?reprint-api',
			'--secret=hmac-secret',
			'--filter=essential-files',
			'--no-adaptive',
			`--state-dir=${ stateDirectory }`,
			`--fs-root=${ rawDirectory }`,
		] );
		expect( dbArgs ).toEqual( [
			'pull-db',
			'https://example.com/?reprint-api',
			'--secret=hmac-secret',
			'--target-engine=sqlite',
			`--target-sqlite-path=${ path.join(
				rawDirectory,
				'srv',
				'htdocs',
				'wp-content',
				'database',
				'.ht.sqlite'
			) }`,
			'--new-site-url=http://localhost:8881',
			'--no-adaptive',
			`--state-dir=${ stateDirectory }`,
			`--fs-root=${ rawDirectory }`,
		] );
		// Local flatten: `-` URL placeholder; --force only on a first pull
		// (this call passed force=true) to overwrite the blank install.
		// --preserve-local-content goes on every pull so wp-content is merged
		// rather than replaced and locally installed files survive.
		expect( flattenArgs ).toEqual( [
			'flat-docroot',
			'-',
			`--flatten-to=${ sitePath }`,
			'--preserve-local-content',
			'--force',
			`--state-dir=${ stateDirectory }`,
			`--fs-root=${ rawDirectory }`,
		] );
		// apply-runtime takes no URL positional; --flat-document-root replaces --fs-root.
		expect( runtimeArgs ).toEqual( [
			'apply-runtime',
			'--runtime=playground-cli',
			`--output-dir=${ runtimeDirectory }`,
			`--flat-document-root=${ sitePath }`,
			`--state-dir=${ stateDirectory }`,
		] );

		// Every step mounts the flattened site and runtime output dirs so the
		// forks can write them to the host filesystem.
		for ( const call of reprint.mock.calls ) {
			expect( ( call[ 4 ] as { mounts?: unknown } )?.mounts ).toEqual( [
				{ hostPath: sitePath, vfsPath: sitePath },
				{ hostPath: runtimeDirectory, vfsPath: runtimeDirectory },
			] );
		}

		// No Studio-owned progress file is written: resume is by derivation
		// (reprint's own `.import-state.json` + the site's `status`), so the
		// pull is always re-invoked rather than skipped via a stage cursor.
		expect( fs.existsSync( path.join( technicalSiteDirectory, 'pull.json' ) ) ).toBe( false );

		fs.rmSync( technicalSiteDirectory, { recursive: true, force: true } );
	} );

	it( 'skips pull-db entirely and omits --force on a delta re-pull with the database excluded', async () => {
		const technicalSiteDirectory = fs.mkdtempSync(
			path.join( os.tmpdir(), 'studio-import-pull-nodb-' )
		);
		const stateDirectory = path.join( technicalSiteDirectory, 'state' );
		const rawDirectory = path.join( technicalSiteDirectory, 'raw' );
		fs.mkdirSync( stateDirectory, { recursive: true } );
		fs.mkdirSync( rawDirectory, { recursive: true } );
		fs.writeFileSync(
			path.join( stateDirectory, '.import-state.json' ),
			JSON.stringify( { preflight: { data: {} } } )
		);

		const reprint = vi
			.spyOn( migrationClient, 'runReprintCommandUntilComplete' )
			.mockResolvedValue( { stdout: '{"ok":true}', stderr: '', exitCode: 0 } );

		await runFullPull(
			SITE_RUNTIME_PLAYGROUND,
			{
				sitePath: path.join( technicalSiteDirectory, 'site' ),
				technicalSiteDirectory,
				rawDirectory,
				stateDirectory,
				runtimeDirectory: path.join( technicalSiteDirectory, 'runtime' ),
				runtimeBlueprintPath: path.join( technicalSiteDirectory, 'runtime', 'blueprint.json' ),
				localUrl: 'http://localhost:8881',
			} as never,
			'https://example.com/?reprint-api',
			'hmac-secret',
			false,
			false,
			{ skipDatabase: true }
		);

		const commands = reprint.mock.calls.map( ( call ) => ( call[ 2 ] as string[] )[ 0 ] );
		expect( commands ).toEqual( [ 'pull-files', 'flat-docroot', 'apply-runtime' ] );
		const flattenArgs = reprint.mock.calls[ 1 ][ 2 ] as string[];
		expect( flattenArgs ).not.toContain( '--force' );
		// Once merged, wp-content is a real directory; a delta pull without
		// the flag would fail trying to symlink over it.
		expect( flattenArgs ).toContain( '--preserve-local-content' );

		fs.rmSync( technicalSiteDirectory, { recursive: true, force: true } );
	} );

	it( 'threads --only into pull-files for a folder-restricted pull', async () => {
		const technicalSiteDirectory = fs.mkdtempSync(
			path.join( os.tmpdir(), 'studio-import-pull-only-' )
		);
		const stateDirectory = path.join( technicalSiteDirectory, 'state' );
		const rawDirectory = path.join( technicalSiteDirectory, 'raw' );
		fs.mkdirSync( stateDirectory, { recursive: true } );
		fs.mkdirSync( rawDirectory, { recursive: true } );
		fs.writeFileSync(
			path.join( stateDirectory, '.import-state.json' ),
			JSON.stringify( { preflight: { data: {} } } )
		);

		const reprint = vi
			.spyOn( migrationClient, 'runReprintCommandUntilComplete' )
			.mockResolvedValue( { stdout: '{"ok":true}', stderr: '', exitCode: 0 } );

		await runFullPull(
			SITE_RUNTIME_PLAYGROUND,
			{
				sitePath: path.join( technicalSiteDirectory, 'site' ),
				technicalSiteDirectory,
				rawDirectory,
				stateDirectory,
				runtimeDirectory: path.join( technicalSiteDirectory, 'runtime' ),
				runtimeBlueprintPath: path.join( technicalSiteDirectory, 'runtime', 'blueprint.json' ),
				localUrl: 'http://localhost:8881',
			} as never,
			'https://example.com/?reprint-api',
			'hmac-secret',
			false,
			false,
			{ fileOnlyPaths: [ ':wp-plugins:', '/srv/htdocs/wp-content/plugins/akismet' ] }
		);

		const filesArgs = reprint.mock.calls[ 0 ][ 2 ] as string[];
		expect( filesArgs[ 0 ] ).toBe( 'pull-files' );
		expect( filesArgs ).toContain( '--only=:wp-plugins:' );
		expect( filesArgs ).toContain( '--only=/srv/htdocs/wp-content/plugins/akismet' );
		// The database step still runs (only files were restricted).
		const commands = reprint.mock.calls.map( ( call ) => ( call[ 2 ] as string[] )[ 0 ] );
		expect( commands ).toContain( 'pull-db' );

		fs.rmSync( technicalSiteDirectory, { recursive: true, force: true } );
	} );

	it( 'clears a damaged raw scratch (non-empty, no local index) before pulling', async () => {
		const technicalSiteDirectory = fs.mkdtempSync(
			path.join( os.tmpdir(), 'studio-import-pull-damaged-' )
		);
		const stateDirectory = path.join( technicalSiteDirectory, 'state' );
		const rawDirectory = path.join( technicalSiteDirectory, 'raw' );
		fs.mkdirSync( stateDirectory, { recursive: true } );
		fs.mkdirSync( rawDirectory, { recursive: true } );
		fs.writeFileSync(
			path.join( stateDirectory, '.import-state.json' ),
			JSON.stringify( { command: 'files-pull', status: 'complete', preflight: { data: {} } } )
		);
		// Damage: raw holds leftovers but the local index is gone.
		fs.writeFileSync( path.join( rawDirectory, 'stale-blocker' ), 'junk' );
		fs.writeFileSync( path.join( stateDirectory, '.import-remote-index.jsonl' ), '{"p":1}\n' );

		const reprint = vi
			.spyOn( migrationClient, 'runReprintCommandUntilComplete' )
			.mockResolvedValue( { stdout: '{"ok":true}', stderr: '', exitCode: 0 } );

		await runFullPull(
			SITE_RUNTIME_PLAYGROUND,
			{
				sitePath: path.join( technicalSiteDirectory, 'site' ),
				technicalSiteDirectory,
				rawDirectory,
				stateDirectory,
				runtimeDirectory: path.join( technicalSiteDirectory, 'runtime' ),
				runtimeBlueprintPath: path.join( technicalSiteDirectory, 'runtime', 'blueprint.json' ),
				localUrl: 'http://localhost:8881',
			} as never,
			'https://example.com/?reprint-api',
			'hmac-secret',
			false,
			true
		);

		// The scratch was wiped for a clean initial sync: raw is empty, the
		// stale derived indexes are gone, and only preflight survives in state.
		expect( fs.readdirSync( rawDirectory ) ).toEqual( [] );
		expect( fs.existsSync( path.join( stateDirectory, '.import-remote-index.jsonl' ) ) ).toBe(
			false
		);
		expect(
			JSON.parse( fs.readFileSync( path.join( stateDirectory, '.import-state.json' ), 'utf-8' ) )
		).toEqual( { preflight: { data: {} } } );
		// The pull still ran, in default mode (no preserve-local escape hatch).
		const filesArgs = reprint.mock.calls[ 0 ][ 2 ] as string[];
		expect( filesArgs[ 0 ] ).toBe( 'pull-files' );
		expect( filesArgs.some( ( a ) => a.includes( 'preserve-local' ) ) ).toBe( false );

		fs.rmSync( technicalSiteDirectory, { recursive: true, force: true } );
	} );

	it( 'keeps an intact raw scratch (local index present) for a delta pull', async () => {
		const technicalSiteDirectory = fs.mkdtempSync(
			path.join( os.tmpdir(), 'studio-import-pull-delta-' )
		);
		const stateDirectory = path.join( technicalSiteDirectory, 'state' );
		const rawDirectory = path.join( technicalSiteDirectory, 'raw' );
		fs.mkdirSync( stateDirectory, { recursive: true } );
		fs.mkdirSync( rawDirectory, { recursive: true } );
		fs.writeFileSync(
			path.join( stateDirectory, '.import-state.json' ),
			JSON.stringify( { preflight: { data: {} } } )
		);
		fs.writeFileSync( path.join( stateDirectory, '.import-index.jsonl' ), '{"path":"a"}\n' );
		fs.writeFileSync( path.join( rawDirectory, 'existing-file' ), 'keep me' );

		vi.spyOn( migrationClient, 'runReprintCommandUntilComplete' ).mockResolvedValue( {
			stdout: '{"ok":true}',
			stderr: '',
			exitCode: 0,
		} );

		await runFullPull(
			SITE_RUNTIME_PLAYGROUND,
			{
				sitePath: path.join( technicalSiteDirectory, 'site' ),
				technicalSiteDirectory,
				rawDirectory,
				stateDirectory,
				runtimeDirectory: path.join( technicalSiteDirectory, 'runtime' ),
				runtimeBlueprintPath: path.join( technicalSiteDirectory, 'runtime', 'blueprint.json' ),
				localUrl: 'http://localhost:8881',
			} as never,
			'https://example.com/?reprint-api',
			'hmac-secret',
			false,
			false
		);

		expect( fs.readFileSync( path.join( rawDirectory, 'existing-file' ), 'utf-8' ) ).toBe(
			'keep me'
		);
		expect( fs.existsSync( path.join( stateDirectory, '.import-index.jsonl' ) ) ).toBe( true );

		fs.rmSync( technicalSiteDirectory, { recursive: true, force: true } );
	} );

	it( 'ignores the selection sidecar unless the resolved selection is passed in', async () => {
		const technicalSiteDirectory = fs.mkdtempSync(
			path.join( os.tmpdir(), 'studio-import-pull-sidecar-' )
		);
		const stateDirectory = path.join( technicalSiteDirectory, 'state' );
		const rawDirectory = path.join( technicalSiteDirectory, 'raw' );
		fs.mkdirSync( stateDirectory, { recursive: true } );
		fs.mkdirSync( rawDirectory, { recursive: true } );
		fs.writeFileSync(
			path.join( stateDirectory, '.import-state.json' ),
			JSON.stringify( { preflight: { data: {} } } )
		);
		// Selection captured in the sidecar, but the pull must ignore it for now.
		fs.writeFileSync(
			path.join( stateDirectory, 'selection.json' ),
			JSON.stringify( {
				skipDatabase: true,
				skipUploads: true,
				fileOnlyPaths: [ ':wp-plugins:', '/srv/htdocs/wp-content/plugins/akismet' ],
			} )
		);

		const reprint = vi
			.spyOn( migrationClient, 'runReprintCommandUntilComplete' )
			.mockResolvedValue( { stdout: '{"ok":true}', stderr: '', exitCode: 0 } );

		await runFullPull(
			SITE_RUNTIME_PLAYGROUND,
			{
				sitePath: path.join( technicalSiteDirectory, 'site' ),
				technicalSiteDirectory,
				rawDirectory,
				stateDirectory,
				runtimeDirectory: path.join( technicalSiteDirectory, 'runtime' ),
				runtimeBlueprintPath: path.join( technicalSiteDirectory, 'runtime', 'blueprint.json' ),
				localUrl: 'http://localhost:8881',
			} as never,
			'https://example.com/?reprint-api',
			'hmac-secret',
			false,
			true
		);

		const passedArgs = reprint.mock.calls[ 0 ][ 2 ] as string[];
		expect( passedArgs ).not.toContain( '--no-db' );
		expect( passedArgs.some( ( a ) => a.startsWith( '--only' ) ) ).toBe( false );

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

		// With no content dir from preflight, the sqlite target (on the
		// pull-db step) falls back to the flattened site's wp-content.
		const dbArgs = reprint.mock.calls[ 1 ][ 2 ] as string[];
		expect( dbArgs[ 0 ] ).toBe( 'pull-db' );
		expect( dbArgs ).toContain(
			`--target-sqlite-path=${ path.join( sitePath, 'wp-content', 'database', '.ht.sqlite' ) }`
		);
		// A delta re-pull (force=false) omits --force on the flatten step.
		const flattenArgs = reprint.mock.calls[ 2 ][ 2 ] as string[];
		expect( flattenArgs ).not.toContain( '--force' );
		// The site + runtime dirs are always mounted for every fork.
		const dbOptions = reprint.mock.calls[ 1 ][ 4 ] as { mounts?: unknown };
		expect( dbOptions?.mounts ).toEqual( [
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

	it( 'rejects a needs-transfer site passed via --url with the hosting-features message', async () => {
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
			/hosting features to be enabled.*hosting-features\/44/
		);
		expect( rotateReprintSecret ).not.toHaveBeenCalled();
	} );

	it( 'rejects a needs-upgrade site passed via --url with the plan-upgrade message', async () => {
		setTTY( true );
		vi.mocked( fetchSyncableSites ).mockResolvedValue( [
			syncSite( {
				id: 55,
				name: 'Free',
				url: 'https://free.example.com',
				syncSupport: 'needs-upgrade',
			} ),
		] );

		await expect( resolveSourceSite( 'https://free.example.com' ) ).rejects.toThrow(
			/plan with hosting features.*plans\/55/
		);
		expect( rotateReprintSecret ).not.toHaveBeenCalled();
	} );

	it( 'reports the specific reason when the only site is not pullable (no --url)', async () => {
		setTTY( true );
		vi.mocked( fetchSyncableSites ).mockResolvedValue( [
			syncSite( {
				id: 66,
				name: 'Simple',
				url: 'https://lone-simple.example.com',
				syncSupport: 'needs-transfer',
			} ),
		] );

		await expect( resolveSourceSite() ).rejects.toThrow(
			/hosting features to be enabled.*hosting-features\/66/
		);
		expect( pickSyncSite ).not.toHaveBeenCalled();
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

	it( 'runs an essential-files reprint pull for a completed site without forcing', async () => {
		const { runCommand } = await loadRunCommandWithFakeHome();
		mockWpComPullSource();

		const sitePath = path.join( fakeHome, 'Studio', 'Stale-Filter-Site' );

		seedCliConfigSite( fakeHome, [
			makeSiteRecord( {
				id: 'stale-filter-id',
				name: 'Stale Filter Site',
				path: sitePath,
				importComplete: true,
				status: 'ready',
			} ),
		] );

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

				if ( args[ 0 ] === 'pull-files' ) {
					expect( args ).toEqual( expect.arrayContaining( [ '--filter=essential-files' ] ) );
					throw new Error( 'stop after essential-files pull invocation' );
				}

				throw new Error( `Unexpected reprint command: ${ args[ 0 ] }` );
			} );
		vi.spyOn( console, 'log' ).mockImplementation( () => undefined );
		vi.spyOn( console, 'error' ).mockImplementation( () => undefined );

		await expect( runCommand( sitePath, 'https://example.com', false ) ).rejects.toThrow(
			/stop after essential-files pull invocation/
		);

		expect( reprintSpy.mock.calls.map( ( call ) => call[ 2 ][ 0 ] ) ).toEqual( [
			'preflight',
			'pull-files',
		] );
	} );
} );

describe( 'CLI: studio pull-reprint first-pull selective sync', () => {
	let fakeHome: string;

	afterEach( () => {
		vi.restoreAllMocks();
		vi.resetModules();
		if ( fakeHome ) {
			fs.rmSync( fakeHome, { recursive: true, force: true } );
		}
	} );

	async function loadRunCommandWithFakeHome() {
		fakeHome = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-pull-first-selective-' ) );

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

	it( 'accepts --only/--skip-database on a first pull, adds core roots, and preserves unselected local content', async () => {
		const { runCommand } = await loadRunCommandWithFakeHome();
		mockWpComPullSource();

		const pullsRoot = path.join( fakeHome, '.studio', 'pulls' );
		const technicalSiteDirectory = path.join( pullsRoot, 'fresh-id' );
		const stateDirectory = path.join( technicalSiteDirectory, 'state' );
		const rawDirectory = path.join( technicalSiteDirectory, 'raw' );
		const sitePath = path.join( fakeHome, 'Studio', 'My-Fresh-Site' );

		seedCliConfigSite( fakeHome, [
			makeSiteRecord( {
				id: 'fresh-id',
				name: 'My Fresh Site',
				path: sitePath,
				status: 'ready',
			} ),
		] );

		// The `studio create` install this first pull runs against: a real
		// wp-content with local changes plus the SQLite database.
		fs.mkdirSync( path.join( sitePath, 'wp-content', 'plugins', 'local-plugin' ), {
			recursive: true,
		} );
		fs.writeFileSync(
			path.join( sitePath, 'wp-content', 'plugins', 'local-plugin', 'plugin.php' ),
			'<?php // local'
		);
		fs.mkdirSync( path.join( sitePath, 'wp-content', 'database' ), { recursive: true } );
		fs.writeFileSync( path.join( sitePath, 'wp-content', 'database', '.ht.sqlite' ), 'local-db' );

		// Preflight data (content dir + core roots) as the real preflight
		// stage would have persisted it into reprint's state file.
		fs.mkdirSync( stateDirectory, { recursive: true } );
		fs.writeFileSync(
			path.join( stateDirectory, '.import-state.json' ),
			JSON.stringify( {
				preflight: {
					data: {
						database: {
							wp: { paths_urls: { content_dir: '/srv/htdocs/wp-content' } },
						},
						wp_detect: {
							roots: [ { path: '/wordpress/core/7.0' }, { path: '/wordpress/core' } ],
						},
					},
				},
			} )
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
								database: { wp: { siteurl: 'https://example.com', table_prefix: 'wp_' } },
								php: { version: '8.3' },
							},
						} ),
						stderr: '',
						exitCode: 0,
					};
				}
				if ( args[ 0 ] === 'files-index' ) {
					const stateDirArg = args
						.find( ( arg ) => arg.startsWith( '--state-dir=' ) )!
						.slice( '--state-dir='.length );
					const encode = ( value: string ) => Buffer.from( value, 'utf-8' ).toString( 'base64' );
					fs.writeFileSync(
						path.join( stateDirArg, '.import-remote-index.jsonl' ),
						[
							JSON.stringify( {
								path: encode( '/srv/htdocs/wp-content/themes/some-theme/style.css' ),
								type: 'file',
							} ),
							JSON.stringify( {
								path: encode( '/srv/htdocs/wp-content/plugins/jetpack' ),
								type: 'link',
								target: encode( '/wordpress/plugins/jetpack/16.0' ),
							} ),
							JSON.stringify( {
								path: encode( '/wordpress/plugins/jetpack/16.0/jetpack.php' ),
								type: 'file',
							} ),
						].join( '\n' )
					);
					return { stdout: '{"status":"complete"}', stderr: '', exitCode: 0 };
				}
				if ( args[ 0 ] === 'pull-files' ) {
					return { stdout: '{"ok":true}', stderr: '', exitCode: 0 };
				}
				if ( args[ 0 ] === 'flat-docroot' ) {
					// Preservation runs before flattening: the unselected local
					// plugin and the kept database are in the scratch by now.
					const rawContent = path.join( rawDirectory, 'srv', 'htdocs', 'wp-content' );
					expect(
						fs.readFileSync(
							path.join( rawContent, 'plugins', 'local-plugin', 'plugin.php' ),
							'utf-8'
						)
					).toBe( '<?php // local' );
					expect(
						fs.readFileSync( path.join( rawContent, 'database', '.ht.sqlite' ), 'utf-8' )
					).toBe( 'local-db' );
					throw new Error( 'stop after flat-docroot preservation checks' );
				}
				throw new Error( `Unexpected reprint command: ${ args[ 0 ] }` );
			} );
		vi.spyOn( console, 'log' ).mockImplementation( () => undefined );
		vi.spyOn( console, 'error' ).mockImplementation( () => undefined );

		await expect(
			runCommand( sitePath, 'https://example.com', false, {
				only: [ 'themes', 'plugins/jetpack' ],
				skipDatabase: true,
			} )
		).rejects.toThrow( /stop after flat-docroot preservation checks/ );

		// No pull-db: the database was skipped. files-index resolved the
		// remote symlinks for the selection.
		expect( reprintSpy.mock.calls.map( ( call ) => call[ 2 ][ 0 ] ) ).toEqual( [
			'preflight',
			'files-index',
			'pull-files',
			'flat-docroot',
		] );

		// The include-list carries the live core root (the ancestor root
		// holding other core versions is dropped) plus the selection.
		const filesArgs = reprintSpy.mock.calls[ 2 ][ 2 ] as string[];
		expect( filesArgs ).toContain( '--only=/wordpress/core/7.0' );
		expect( filesArgs ).not.toContain( '--only=/wordpress/core' );
		expect( filesArgs ).toContain( '--only=/srv/htdocs/wp-content/themes' );
		expect( filesArgs ).toContain( '--only=/srv/htdocs/wp-content/plugins/jetpack' );

		// The selected remote symlink was recreated in the scratch, pointing
		// at its pulled target.
		const rawLink = path.join( rawDirectory, 'srv', 'htdocs', 'wp-content', 'plugins', 'jetpack' );
		expect( fs.lstatSync( rawLink ).isSymbolicLink() ).toBe( true );
		expect( fs.readlinkSync( rawLink ) ).toBe(
			path.join( '..', '..', '..', '..', 'wordpress', 'plugins', 'jetpack', '16.0' )
		);

		// The persisted sidecar records the healed selection a resume reuses.
		const sidecar = JSON.parse(
			fs.readFileSync( path.join( stateDirectory, 'selection.json' ), 'utf-8' )
		);
		expect( sidecar.fileOnlyPaths ).toEqual( [
			'/wordpress/core/7.0',
			'/srv/htdocs/wp-content/themes',
			'/srv/htdocs/wp-content/plugins/jetpack',
		] );
		expect( sidecar.symlinkPaths ).toEqual( [
			{
				path: '/srv/htdocs/wp-content/plugins/jetpack',
				target: '/wordpress/plugins/jetpack/16.0',
			},
		] );
		expect( sidecar.skipDatabase ).toBe( true );
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
