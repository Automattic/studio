import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readAuthToken } from '@studio/common/lib/shared-config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as reprintClient from 'cli/lib/pull/reprint-client';
import { emptyReprintMetadata } from 'cli/lib/pull/reprint-metadata';
import { fetchSyncableSites } from 'cli/lib/sync-api';
import { runFullPull } from '../pull';
import type { SyncSite } from '@studio/common/types/sync';

// This file contains integration-style tests that reload the CLI module graph
// and perform multiple atomic config writes. Those can exceed the default
// timeout on CI.
vi.setConfig( { testTimeout: 15_000 } );

vi.mock( '@studio/common/lib/shared-config', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('@studio/common/lib/shared-config') >() ),
	readAuthToken: vi.fn(),
} ) );
vi.mock( 'cli/lib/pull/reprint-key', () => ( {
	ensureReprintKey: vi.fn(),
} ) );
vi.mock( 'cli/lib/sync-api', async ( importOriginal ) => {
	const actual = await importOriginal< typeof import('cli/lib/sync-api') >();
	return {
		...actual,
		fetchSyncableSites: vi.fn(),
		wpcomSites: {
			...actual.wpcomSites,
			pull: {
				...actual.wpcomSites.pull,
				openExporter: vi.fn( async ( _config: unknown, { url }: { url: string } ) => ( {
					apiUrl: `${ url }?reprint-api-jetpack`,
					hasKey: true,
				} ) ),
			},
		},
	};
} );

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

