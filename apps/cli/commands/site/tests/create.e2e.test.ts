/**
 * @vitest-environment node
 *
 * Real end-to-end test for `studio site create`. Unlike create.test.ts (which
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
	readConfigFile,
	runCli,
	setupCliEnv,
	waitForSiteResponse,
	type CliEnv,
} from './helpers/cli-e2e';

describe.skipIf( ! cliE2ePrerequisitesMet() )( 'CLI e2e: studio site create', () => {
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
		'creates a site that serves its homepage and signs in with its admin credentials',
		{ tags: [ 'e2e' ], timeout: 180_000 },
		async () => {
			env = setupCliEnv();
			const siteName = 'Custom E2E Site';
			const sitePath = path.join( env.sitesDir, 'custom-e2e-site' );

			const result = await runCli(
				[
					'site',
					'create',
					'--name',
					siteName,
					'--path',
					sitePath,
					'--wp',
					'latest',
					'--admin-username',
					'navigator',
					'--admin-password',
					'e2e-created-password',
					'--skip-browser',
					'--skip-log-details',
				],
				env
			);

			expect( result.code, result.stderr ).toBe( 0 );

			const config = readConfigFile( env );
			expect( config.sites ).toHaveLength( 1 );
			const [ site ] = config.sites;
			expect( site.name ).toBe( siteName );
			expect( site.path ).toBe( sitePath );
			expect( site.phpVersion ).toBeTruthy();
			expect( site.port ).toBeTruthy();

			expect( fs.existsSync( path.join( sitePath, 'wp-load.php' ) ) ).toBe( true );
			expect( fs.existsSync( path.join( sitePath, 'wp-includes', 'version.php' ) ) ).toBe( true );
			expect( fs.existsSync( path.join( sitePath, 'wp-config.php' ) ) ).toBe( true );

			// A freshly started site can return a warm-up 302 before serving, so poll for the 200.
			const response = await waitForSiteResponse( `http://localhost:${ String( site.port ) }`, {
				expectedStatus: 200,
			} );
			expect( response.status ).toBe( 200 );
			expect( response.headers.get( 'content-type' ) ).toMatch( /text\/html/ );

			const signIn = await fetch( `http://localhost:${ String( site.port ) }/wp-login.php`, {
				method: 'POST',
				headers: {
					'content-type': 'application/x-www-form-urlencoded',
					// wp-login.php rejects the sign-in without WordPress's test cookie.
					cookie: 'wordpress_test_cookie=WP%20Cookie%20check',
				},
				body: new URLSearchParams( { log: 'navigator', pwd: 'e2e-created-password' } ),
				redirect: 'manual',
			} );
			expect( signIn.headers.get( 'set-cookie' ) ).toContain( 'wordpress_logged_in' );
		}
	);

	it(
		'creates an installed site with a custom domain and HTTPS without starting it',
		{ tags: [ 'e2e' ], timeout: 120_000 },
		async () => {
			env = setupCliEnv();
			const siteName = 'Domain E2E Site';
			const sitePath = path.join( env.sitesDir, 'domain-e2e-site' );
			const customDomain = 'custom-e2e.local';

			const result = await runCli(
				[
					'site',
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
			const config = readConfigFile( env );
			expect( config.sites ).toHaveLength( 1 );
			const [ site ] = config.sites;
			expect( site.name ).toBe( siteName );
			expect( site.customDomain ).toBe( customDomain );
			expect( site.enableHttps ).toBe( true );

			expect( fs.existsSync( path.join( sitePath, 'wp-config.php' ) ) ).toBe( true );
			const siteUrl = await runCli( [ 'wp', '--path', sitePath, 'option', 'get', 'siteurl' ], env );
			expect( siteUrl.code, siteUrl.stderr ).toBe( 0 );
			expect( siteUrl.stdout.trim() ).toBe( `https://${ customDomain }` );
		}
	);
} );
