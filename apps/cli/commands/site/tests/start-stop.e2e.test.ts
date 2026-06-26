/**
 * @vitest-environment node
 *
 * Real end-to-end test for the `studio site start` / `studio site stop` lifecycle.
 * Unlike start.test.ts / stop.test.ts (which mock the daemon and server manager),
 * this spawns the built CLI, boots a real WordPress server through the
 * process-manager daemon, and verifies the live running state via `studio site list`.
 *
 * Requires the CLI to be built first (`npm run cli:build`); the suite skips itself
 * otherwise. Tagged `e2e` so it runs in the slower (release/manual) suite rather
 * than on every PR — run with `npm test -- --tagsFilter='e2e'`.
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
 * Whether the CLI reports the site at `sitePath` as running, read from the live
 * daemon via `studio site list --format json`. stdout is clean JSON: the spinner
 * and all progress logging go to stderr (picospinner-stderr-patch).
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

	// Create the site once without starting it, so the cases below exercise a real,
	// persisted site. They run in order on the same site: a site must be started
	// before stopping it is meaningful, and creating once avoids a second (slow)
	// WordPress copy.
	//
	// `--runtime sandbox` (Playground/WASM, bundled in the CLI) keeps this fully
	// hermetic. The native PHP runtime works the same way but downloads its ~25 MB
	// PHP binary into the isolated config dir on first run — the real binary at
	// ~/.studio/php-bin can't be symlinked read-only like server-files because the
	// native runtime writes php.ini beside it. Covering the native runtime
	// hermetically needs the CI to provision that binary, so it's a follow-up.
	beforeAll( async () => {
		env = setupCliEnv();
		sitePath = path.join( env.sitesDir, 'lifecycle-e2e-site' );

		const result = await runCli(
			[
				'site',
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