describe( 'CLI: studio pull single pull phase', () => {
	afterEach( () => {
		vi.restoreAllMocks();
	} );

	it( 'runs pull-files → pull-db → merge-wp-content → flat-docroot → apply-runtime with the sqlite target', async () => {
		const technicalSiteDirectory = fs.mkdtempSync(
			path.join( os.tmpdir(), 'studio-import-pull-' )
		);
		const stateDirectory = path.join( technicalSiteDirectory, 'state' );
		const rawDirectory = path.join( technicalSiteDirectory, 'raw' );
		const sitePath = path.join( technicalSiteDirectory, 'site' );
		const runtimeDirectory = path.join( technicalSiteDirectory, 'runtime' );
		fs.mkdirSync( stateDirectory, { recursive: true } );
		fs.mkdirSync( rawDirectory, { recursive: true } );

		const reprint = vi
			.spyOn( reprintClient, 'runReprintCommandUntilComplete' )
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
			metadata,
			'https://example.com/?reprint-api-jetpack',
			false,
			true,
			{},
			{
				...emptyReprintMetadata,
				sourceSite: {
					...emptyReprintMetadata.sourceSite,
					contentDirectory: '/srv/htdocs/wp-content',
				},
			}
		);

		// The pipeline runs as separate commands so the selection can skip steps.
		expect( reprint ).toHaveBeenCalledTimes( 5 );
		const commands = reprint.mock.calls.map( ( call ) => ( call[ 0 ] as string[] )[ 0 ] );
		expect( commands ).toEqual( [
			'pull-files',
			'pull-db',
			'merge-wp-content',
			'flat-docroot',
			'apply-runtime',
		] );

		const [ filesArgs, dbArgs, mergeArgs, flattenArgs, runtimeArgs ] = reprint.mock.calls.map(
			( call ) => call[ 0 ] as string[]
		);
		// wp-content and only the WordPress core the remote runs.
		expect( filesArgs ).toEqual( [
			'pull-files',
			'https://example.com/?reprint-api-jetpack',
			'--include=:wp-content:',
			'--include=:wp-core:',
			'--mode=mirror',
			'--no-adaptive',
			`--state-dir=${ stateDirectory }`,
			`--fs-root=${ rawDirectory }`,
		] );
		expect( dbArgs ).toEqual( [
			'pull-db',
			'https://example.com/?reprint-api-jetpack',
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
		// The merge runs on a first pull (this call passed isFirstPull=true)
		// and names the local wp-content directory itself. It comes after
		// pull-files, whose local index Reprint reads as the record of a
		// finished file pull, and before the flatten which would delete what
		// only the blank install has.
		expect( mergeArgs ).toEqual( [
			'merge-wp-content',
			'https://example.com/?reprint-api-jetpack',
			`--from=${ path.join( sitePath, 'wp-content' ) }`,
			`--state-dir=${ stateDirectory }`,
			`--fs-root=${ rawDirectory }`,
		] );
		// The remote URL selects Reprint's pull state; core is copied into the
		// site; --force only on a first pull, so the blank install is replaced
		// but a live site never is.
		expect( flattenArgs ).toEqual( [
			'flat-docroot',
			'https://example.com/?reprint-api-jetpack',
			`--flatten-to=${ sitePath }`,
			'--core-files=copy',
			'--force',
			`--state-dir=${ stateDirectory }`,
			`--fs-root=${ rawDirectory }`,
		] );
		// The remote URL selects Reprint's pull state; --flat-document-root replaces --fs-root.
		expect( runtimeArgs ).toEqual( [
			'apply-runtime',
			'https://example.com/?reprint-api-jetpack',
			'--runtime=nginx-fpm',
			'--target-engine=sqlite',
			`--target-sqlite-path=${ path.join(
				rawDirectory,
				'srv',
				'htdocs',
				'wp-content',
				'database',
				'.ht.sqlite'
			) }`,
			`--output-dir=${ runtimeDirectory }`,
			`--flat-document-root=${ sitePath }`,
			`--state-dir=${ stateDirectory }`,
		] );

		for ( const call of reprint.mock.calls ) {
			expect( call[ 2 ] ).toEqual( {
				progressLabel: expect.any( String ),
				verboseCommands: false,
			} );
		}

		// No Studio-owned progress file is written: resume is by derivation
		// (reprint's own `.import-state.json` + the site's `status`), so the
		// pull is always re-invoked rather than skipped via a stage cursor.
		expect( fs.existsSync( path.join( technicalSiteDirectory, 'pull.json' ) ) ).toBe( false );

		fs.rmSync( technicalSiteDirectory, { recursive: true, force: true } );
	} );

	it( 'uses an existing legacy sqlite path when the database is excluded', async () => {
		const technicalSiteDirectory = fs.mkdtempSync(
			path.join( os.tmpdir(), 'studio-import-pull-nodb-' )
		);
		const stateDirectory = path.join( technicalSiteDirectory, 'state' );
		const rawDirectory = path.join( technicalSiteDirectory, 'raw' );
		const sitePath = path.join( technicalSiteDirectory, 'site' );
		fs.mkdirSync( stateDirectory, { recursive: true } );
		fs.mkdirSync( rawDirectory, { recursive: true } );
		fs.writeFileSync(
			path.join( stateDirectory, '.import-state.json' ),
			JSON.stringify( {
				preflight: {
					data: {
						database: {
							wp: { paths_urls: { content_dir: '/srv/htdocs/wp-content' } },
						},
					},
				},
			} )
		);
		fs.writeFileSync( path.join( stateDirectory, '.import-index.jsonl' ), '{"path":"a"}\n' );
		const legacySqlitePath = path.join( rawDirectory, 'wp-content', 'database', '.ht.sqlite' );
		fs.mkdirSync( path.dirname( legacySqlitePath ), { recursive: true } );
		fs.writeFileSync( legacySqlitePath, 'local database' );

		// A mirror deletes the local files the remote doesn't have, the local database among them.
		const reprint = vi
			.spyOn( reprintClient, 'runReprintCommandUntilComplete' )
			.mockImplementation( async ( args ) => {
				if ( args[ 0 ] === 'pull-files' ) {
					fs.rmSync( path.dirname( legacySqlitePath ), { recursive: true, force: true } );
				}
				return { stdout: '{"ok":true}', stderr: '', exitCode: 0 };
			} );

		await runFullPull(
			{
				sitePath,
				technicalSiteDirectory,
				rawDirectory,
				stateDirectory,
				runtimeDirectory: path.join( technicalSiteDirectory, 'runtime' ),
				runtimeBlueprintPath: path.join( technicalSiteDirectory, 'runtime', 'blueprint.json' ),
				localUrl: 'http://localhost:8881',
			} as never,
			'https://example.com/?reprint-api-jetpack',
			false,
			false,
			{ skipDatabase: true }
		);

		const commands = reprint.mock.calls.map( ( call ) => ( call[ 0 ] as string[] )[ 0 ] );
		// A delta re-pull neither merges nor forces: the site's wp-content is
		// already a symlink into the fs-root, and a live site must not be
		// replaced.
		expect( commands ).toEqual( [ 'pull-files', 'flat-docroot', 'apply-runtime' ] );
		const flattenArgs = reprint.mock.calls[ 1 ][ 0 ] as string[];
		expect( flattenArgs ).not.toContain( '--force' );
		const runtimeArgs = reprint.mock.calls[ 2 ][ 0 ] as string[];
		expect( runtimeArgs ).toContain( '--target-engine=sqlite' );
		expect( runtimeArgs ).toContain( `--target-sqlite-path=${ legacySqlitePath }` );
		expect( fs.readFileSync( legacySqlitePath, 'utf8' ) ).toBe( 'local database' );

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
			.spyOn( reprintClient, 'runReprintCommandUntilComplete' )
			.mockResolvedValue( { stdout: '{"ok":true}', stderr: '', exitCode: 0 } );

		await runFullPull(
			{
				sitePath: path.join( technicalSiteDirectory, 'site' ),
				technicalSiteDirectory,
				rawDirectory,
				stateDirectory,
				runtimeDirectory: path.join( technicalSiteDirectory, 'runtime' ),
				runtimeBlueprintPath: path.join( technicalSiteDirectory, 'runtime', 'blueprint.json' ),
				localUrl: 'http://localhost:8881',
			} as never,
			'https://example.com/?reprint-api-jetpack',
			false,
			false,
			{ fileOnlyPaths: [ ':wp-plugins:', '/srv/htdocs/wp-content/plugins/akismet' ] }
		);

		const filesArgs = reprint.mock.calls[ 0 ][ 0 ] as string[];
		expect( filesArgs[ 0 ] ).toBe( 'pull-files' );
		expect( filesArgs ).toContain( '--only=:wp-plugins:' );
		expect( filesArgs ).toContain( '--only=/srv/htdocs/wp-content/plugins/akismet' );
		expect( filesArgs ).not.toContain( '--filter=essential-files' );
		// The database step still runs (only files were restricted).
		const commands = reprint.mock.calls.map( ( call ) => ( call[ 0 ] as string[] )[ 0 ] );
		expect( commands ).toContain( 'pull-db' );

		fs.rmSync( technicalSiteDirectory, { recursive: true, force: true } );
	} );

	it( 'copies the pulled core on a repeat pull without forcing', async () => {
		const technicalSiteDirectory = fs.mkdtempSync(
			path.join( os.tmpdir(), 'studio-import-pull-core-' )
		);
		const reprint = vi
			.spyOn( reprintClient, 'runReprintCommandUntilComplete' )
			.mockResolvedValue( { stdout: '{"ok":true}', stderr: '', exitCode: 0 } );

		await runFullPull(
			{
				sitePath: path.join( technicalSiteDirectory, 'site' ),
				technicalSiteDirectory,
				rawDirectory: path.join( technicalSiteDirectory, 'raw' ),
				stateDirectory: path.join( technicalSiteDirectory, 'state' ),
				runtimeDirectory: path.join( technicalSiteDirectory, 'runtime' ),
				localUrl: 'http://localhost:8881',
			} as never,
			'https://example.com/?reprint-api-jetpack',
			false,
			false,
			{},
			{
				...emptyReprintMetadata,
				sourceSite: {
					...emptyReprintMetadata.sourceSite,
					contentDirectory: '/srv/htdocs/wp-content',
				},
			}
		);

		const calls = reprint.mock.calls.map( ( call ) => call[ 0 ] as string[] );
		expect( calls.map( ( args ) => args[ 0 ] ) ).toEqual( [
			'pull-files',
			'pull-db',
			'flat-docroot',
			'apply-runtime',
		] );
		expect( calls[ 0 ] ).toContain( '--include=:wp-core:' );
		// Copying core replaces both a site's own core files and links to an older pulled core, so
		// a repeat pull needs no --force.
		expect( calls[ 2 ] ).toContain( '--core-files=copy' );
		expect( calls[ 2 ] ).not.toContain( '--force' );

		fs.rmSync( technicalSiteDirectory, { recursive: true, force: true } );
	} );

	describe( 'core selection', () => {
		const remoteVersion = '7.1.4';
		let technicalSiteDirectory: string;
		let sitePath: string;

		const writeOwnCore = ( version: string ) => {
			fs.mkdirSync( path.join( sitePath, 'wp-includes' ), { recursive: true } );
			fs.writeFileSync(
				path.join( sitePath, 'wp-includes', 'version.php' ),
				`<?php\n$wp_version = '${ version }';\n`
			);
		};

		const pull = async ( isFirstPull: boolean, selection = {} ) => {
			const reprint = vi
				.spyOn( reprintClient, 'runReprintCommandUntilComplete' )
				.mockResolvedValue( { stdout: '{"ok":true}', stderr: '', exitCode: 0 } );
			await runFullPull(
				{
					sitePath,
					technicalSiteDirectory,
					rawDirectory: path.join( technicalSiteDirectory, 'raw' ),
					stateDirectory: path.join( technicalSiteDirectory, 'state' ),
					runtimeDirectory: path.join( technicalSiteDirectory, 'runtime' ),
					localUrl: 'http://localhost:8881',
				} as never,
				'https://example.com/?reprint-api-jetpack',
				false,
				isFirstPull,
				selection,
				{
					...emptyReprintMetadata,
					sourceSite: {
						...emptyReprintMetadata.sourceSite,
						contentDirectory: '/srv/htdocs/wp-content',
						wordpressVersion: remoteVersion,
					},
				}
			);
			return reprint.mock.calls.map( ( call ) => call[ 0 ] as string[] );
		};

		beforeEach( () => {
			technicalSiteDirectory = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-pull-core-' ) );
			sitePath = path.join( technicalSiteDirectory, 'site' );
		} );

		afterEach( () => {
			fs.rmSync( technicalSiteDirectory, { recursive: true, force: true } );
		} );

		it( "keeps the site's own core when it runs the remote's version", async () => {
			writeOwnCore( remoteVersion );

			const calls = await pull( true );

			expect( calls[ 0 ] ).toContain( '--include=:wp-content:' );
			expect( calls[ 0 ] ).not.toContain( '--include=:wp-core:' );
			const flatten = calls.find( ( args ) => args[ 0 ] === 'flat-docroot' );
			expect( flatten ).toContain( '--core-files=use-existing' );
			expect( flatten ).toContain( '--force' );
		} );

		it( 'pulls and copies core when the site runs another version', async () => {
			writeOwnCore( '7.1.3' );

			const calls = await pull( false );

			expect( calls[ 0 ] ).toContain( '--include=:wp-core:' );
			expect( calls.find( ( args ) => args[ 0 ] === 'flat-docroot' ) ).toContain(
				'--core-files=copy'
			);
		} );

		it( 'leaves core out of a selective pull that keeps it', async () => {
			writeOwnCore( remoteVersion );

			const calls = await pull( true, { fileOnlyPaths: [ ':wp-content:/plugins' ] } );

			expect( calls[ 0 ].filter( ( arg ) => arg.startsWith( '--only=' ) ) ).toEqual( [
				'--only=:wp-content:/plugins',
			] );
		} );

		it( 'adds core to a selective pull when the versions differ', async () => {
			writeOwnCore( '7.1.3' );

			const calls = await pull( false, { fileOnlyPaths: [ ':wp-content:/plugins' ] } );

			expect( calls[ 0 ].filter( ( arg ) => arg.startsWith( '--only=' ) ) ).toEqual( [
				'--only=:wp-core:',
				'--only=:wp-content:/plugins',
			] );
			expect( calls.find( ( args ) => args[ 0 ] === 'flat-docroot' ) ).toContain(
				'--core-files=copy'
			);
		} );

		it( 'still copies core in a database-only first pull, so the site gets the pulled layout', async () => {
			writeOwnCore( remoteVersion );

			const calls = await pull( true, { databaseOnly: true } );

			expect( calls.map( ( args ) => args[ 0 ] ) ).toEqual( [
				'pull-files',
				'pull-db',
				'merge-wp-content',
				'flat-docroot',
				'apply-runtime',
			] );
			expect( calls[ 0 ].filter( ( arg ) => arg.startsWith( '--only=' ) ) ).toEqual( [
				'--only=:wp-core:',
			] );
			expect( calls[ 3 ] ).toContain( '--core-files=copy' );
			expect( calls[ 3 ] ).toContain( '--force' );
		} );

		it( 'leaves the layout alone on a database-only pull', async () => {
			writeOwnCore( '7.1.3' );

			const calls = await pull( false, { skipFiles: true } );

			expect( calls.map( ( args ) => args[ 0 ] ) ).toEqual( [ 'pull-db', 'apply-runtime' ] );
		} );
	} );

	it( 'uses only the selected directories when uploads are omitted', async () => {
		const technicalSiteDirectory = fs.mkdtempSync(
			path.join( os.tmpdir(), 'studio-import-pull-skip-uploads-' )
		);
		const stateDirectory = path.join( technicalSiteDirectory, 'state' );
		const rawDirectory = path.join( technicalSiteDirectory, 'raw' );
		fs.mkdirSync( stateDirectory, { recursive: true } );
		fs.mkdirSync( rawDirectory, { recursive: true } );

		const reprint = vi
			.spyOn( reprintClient, 'runReprintCommandUntilComplete' )
			.mockResolvedValue( { stdout: '{"ok":true}', stderr: '', exitCode: 0 } );

		await runFullPull(
			{
				stateDirectory,
				rawDirectory,
				sitePath: technicalSiteDirectory,
				technicalSiteDirectory,
				runtimeDirectory: path.join( technicalSiteDirectory, 'runtime' ),
				runtimeBlueprintPath: path.join( technicalSiteDirectory, 'runtime', 'blueprint.json' ),
				localUrl: 'http://localhost:8881',
			},
			'https://example.com/?reprint-api-jetpack',
			false,
			false,
			{ fileOnlyPaths: [ ':wp-content:/plugins', ':wp-content:/themes' ] }
		);

		const filesArgs = reprint.mock.calls[ 0 ][ 0 ] as string[];
		expect( filesArgs ).toContain( '--only=:wp-content:/plugins' );
		expect( filesArgs ).toContain( '--only=:wp-content:/themes' );
		expect( filesArgs ).not.toContain( '--exclude=:wp-uploads:' );
		expect( filesArgs ).not.toContain( '--filter=essential-files' );

		fs.rmSync( technicalSiteDirectory, { recursive: true, force: true } );
	} );

	it( 'leaves a damaged raw scratch for Reprint to recover', async () => {
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
			.spyOn( reprintClient, 'runReprintCommandUntilComplete' )
			.mockResolvedValue( { stdout: '{"ok":true}', stderr: '', exitCode: 0 } );

		await runFullPull(
			{
				sitePath: path.join( technicalSiteDirectory, 'site' ),
				technicalSiteDirectory,
				rawDirectory,
				stateDirectory,
				runtimeDirectory: path.join( technicalSiteDirectory, 'runtime' ),
				runtimeBlueprintPath: path.join( technicalSiteDirectory, 'runtime', 'blueprint.json' ),
				localUrl: 'http://localhost:8881',
			} as never,
			'https://example.com/?reprint-api-jetpack',
			false,
			true
		);

		// Reprint owns recovery of its state and scratch. Studio must not
		// delete the raw tree or private state files behind its back.
		expect( fs.readdirSync( rawDirectory ) ).toEqual( [ 'stale-blocker' ] );
		expect( fs.existsSync( path.join( stateDirectory, '.import-remote-index.jsonl' ) ) ).toBe(
			true
		);
		expect(
			JSON.parse( fs.readFileSync( path.join( stateDirectory, '.import-state.json' ), 'utf-8' ) )
		).toEqual( { command: 'files-pull', status: 'complete', preflight: { data: {} } } );
		// The pull is still passed to Reprint in its default mode.
		const filesArgs = reprint.mock.calls[ 0 ][ 0 ] as string[];
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

		vi.spyOn( reprintClient, 'runReprintCommandUntilComplete' ).mockResolvedValue( {
			stdout: '{"ok":true}',
			stderr: '',
			exitCode: 0,
		} );

		await runFullPull(
			{
				sitePath: path.join( technicalSiteDirectory, 'site' ),
				technicalSiteDirectory,
				rawDirectory,
				stateDirectory,
				runtimeDirectory: path.join( technicalSiteDirectory, 'runtime' ),
				runtimeBlueprintPath: path.join( technicalSiteDirectory, 'runtime', 'blueprint.json' ),
				localUrl: 'http://localhost:8881',
			} as never,
			'https://example.com/?reprint-api-jetpack',
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
				fileOnlyPaths: [ ':wp-plugins:', '/srv/htdocs/wp-content/plugins/akismet' ],
			} )
		);

		const reprint = vi
			.spyOn( reprintClient, 'runReprintCommandUntilComplete' )
			.mockResolvedValue( { stdout: '{"ok":true}', stderr: '', exitCode: 0 } );

		await runFullPull(
			{
				sitePath: path.join( technicalSiteDirectory, 'site' ),
				technicalSiteDirectory,
				rawDirectory,
				stateDirectory,
				runtimeDirectory: path.join( technicalSiteDirectory, 'runtime' ),
				runtimeBlueprintPath: path.join( technicalSiteDirectory, 'runtime', 'blueprint.json' ),
				localUrl: 'http://localhost:8881',
			} as never,
			'https://example.com/?reprint-api-jetpack',
			false,
			true
		);

		const passedArgs = reprint.mock.calls[ 0 ][ 0 ] as string[];
		expect( passedArgs ).not.toContain( '--no-db' );
		expect( passedArgs.some( ( a ) => a.startsWith( '--only' ) ) ).toBe( false );

		fs.rmSync( technicalSiteDirectory, { recursive: true, force: true } );
	} );

	it( 'uses the raw wp-content sqlite path for a database pull when preflight exposes no content dir', async () => {
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
			.spyOn( reprintClient, 'runReprintCommandUntilComplete' )
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
		await runFullPull( metadata, 'https://example.com/?reprint-api-jetpack', false, false );

		// With no content dir from preflight, the database target stays in
		// the raw scratch directory so flat-docroot can link it later.
		const dbArgs = reprint.mock.calls[ 1 ][ 0 ] as string[];
		expect( dbArgs[ 0 ] ).toBe( 'pull-db' );
		expect( dbArgs ).toContain(
			`--target-sqlite-path=${ path.join( rawDirectory, 'wp-content', 'database', '.ht.sqlite' ) }`
		);
		// A delta re-pull (isFirstPull=false) skips the merge and leaves the
		// flatten unforced, so it can never overwrite the live site.
		const commands = reprint.mock.calls.map( ( call ) => ( call[ 0 ] as string[] )[ 0 ] );
		expect( commands ).not.toContain( 'merge-wp-content' );
		const flattenArgs = reprint.mock.calls[ 2 ][ 0 ] as string[];
		expect( flattenArgs ).not.toContain( '--force' );

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

		vi.spyOn( reprintClient, 'runReprintCommandUntilComplete' ).mockRejectedValue(
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
			runFullPull( metadata as never, 'https://example.com/?reprint-api-jetpack', false, true )
		).rejects.toThrow( 'reprint exited with code 1' );

		// No progress file is written on failure either — a re-run resumes by
		// re-invoking the idempotent pull, not by reading a stage cursor.
		expect( fs.existsSync( path.join( technicalSiteDirectory, 'pull.json' ) ) ).toBe( false );

		fs.rmSync( technicalSiteDirectory, { recursive: true, force: true } );
	} );
} );

