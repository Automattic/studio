/**
 * @vitest-environment node
 *
 * Real end-to-end test for `studio create`. Unlike create.test.ts (which
 * mocks the command's dependencies), this spawns the built CLI binary and
 * creates an actual site, verifying the real persisted state on disk.
 *
 * Requires the CLI to be built first (`npm run cli:build`); the suite skips
 * itself otherwise. Tagged `e2e` so it runs in the slower (release/manual)
 * suite rather than on every PR — run with `npm test -- --tagsFilter='e2e'`.
 */
import fs from 'fs';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	cleanupCliEnv,
	cliE2ePrerequisitesMet,
	readCliConfig,
	runCli,
	setupCliEnv,
	waitForSiteResponse,
	type CliEnv,
} from './helpers/cli-e2e';

describe.skipIf( ! cliE2ePrerequisitesMet() )( 'CLI e2e: studio create', () => {
	let env: CliEnv | undefined;

	afterEach( async () => {
		if ( env ) {
			// The homepage test starts a site; stop it before tearing down the env.
			await runCli( [ 'site', 'stop', '--all' ], env );
			cleanupCliEnv( env );
			env = undefined;
		}
	}, 60_000 );

	it(
		'creates a site that serves its homepage',
		{ tags: [ 'e2e' ], timeout: 180_000 },
		async () => {
			env = setupCliEnv();
			const siteName = 'Custom E2E Site';
			const sitePath = path.join( env.sitesDir, 'custom-e2e-site' );

			const result = await runCli(
				[
					'create',
					'--name',
					siteName,
					'--path',
					sitePath,
					'--wp',
					'latest',
					// Sandbox is bundled; the default native runtime downloads PHP on start.
					'--runtime',
					'sandbox',
					'--skip-browser',
					'--skip-log-details',
				],
				env
			);

			expect( result.code, result.stderr ).toBe( 0 );

			const config = readCliConfig( env );
			expect( config.sites ).toHaveLength( 1 );
			const [ site ] = config.sites;
			expect( site.name ).toBe( siteName );
			expect( site.path ).toBe( sitePath );
			expect( site.phpVersion ).toBeTruthy();
			expect( site.port ).toBeTruthy();

			// wp-config.php only exists if the server started (create alone doesn't generate it).
			expect( fs.existsSync( path.join( sitePath, 'wp-load.php' ) ) ).toBe( true );
			expect( fs.existsSync( path.join( sitePath, 'wp-includes', 'version.php' ) ) ).toBe( true );
			expect( fs.existsSync( path.join( sitePath, 'wp-config.php' ) ) ).toBe( true );

			// A freshly started site can return a warm-up 302 before serving, so poll for the 200.
			const response = await waitForSiteResponse( `http://localhost:${ String( site.port ) }`, {
				expectedStatus: 200,
			} );
			expect( response.status ).toBe( 200 );
			expect( response.headers.get( 'content-type' ) ).toMatch( /text\/html/ );
		}
	);

	it(
		'creates a site with a custom domain and HTTPS',
		{ tags: [ 'e2e' ], timeout: 120_000 },
		async () => {
			env = setupCliEnv();
			const siteName = 'Domain E2E Site';
			const sitePath = path.join( env.sitesDir, 'domain-e2e-site' );
			const customDomain = 'custom-e2e.local';

			const result = await runCli(
				[
					'create',
					'--name',
					siteName,
					'--path',
					sitePath,
					'--wp',
					'latest',
					'--domain',
					customDomain,
					'--https',
					'--no-start',
					'--skip-browser',
					'--skip-log-details',
				],
				env
			);

			expect( result.code, result.stderr ).toBe( 0 );

			// --no-start skips the hosts-file / certificate setup that running would do,
			// so this only checks the custom domain and HTTPS preference are persisted.
			const config = readCliConfig( env );
			expect( config.sites ).toHaveLength( 1 );
			const [ site ] = config.sites;
			expect( site.name ).toBe( siteName );
			expect( site.customDomain ).toBe( customDomain );
			expect( site.enableHttps ).toBe( true );
			expect( site.running ).toBe( false );

			expect( fs.existsSync( path.join( sitePath, 'wp-load.php' ) ) ).toBe( true );
		}
	);
} );
