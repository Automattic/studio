/**
 * @vitest-environment node
 *
 * Real end-to-end tests for Studio's site-management operations: renaming a
 * site, changing its PHP version, updating the WordPress site title, and
 * deleting a site (with and without removing its files). Unlike the unit
 * suites that mock the daemon and config layer, this spawns the built CLI and
 * asserts the real persisted state in cli.json and on disk.
 *
 * Requires the CLI to be built first (`npm run cli:build`); the suite skips
 * itself otherwise. Tagged `e2e` so it runs in the slower (release/manual)
 * suite rather than on every PR — run with `npm test -- --tagsFilter='e2e'`.
 */
import fs from 'fs';
import path from 'path';
import { SupportedPHPVersions } from '@studio/common/types/php-versions';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
	cleanupCliEnv,
	cliE2ePrerequisitesMet,
	readCliConfig,
	runCli,
	setupCliEnv,
	type CliEnv,
} from './helpers/cli-e2e';

function findSite( env: CliEnv, sitePath: string ): Record< string, unknown > | undefined {
	return readCliConfig( env ).sites.find( ( site ) => site.path === sitePath );
}

/**
 * `--runtime sandbox` keeps the run hermetic; `--no-start` defers the slow
 * WordPress install, so callers needing a live WordPress start the site.
 */
async function createStoppedSite( env: CliEnv, name: string, dirName: string ): Promise< string > {
	const sitePath = path.join( env.sitesDir, dirName );
	const result = await runCli(
		[
			'create',
			'--name',
			name,
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
	return sitePath;
}

describe.skipIf( ! cliE2ePrerequisitesMet() )( 'CLI e2e: studio site management', () => {
	// The edit cases are independent, so create the site once (a slow WordPress
	// copy) and run them in order against it.
	describe( 'editing a site', () => {
		let env: CliEnv | undefined;
		let sitePath = '';

		beforeAll( async () => {
			env = setupCliEnv();
			sitePath = await createStoppedSite( env, 'Editable E2E Site', 'editable-e2e-site' );
		}, 120_000 );

		afterAll( async () => {
			if ( ! env ) {
				return;
			}
			await runCli( [ 'site', 'stop', '--all' ], env );
			cleanupCliEnv( env );
			env = undefined;
		}, 60_000 );

		it( 'renames a site via site set --name', { tags: [ 'e2e' ], timeout: 60_000 }, async () => {
			if ( ! env ) {
				throw new Error( 'CLI e2e env was not initialised' );
			}

			const newName = 'Renamed E2E Site';
			const result = await runCli( [ 'site', 'set', '--path', sitePath, '--name', newName ], env );
			expect( result.code, result.stderr ).toBe( 0 );

			expect( findSite( env, sitePath )?.name ).toBe( newName );
		} );

		it(
			'changes the PHP version via site set --php',
			{ tags: [ 'e2e' ], timeout: 60_000 },
			async () => {
				if ( ! env ) {
					throw new Error( 'CLI e2e env was not initialised' );
				}

				const currentPhp = findSite( env, sitePath )?.phpVersion;
				const targetPhp = SupportedPHPVersions.find( ( version ) => version !== currentPhp );
				if ( ! targetPhp ) {
					throw new Error( 'No alternative supported PHP version available to test against' );
				}

				const result = await runCli(
					[ 'site', 'set', '--path', sitePath, '--php', targetPhp ],
					env
				);
				expect( result.code, result.stderr ).toBe( 0 );

				expect( findSite( env, sitePath )?.phpVersion ).toBe( targetPhp );
			}
		);

		it(
			'updates the WordPress site title via wp option update blogname',
			{ tags: [ 'e2e' ], timeout: 180_000 },
			async () => {
				if ( ! env ) {
					throw new Error( 'CLI e2e env was not initialised' );
				}

				// blogname lives in the WordPress database, which only exists once the site
				// has been started — `create --no-start` copies core files but defers the
				// WordPress install to the first server start.
				const startResult = await runCli(
					[ 'site', 'start', '--path', sitePath, '--skip-browser', '--skip-log-details' ],
					env
				);
				expect( startResult.code, startResult.stderr ).toBe( 0 );

				const newTitle = 'Renamed via WP-CLI';
				const updateResult = await runCli(
					[ 'wp', 'option', 'update', 'blogname', newTitle, '--path', sitePath ],
					env
				);
				expect( updateResult.code, updateResult.stderr ).toBe( 0 );

				const getResult = await runCli(
					[ 'wp', 'option', 'get', 'blogname', '--path', sitePath ],
					env
				);
				expect( getResult.code, getResult.stderr ).toBe( 0 );
				// PHP deprecation notices can precede the value on stdout, so assert
				// against the last non-empty line rather than the whole buffer.
				const lines = getResult.stdout
					.split( '\n' )
					.map( ( line ) => line.trim() )
					.filter( Boolean );
				expect( lines.at( -1 ) ).toBe( newTitle );
			}
		);
	} );

	// Deleting is destructive, so each case gets its own freshly created site.
	describe( 'deleting a site', () => {
		let env: CliEnv | undefined;

		afterEach( async () => {
			if ( ! env ) {
				return;
			}
			await runCli( [ 'site', 'stop', '--all' ], env );
			cleanupCliEnv( env );
			env = undefined;
		}, 60_000 );

		it(
			'deletes a site but keeps its files with --no-files',
			{ tags: [ 'e2e' ], timeout: 120_000 },
			async () => {
				env = setupCliEnv();
				const sitePath = await createStoppedSite(
					env,
					'Keep Files E2E Site',
					'keep-files-e2e-site'
				);
				expect( findSite( env, sitePath ) ).toBeTruthy();

				const result = await runCli( [ 'site', 'delete', '--path', sitePath, '--no-files' ], env );
				expect( result.code, result.stderr ).toBe( 0 );

				expect( findSite( env, sitePath ) ).toBeUndefined();
				expect( fs.existsSync( path.join( sitePath, 'wp-load.php' ) ) ).toBe( true );
			}
		);

		it(
			'deletes a site and removes its directory',
			{ tags: [ 'e2e' ], timeout: 120_000 },
			async () => {
				env = setupCliEnv();
				const sitePath = await createStoppedSite(
					env,
					'Remove Files E2E Site',
					'remove-files-e2e-site'
				);
				expect( findSite( env, sitePath ) ).toBeTruthy();
				expect( fs.existsSync( sitePath ) ).toBe( true );

				const result = await runCli( [ 'site', 'delete', '--path', sitePath ], env );
				expect( result.code, result.stderr ).toBe( 0 );

				// Default delete moves the directory to trash, so it's gone from disk.
				expect( findSite( env, sitePath ) ).toBeUndefined();
				expect( fs.existsSync( sitePath ) ).toBe( false );
			}
		);
	} );
} );
