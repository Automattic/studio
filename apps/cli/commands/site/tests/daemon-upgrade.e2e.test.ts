/**
 * @vitest-environment node
 *
 * Real end-to-end test for upgrading Studio while sites run: the previous `wp-studio` release from
 * npm starts sites on its daemon, then this CLI connects. It must replace the outdated daemon and
 * start the sites that were running again with this CLI.
 *
 * Needs the CLI built first (skips otherwise) and the npm registry. Tagged `e2e`:
 * `npm test -- --tagsFilter='e2e' daemon-upgrade`.
 */
import fs from 'fs';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import cliPackageJson from '../../../package.json';
import {
	cleanupCliEnv,
	cliE2ePrerequisitesMet,
	daemonRequest,
	handConfigBackToPreviousCli,
	installPreviousCli,
	readConfigFile,
	runCli,
	setupCliEnv,
	waitForSiteResponse,
	type CliEnv,
} from './helpers/cli-e2e';

type ProcessDescription = { name: string; status: 'online' | 'stopped'; pid?: number };

describe.skipIf( ! cliE2ePrerequisitesMet() )( 'CLI e2e: upgrading over a running daemon', () => {
	let env: CliEnv | undefined;
	let previousCli = '';
	let runningSite = '';
	let stoppedSite = '';

	function getEnv(): CliEnv {
		if ( ! env ) {
			throw new Error( 'CLI e2e env was not initialised' );
		}
		return env;
	}

	async function runPreviousCli( args: string[], { offline = false } = {} ) {
		const result = await runCli( args, getEnv(), { cliMain: previousCli, offline } );
		expect( result.code, result.stderr ).toBe( 0 );
	}

	function siteId( sitePath: string ) {
		return readConfigFile( getEnv() ).sites.find( ( site ) => site.path === sitePath )?.id;
	}

	async function siteProcesses( sitePath: string ): Promise< ProcessDescription[] > {
		const { processes } = await daemonRequest( getEnv(), { type: 'list-processes' } );
		return ( processes as ProcessDescription[] ).filter(
			( process ) => process.name === `studio-site-${ siteId( sitePath ) }`
		);
	}

	async function onlinePid( sitePath: string ) {
		const online = ( await siteProcesses( sitePath ) ).filter(
			( process ) => process.status === 'online'
		);
		expect( online ).toHaveLength( 1 );
		return online[ 0 ].pid;
	}

	function siteUrl( sitePath: string, urlPath = '/' ) {
		const port = readConfigFile( getEnv() ).sites.find( ( site ) => site.path === sitePath )?.port;
		return `http://localhost:${ port }${ urlPath }`;
	}

	async function expectRestartedByThisCli( oldPid: number | undefined ) {
		expect( await daemonRequest( getEnv(), { type: 'ping' } ) ).toEqual( {
			version: cliPackageJson.version,
		} );
		expect( await onlinePid( runningSite ) ).not.toBe( oldPid );
		expect( ( await waitForSiteResponse( siteUrl( runningSite ) ) ).status ).toBeLessThan( 500 );
		expect( fs.existsSync( path.join( getEnv().daemonHome, 'sites-to-restart.json' ) ) ).toBe(
			false
		);
	}

	beforeAll( async () => {
		previousCli = installPreviousCli().cliMain;
		env = setupCliEnv( {
			basePort: 20_000 + Math.floor( Math.random() * 400 ) * 100,
			ownServerFiles: true,
		} );
		runningSite = path.join( env.sitesDir, 'upgrade-running' );
		stoppedSite = path.join( env.sitesDir, 'upgrade-stopped' );
		// Offline, the previous release keeps the WordPress it bundles. Online, `site create --wp latest`
		// downloads a newer one from wordpress.org, which closes the connection after the zip, and Node
		// 24.22.1's fetch can crash on that (`assert(!this.paused)`). Starting a site needs the network
		// to download PHP.
		for ( const sitePath of [ runningSite, stoppedSite ] ) {
			await runPreviousCli(
				[
					'site',
					'create',
					'--name',
					path.basename( sitePath ),
					'--path',
					sitePath,
					'--wp',
					'latest',
					'--no-start',
					'--skip-browser',
					'--skip-log-details',
				],
				{ offline: true }
			);
		}
	}, 600_000 );

	afterAll( async () => {
		if ( ! env ) {
			return;
		}
		await runCli( [ 'site', 'stop', '--all' ], env );
		cleanupCliEnv( env );
		env = undefined;
	}, 60_000 );

	it(
		'starts the running sites again with this CLI on its first command',
		{ tags: [ 'e2e' ], timeout: 300_000 },
		async () => {
			for ( const sitePath of [ runningSite, stoppedSite ] ) {
				await runPreviousCli( [
					'site',
					'start',
					'--path',
					sitePath,
					'--skip-browser',
					'--skip-log-details',
				] );
			}
			await runPreviousCli( [ 'site', 'stop', '--path', stoppedSite ] );
			const oldPid = await onlinePid( runningSite );

			// An app update replaces the files of the running daemon, like the .app bundle on macOS. Windows
			// installs updates next to the old version, and files of running processes can't be moved there.
			const previousCliDir = path.dirname( path.dirname( path.dirname( previousCli ) ) );
			const movedCliDir = `${ previousCliDir }-moved`;
			if ( process.platform !== 'win32' ) {
				fs.renameSync( previousCliDir, movedCliDir );
			}
			let result;
			try {
				result = await runCli( [ 'site', 'list', '--format', 'json' ], getEnv() );
			} finally {
				if ( process.platform !== 'win32' ) {
					fs.renameSync( movedCliDir, previousCliDir );
				}
			}
			expect( result.code, result.stderr ).toBe( 0 );
			// In E2E mode the CLI also prints the Tracks events it would have recorded.
			const json = result.stdout.split( '\n' ).find( ( line ) => line.startsWith( '[' ) );
			const sites = JSON.parse( json ?? '' ) as Array< { path: string; running: boolean } >;
			expect( sites.find( ( site ) => site.path === runningSite )?.running ).toBe( true );
			expect( sites.find( ( site ) => site.path === stoppedSite )?.running ).toBe( false );

			await expectRestartedByThisCli( oldPid );
			expect( await siteProcesses( stoppedSite ) ).not.toContainEqual(
				expect.objectContaining( { status: 'online' } )
			);
		}
	);

	it(
		'serves phpMyAdmin and creates sites from the files this CLI ships',
		{ tags: [ 'e2e' ], timeout: 300_000 },
		async () => {
			// The restarted site unpacks this CLI's phpMyAdmin in the background.
			const phpMyAdmin = await waitForSiteResponse( siteUrl( runningSite, '/phpmyadmin/' ), {
				expectedStatus: 200,
				timeoutMs: 60_000,
			} );
			expect( phpMyAdmin.status ).toBe( 200 );

			// The previous release may bundle the same WordPress as this CLI: mark its copy as older so
			// this CLI moves it aside and unpacks its own.
			const versionsPath = path.join( getEnv().configDir, 'server-files', 'wordpress-versions' );
			const versionFile = path.join( versionsPath, 'latest', 'wp-includes', 'version.php' );
			fs.writeFileSync(
				versionFile,
				fs
					.readFileSync( versionFile, 'utf8' )
					.replace( /\$wp_version = '[^']+'/, "$wp_version = '6.0'" )
			);
			// Creating a site with `--wp latest` would download WordPress if the unpack failed.
			const list = await runCli( [ 'site', 'list' ], getEnv() );
			expect( list.code, list.stderr ).toBe( 0 );
			expect( fs.existsSync( path.join( versionsPath, '6.0', 'wp-includes' ) ) ).toBe( true );
			expect( fs.readFileSync( versionFile, 'utf8' ) ).not.toContain( "$wp_version = '6.0'" );

			// Offline, like the previous release's creates, so it can't download a newer WordPress.
			const newSite = path.join( getEnv().sitesDir, 'upgrade-new' );
			const result = await runCli(
				[
					'site',
					'create',
					'--name',
					'upgrade-new',
					'--path',
					newSite,
					'--wp',
					'latest',
					'--skip-browser',
					'--skip-log-details',
				],
				getEnv(),
				{ offline: true }
			);
			expect( result.code, result.stderr ).toBe( 0 );
			expect( ( await waitForSiteResponse( siteUrl( newSite ) ) ).status ).toBeLessThan( 500 );
		}
	);

	it(
		'starts each site once when several commands connect at the same time',
		{ tags: [ 'e2e' ], timeout: 300_000 },
		async () => {
			await runCli( [ 'site', 'stop', '--all' ], getEnv() );
			handConfigBackToPreviousCli( getEnv() );
			await runPreviousCli( [
				'site',
				'start',
				'--path',
				runningSite,
				'--skip-browser',
				'--skip-log-details',
			] );
			const oldPid = await onlinePid( runningSite );

			// The Desktop app starts its sites itself at launch, racing the restart of the replaced daemon.
			const results = await Promise.all( [
				runCli( [ 'site', 'list', '--format', 'json' ], getEnv() ),
				runCli( [ 'site', 'status', '--path', runningSite ], getEnv() ),
				runCli(
					[ 'site', 'start', '--path', runningSite, '--skip-browser', '--skip-log-details' ],
					getEnv()
				),
			] );
			for ( const result of results ) {
				expect( result.code, result.stderr ).toBe( 0 );
				expect( result.stderr ).not.toContain( 'could not be started again' );
			}

			await expectRestartedByThisCli( oldPid );
		}
	);

	it(
		'waits for the restart when a site is started while it restarts',
		{ tags: [ 'e2e' ], timeout: 300_000 },
		async () => {
			await runCli( [ 'site', 'stop', '--all' ], getEnv() );
			handConfigBackToPreviousCli( getEnv() );
			await runPreviousCli( [
				'site',
				'start',
				'--path',
				runningSite,
				'--skip-browser',
				'--skip-log-details',
			] );
			const oldPid = await onlinePid( runningSite );

			// Like the Desktop app starting its sites at launch, after another command replaced the daemon.
			const list = runCli( [ 'site', 'list', '--format', 'json' ], getEnv() );
			await vi.waitFor(
				() => {
					const site = readConfigFile( getEnv() ).sites.find(
						( item ) => item.path === runningSite
					);
					expect( site?.operation ).toMatchObject( { kind: 'start' } );
				},
				{ timeout: 60_000, interval: 50 }
			);
			const start = await runCli(
				[ 'site', 'start', '--path', runningSite, '--skip-browser', '--skip-log-details' ],
				getEnv()
			);
			expect( start.code, start.stderr ).toBe( 0 );
			const listResult = await list;
			expect( listResult.code, listResult.stderr ).toBe( 0 );
			expect( listResult.stderr ).not.toContain( 'could not be started again' );

			await expectRestartedByThisCli( oldPid );
		}
	);
} );
