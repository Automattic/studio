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
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import cliPackageJson from '../../../package.json';
import {
	cleanupCliEnv,
	cliE2ePrerequisitesMet,
	daemonRequest,
	installPreviousCli,
	readCliConfig,
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

	async function runPreviousCli( args: string[] ) {
		const result = await runCli( args, getEnv(), { cliMain: previousCli } );
		expect( result.code, result.stderr ).toBe( 0 );
	}

	function siteId( sitePath: string ) {
		return readCliConfig( getEnv() ).sites.find( ( site ) => site.path === sitePath )?.id;
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

	async function expectRestartedByThisCli( oldPid: number | undefined ) {
		expect( await daemonRequest( getEnv(), { type: 'ping' } ) ).toEqual( {
			version: cliPackageJson.version,
		} );
		expect( await onlinePid( runningSite ) ).not.toBe( oldPid );
		const port = readCliConfig( getEnv() ).sites.find( ( site ) => site.path === runningSite )
			?.port;
		expect( ( await waitForSiteResponse( `http://localhost:${ port }/` ) ).status ).toBeLessThan(
			500
		);
		expect( fs.existsSync( path.join( getEnv().daemonHome, 'sites-to-restart.json' ) ) ).toBe(
			false
		);
	}

	beforeAll( async () => {
		previousCli = installPreviousCli().cliMain;
		env = setupCliEnv( { basePort: 20_000 + Math.floor( Math.random() * 400 ) * 100 } );
		runningSite = path.join( env.sitesDir, 'upgrade-running' );
		stoppedSite = path.join( env.sitesDir, 'upgrade-stopped' );
		for ( const sitePath of [ runningSite, stoppedSite ] ) {
			await runPreviousCli( [
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
			] );
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
		'starts each site once when several commands connect at the same time',
		{ tags: [ 'e2e' ], timeout: 300_000 },
		async () => {
			await runCli( [ 'site', 'stop', '--all' ], getEnv() );
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
} );
