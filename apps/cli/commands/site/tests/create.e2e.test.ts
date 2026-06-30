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
	readCliConfig,
	runCli,
	setupCliEnv,
	type CliEnv,
} from './helpers/cli-e2e';

describe.skipIf( ! cliE2ePrerequisitesMet() )( 'CLI e2e: studio site create', () => {
	let env: CliEnv | undefined;

	afterEach( () => {
		if ( env ) {
			cleanupCliEnv( env );
			env = undefined;
		}
	} );

	it( 'creates a site with a custom name', { tags: [ 'e2e' ], timeout: 120_000 }, async () => {
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
				'--no-start',
				'--skip-browser',
				'--skip-log-details',
			],
			env
		);

		expect( result.code, result.stderr ).toBe( 0 );

		// The site is persisted to the real cli.json with the custom name.
		const config = readCliConfig( env );
		expect( config.sites ).toHaveLength( 1 );
		const [ site ] = config.sites;
		expect( site.name ).toBe( siteName );
		expect( site.path ).toBe( sitePath );
		expect( site.phpVersion ).toBeTruthy();
		expect( site.running ).toBe( false );

		// Real WordPress core files were copied into the site directory.
		// (wp-config.php is generated at server start, which --no-start skips.)
		expect( fs.existsSync( path.join( sitePath, 'wp-load.php' ) ) ).toBe( true );
		expect( fs.existsSync( path.join( sitePath, 'wp-includes', 'version.php' ) ) ).toBe( true );
	} );

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

			// The custom domain and HTTPS preference are persisted to cli.json.
			// (--no-start skips the hosts-file / certificate setup that running would do.)
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
