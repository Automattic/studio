/**
 * @vitest-environment node
 *
 * Real end-to-end test for the `studio site start` / `stop` lifecycle: unlike
 * start.test.ts / stop.test.ts (which mock the daemon), this spawns the built CLI,
 * boots a real WordPress server, and checks the live state via `studio site list`.
 *
 * Needs the CLI built first (skips otherwise). Tagged `e2e` (slower manual suite):
 * `npm test -- --tagsFilter='e2e'`.
 */
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	cleanupCliEnv,
	cliE2ePrerequisitesMet,
	runCli,
	setupCliEnv,
	type CliEnv,
} from './helpers/cli-e2e';

/**
 * Whether the CLI reports the site at `sitePath` as running, via
 * `studio site list --format json` (stdout is clean JSON; progress goes to stderr).
 */
async function isSiteRunning( env: CliEnv, sitePath: string ): Promise< boolean > {
	const result = await runCli( [ 'site', 'list', '--format', 'json' ], env );
	expect( result.code, result.stderr ).toBe( 0 );
	const sites = JSON.parse( result.stdout.trim() ) as Array< {
		path?: string;
		running?: boolean;
	} >;
	return sites.find( ( site ) => site.path === sitePath )?.running === true;
}

describe.skipIf( ! cliE2ePrerequisitesMet() )( 'CLI e2e: studio site start/stop', () => {
	let env: CliEnv | undefined;
	let sitePath = '';

	// Create the site once (no --start); the ordered cases below share it — start
	// must precede stop, and one create avoids a second slow WordPress copy.
	//
	// `--runtime sandbox` (bundled Playground/WASM) keeps this hermetic. Native PHP
	// would download its ~25 MB binary into the config dir on first run, so covering
	// it hermetically needs CI to provision that binary — a follow-up.
	beforeAll( async () => {
		env = setupCliEnv();
		sitePath = path.join( env.sitesDir, 'lifecycle-e2e-site' );

		const result = await runCli(
			[
				'create',
				'--name',
				'Lifecycle E2E Site',
				'--path',
				sitePath,
				'--wp',
				'latest',
				'--runtime',
				'sandbox',
				'--no-start',
				'--skip-browser',
				'--skip-log-details',
			],
			env
		);
		expect( result.code, result.stderr ).toBe( 0 );
	}, 120_000 );

	// Stop everything and remove the isolated env even if a case failed, so no
	// daemon/server/port leaks. `stop --all` also kills the isolated daemon.
	afterAll( async () => {
		if ( ! env ) {
			return;
		}
		await runCli( [ 'site', 'stop', '--all' ], env );
		cleanupCliEnv( env );
		env = undefined;
	}, 60_000 );

	it( 'starts a site', { tags: [ 'e2e' ], timeout: 180_000 }, async () => {
		if ( ! env ) {
			throw new Error( 'CLI e2e env was not initialised' );
		}

		const result = await runCli(
			[ 'site', 'start', '--path', sitePath, '--skip-browser', '--skip-log-details' ],
			env
		);
		expect( result.code, result.stderr ).toBe( 0 );

		expect( await isSiteRunning( env, sitePath ) ).toBe( true );
	} );

	it( 'stops a site', { tags: [ 'e2e' ], timeout: 120_000 }, async () => {
		if ( ! env ) {
			throw new Error( 'CLI e2e env was not initialised' );
		}

		const result = await runCli( [ 'site', 'stop', '--path', sitePath ], env );
		expect( result.code, result.stderr ).toBe( 0 );

		expect( await isSiteRunning( env, sitePath ) ).toBe( false );
	} );
} );