describe( 'CLI: studio pull requires an existing site', () => {
	let fakeHome: string;

	afterEach( () => {
		vi.restoreAllMocks();
		vi.resetModules();
		if ( fakeHome ) {
			fs.rmSync( fakeHome, { recursive: true, force: true } );
		}
	} );

	/**
	 * Loads a fresh `pull` module whose config + pulls directories
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

		const mod = await import( '../pull' );
		return mod;
	}

	function pullsRoot() {
		return path.join( fakeHome, '.studio', 'pulls' );
	}

	it( 'errors when no Studio site exists at --path, before touching the remote', async () => {
		const { runCommand } = await loadRunCommandWithFakeHome();
		const sitePath = path.join( fakeHome, 'Studio', 'Missing-Site' );

		const reprintClientMod = await import( 'cli/lib/pull/reprint-client' );
		const reprintSpy = vi.spyOn( reprintClientMod, 'runReprintCommandUntilComplete' );

		await expect( runCommand( sitePath, 'https://example.com', false ) ).rejects.toThrow(
			'The specified directory is not added to Studio.'
		);

		// The site lookup fails up front, so the remote is never contacted and
		// no pull directory is created.
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
		const reprintClientMod = await import( 'cli/lib/pull/reprint-client' );
		const reprintSpy = vi
			.spyOn( reprintClientMod, 'runReprintCommandUntilComplete' )
			.mockRejectedValue( new Error( 'stop after preflight' ) );
		const logSpy = vi.spyOn( console, 'log' ).mockImplementation( () => undefined );
		vi.spyOn( console, 'error' ).mockImplementation( () => undefined );

		await expect( runCommand( sitePath, 'https://example.com', false ) ).rejects.toThrow();

		// The pipeline reached the remote (preflight is its first reprint call).
		expect( reprintSpy ).toHaveBeenCalled();
		expect( reprintSpy.mock.calls[ 0 ][ 0 ][ 0 ] ).toBe( 'preflight' );

		// The key lives in the site's own state directory, keyed by the API URL.
		const { ensureReprintKey } = await import( 'cli/lib/pull/reprint-key' );
		expect( ensureReprintKey ).toHaveBeenCalledWith( {
			source: expect.objectContaining( {
				wpComSite: expect.objectContaining( { id: 22 } ),
				wpComToken: expect.objectContaining( { accessToken: 'access-token' } ),
			} ),
			apiUrl: 'https://example.com/?reprint-api-jetpack',
			stateDirectory: path.join( pullsRoot(), 'existing-id', 'state' ),
			verbose: false,
		} );

		// Messaging is driven off the existing record's name and path.
		const logged = logSpy.mock.calls.flat().join( '\n' );
		expect( logged ).toContain( 'Pulling "Existing Site"' );
		expect( logged ).toContain( sitePath );

		// The pull directory is keyed by siteId; no Studio-owned progress
		// file is written — resume is by derivation.
		expect( fs.existsSync( path.join( pullsRoot(), 'existing-id' ) ) ).toBe( true );
		expect( fs.existsSync( path.join( pullsRoot(), 'existing-id', 'pull.json' ) ) ).toBe( false );

		// No second site was created. The single record keeps its pull
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

	it( 'reports the Reprint source environment without inferring it from wpcomstaging.com', async () => {
		const { runCommand } = await loadRunCommandWithFakeHome();
		const source = mockWpComPullSource( 'https://example.wpcomstaging.com' );
		source.environmentType = 'production';
		const sitePath = path.join( fakeHome, 'Studio', 'Existing-Site' );
		seedCliConfigSite( fakeHome, [ makeSiteRecord( { path: sitePath } ) ] );
		const reprint = await import( 'cli/lib/pull/reprint-client' );
		vi.spyOn( reprint, 'runReprintCommandUntilComplete' ).mockRejectedValue(
			new Error( 'stop at preflight' )
		);
		const logged = vi.spyOn( console, 'log' ).mockImplementation( () => undefined );
		vi.spyOn( console, 'error' ).mockImplementation( () => undefined );
		await expect( runCommand( sitePath, source.url, false ) ).rejects.toThrow();
		expect( logged.mock.calls.flat().join( '\n' ) ).toContain(
			'Remote environment: {"isStaging":false,"environmentType":"production"}'
		);
	} );

	it( 'exits non-zero when the remote site cannot be reached', async () => {
		const { commandHandler } = await loadRunCommandWithFakeHome();
		mockWpComPullSource();
		const sitePath = path.join( fakeHome, 'Studio', 'Existing-Site' );
		seedCliConfigSite( fakeHome, [
			makeSiteRecord( { id: 'existing-id', name: 'Existing Site', path: sitePath } ),
		] );
		const reprintClientMod = await import( 'cli/lib/pull/reprint-client' );
		vi.spyOn( reprintClientMod, 'runReprintCommandUntilComplete' ).mockRejectedValue(
			new Error( 'connection refused' )
		);
		vi.spyOn( console, 'log' ).mockImplementation( () => undefined );
		vi.spyOn( console, 'error' ).mockImplementation( () => undefined );

		try {
			await commandHandler( {
				path: sitePath,
				remoteSite: 'https://example.com',
				verbose: false,
			} as Parameters< typeof commandHandler >[ 0 ] );

			// The host app reads the exit code to tell a failed pull from a successful one.
			expect( process.exitCode ).toBe( 1 );
		} finally {
			process.exitCode = undefined;
		}
	} );
} );

describe( 'CLI: studio pull delta re-pull of a completed pull', () => {
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

		const mod = await import( '../pull' );
		return mod;
	}

	it( 'runs a delta re-pull for a site that already completed a full import', async () => {
		const { runCommand } = await loadRunCommandWithFakeHome();
		mockWpComPullSource();

		const pullsRoot = path.join( fakeHome, '.studio', 'pulls' );
		// The pull directory is keyed by siteId now.
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
		const reprintClientMod = await import( 'cli/lib/pull/reprint-client' );
		const reprintSpy = vi
			.spyOn( reprintClientMod, 'runReprintCommandUntilComplete' )
			.mockRejectedValue( new Error( 'stop after repull reset' ) );
		const logSpy = vi.spyOn( console, 'log' ).mockImplementation( () => undefined );
		vi.spyOn( console, 'error' ).mockImplementation( () => undefined );

		await expect( runCommand( sitePath, undefined, false ) ).rejects.toThrow();

		// A delta re-pull re-enters the pipeline (preflight is its first call)
		// rather than short-circuiting on the existing import.
		expect( reprintSpy ).toHaveBeenCalled();
		expect( reprintSpy.mock.calls[ 0 ][ 0 ][ 0 ] ).toBe( 'preflight' );

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
		// Reprint creates the state directory; its commands are mocked here.
		fs.mkdirSync( path.join( fakeHome, '.studio', 'pulls', 'stale-filter-id', 'state' ), {
			recursive: true,
		} );

		const reprintClientMod = await import( 'cli/lib/pull/reprint-client' );
		const reprintSpy = vi
			.spyOn( reprintClientMod, 'runReprintCommandUntilComplete' )
			.mockImplementation( async ( args ) => {
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

				if ( args[ 0 ] === 'pull-metadata' ) {
					return {
						stdout: JSON.stringify( emptyReprintMetadata ),
						stderr: '',
						exitCode: 0,
					};
				}

				if ( args[ 0 ] === 'pull-files' ) {
					expect( args ).not.toContain( '--filter=essential-files' );
					throw new Error( 'stop after files pull invocation' );
				}

				throw new Error( `Unexpected reprint command: ${ args[ 0 ] }` );
			} );
		vi.spyOn( console, 'log' ).mockImplementation( () => undefined );
		vi.spyOn( console, 'error' ).mockImplementation( () => undefined );

		await expect( runCommand( sitePath, 'https://example.com', false ) ).rejects.toThrow(
			/stop after files pull invocation/
		);

		expect( reprintSpy.mock.calls.map( ( call ) => call[ 0 ][ 0 ] ) ).toEqual( [
			'preflight',
			'pull-metadata',
			'pull-files',
		] );
	} );

	it.each( [
		[ 'preflight', 'remote_backup' ],
		[ 'pull-files', 'remote_backup' ],
		[ 'flat-docroot', 'local_import' ],
	] )(
		'records an uncoded failure in %s as the step it happened in',
		async ( failingCommand, failureReason ) => {
			const { runCommand } = await loadRunCommandWithFakeHome();
			mockWpComPullSource();
			const sitePath = path.join( fakeHome, 'Studio', 'Failing-Site' );
			seedCliConfigSite( fakeHome, [
				makeSiteRecord( {
					id: 'failing-id',
					name: 'Failing Site',
					path: sitePath,
					importComplete: true,
					status: 'ready',
				} ),
			] );
			fs.mkdirSync( path.join( fakeHome, '.studio', 'pulls', 'failing-id', 'state' ), {
				recursive: true,
			} );

			const tracks = await import( 'cli/lib/tracks' );
			const recordTracksEvent = vi
				.spyOn( tracks, 'recordTracksEvent' )
				.mockResolvedValue( undefined );
			const reprintClientMod = await import( 'cli/lib/pull/reprint-client' );
			vi.spyOn( reprintClientMod, 'runReprintCommandUntilComplete' ).mockImplementation(
				async ( args ) => {
					if ( args[ 0 ] === failingCommand ) {
						throw new Error( `${ failingCommand } crashed` );
					}
					const stdout =
						args[ 0 ] === 'preflight'
							? JSON.stringify( { data: { ok: true, php: { version: '8.3' } } } )
							: JSON.stringify( emptyReprintMetadata );
					return { stdout, stderr: '', exitCode: 0 };
				}
			);
			vi.spyOn( console, 'log' ).mockImplementation( () => undefined );
			vi.spyOn( console, 'error' ).mockImplementation( () => undefined );

			await expect( runCommand( sitePath, 'https://example.com', false ) ).rejects.toThrow();

			expect( recordTracksEvent ).toHaveBeenCalledExactlyOnceWith(
				tracks.TRACKS_EVENTS.SYNC_PULL,
				expect.objectContaining( { success: false, failure_reason: failureReason } )
			);
		}
	);
} );

describe( 'CLI: studio pull first-pull selective sync', () => {
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

		const mod = await import( '../pull' );
		return mod;
	}

	it( 'accepts --only/--skip-database on a first pull, adds core, and merges local content', async () => {
		const { runCommand } = await loadRunCommandWithFakeHome();
		mockWpComPullSource();

		const pullsRoot = path.join( fakeHome, '.studio', 'pulls' );
		const technicalSiteDirectory = path.join( pullsRoot, 'fresh-id' );
		const stateDirectory = path.join( technicalSiteDirectory, 'state' );
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

		fs.mkdirSync( stateDirectory, { recursive: true } );

		let operationDuringPull: unknown;
		const reprintClientMod = await import( 'cli/lib/pull/reprint-client' );
		const reprintSpy = vi
			.spyOn( reprintClientMod, 'runReprintCommandUntilComplete' )
			.mockImplementation( async ( args ) => {
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
				if ( args[ 0 ] === 'pull-metadata' ) {
					return {
						stdout: JSON.stringify( {
							...emptyReprintMetadata,
							sourceSite: {
								...emptyReprintMetadata.sourceSite,
								contentDirectory: '/srv/htdocs/wp-content',
							},
						} ),
						stderr: '',
						exitCode: 0,
					};
				}
				if ( args[ 0 ] === 'pull-files' ) {
					operationDuringPull = readSeededCliConfig( fakeHome ).sites[ 0 ].operation;
					return { stdout: '{"ok":true}', stderr: '', exitCode: 0 };
				}
				if ( args[ 0 ] === 'merge-wp-content' ) {
					// Keeping the unselected local plugin and the kept database is
					// Reprint's job now, through the merge this asks for.
					expect( args ).toContain( `--from=${ path.join( sitePath, 'wp-content' ) }` );
					return { stdout: '{"moved":2}', stderr: '', exitCode: 0 };
				}
				if ( args[ 0 ] === 'flat-docroot' ) {
					expect( args ).toContain( '--force' );
					throw new Error( 'stop after flat-docroot' );
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
		).rejects.toThrow( /stop after flat-docroot/ );

		expect( operationDuringPull ).toMatchObject( { kind: 'import' } );
		const config = readSeededCliConfig( fakeHome );
		expect( config.sites[ 0 ].operation ).toBeUndefined();
		expect( config.sites[ 0 ].status ).toBe( 'pull-failed' );

		// No pull-db: the database was skipped. CLI selections do not need a
		// remote tree lookup.
		expect( reprintSpy.mock.calls.map( ( call ) => call[ 0 ][ 0 ] ) ).toEqual( [
			'preflight',
			'pull-metadata',
			'pull-files',
			'merge-wp-content',
			'flat-docroot',
		] );

		// The include-list carries the core the remote runs plus the selection.
		const filesArgs = reprintSpy.mock.calls[ 2 ][ 0 ] as string[];
		expect( filesArgs ).toContain( '--only=:wp-core:' );
		expect( filesArgs ).toContain( '--only=:wp-content:/themes' );
		expect( filesArgs ).toContain( '--only=:wp-content:/plugins/jetpack' );

		// The persisted sidecar records the selection a resume reuses. Whether to pull core is
		// decided on each run.
		const sidecar = JSON.parse(
			fs.readFileSync( path.join( stateDirectory, 'selection.json' ), 'utf-8' )
		);
		expect( sidecar.fileOnlyPaths ).toEqual( [
			':wp-content:/themes',
			':wp-content:/plugins/jetpack',
		] );
		expect( sidecar.skipDatabase ).toBe( true );
	} );
} );
