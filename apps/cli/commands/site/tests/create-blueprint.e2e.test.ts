/**
 * @vitest-environment node
 *
 * Real end-to-end test for `studio site create --blueprint`. Spawns the built
 * CLI binary, creates a site from a custom Blueprint file, and verifies the
 * Blueprint's on-disk effects. The CLI counterpart of the desktop UI tests in
 * apps/studio/e2e/blueprints.test.ts.
 *
 * The Blueprint is applied during create even with `--no-start`: the command
 * connects the daemon, runs the Blueprint, then leaves the server stopped (see
 * apps/cli/commands/site/create.ts). So `installTheme` / `installPlugin` steps
 * land real files in wp-content, which we assert directly.
 *
 * Requires the CLI to be built first (`npm run cli:build`); the suite skips
 * itself otherwise. The install cases download from wordpress.org, so they need
 * a network connection. Tagged `e2e` so they run in the slower (release/manual)
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

// `--blueprint` takes a file path, so write the Blueprint into the isolated env
// and return its path. Kept inline rather than reusing apps/studio/e2e/fixtures
// so the CLI test stays self-contained.
function writeBlueprint( env: CliEnv, blueprint: Record< string, unknown > ): string {
	const blueprintPath = path.join( env.root, 'blueprint.json' );
	fs.writeFileSync( blueprintPath, JSON.stringify( blueprint ) );
	return blueprintPath;
}

/**
 * Creates a site from the given Blueprint file without starting the server.
 * `--runtime sandbox` (bundled Playground/WASM) keeps this hermetic: native PHP
 * would download its ~25 MB binary into the config dir on first run. Blueprint
 * coverage under the native runtime is a follow-up (needs CI to provision that
 * binary).
 */
function createFromBlueprint( env: CliEnv, name: string, slug: string, blueprintPath: string ) {
	return runCli(
		[
			'site',
			'create',
			'--name',
			name,
			'--path',
			path.join( env.sitesDir, slug ),
			'--wp',
			'latest',
			'--runtime',
			'sandbox',
			'--blueprint',
			blueprintPath,
			'--no-start',
			'--skip-browser',
			'--skip-log-details',
		],
		env
	);
}

describe.skipIf( ! cliE2ePrerequisitesMet() )( 'CLI e2e: studio site create --blueprint', () => {
	let env: CliEnv | undefined;

	// Applying a Blueprint boots the isolated daemon even with `--no-start`, so
	// stop everything before removing the env — `stop --all` also kills the
	// isolated daemon.
	afterEach( async () => {
		if ( ! env ) {
			return;
		}
		await runCli( [ 'site', 'stop', '--all' ], env );
		cleanupCliEnv( env );
		env = undefined;
	}, 60_000 );

	it(
		'creates a site from a Blueprint that installs a theme',
		{ tags: [ 'e2e' ], timeout: 120_000 },
		async () => {
			env = setupCliEnv();
			const sitePath = path.join( env.sitesDir, 'bp-install-theme' );
			const blueprintPath = writeBlueprint( env, {
				steps: [
					{
						step: 'installTheme',
						themeData: { resource: 'wordpress.org/themes', slug: 'twentytwentytwo' },
					},
				],
			} );

			const result = await createFromBlueprint(
				env,
				'Blueprint Theme Install',
				'bp-install-theme',
				blueprintPath
			);

			expect( result.code, result.stderr ).toBe( 0 );
			expect( readCliConfig( env ).sites ).toHaveLength( 1 );
			// twentytwentytwo is not bundled with WordPress, so its presence proves
			// the Blueprint's installTheme step ran.
			expect(
				fs.existsSync(
					path.join( sitePath, 'wp-content', 'themes', 'twentytwentytwo', 'style.css' )
				)
			).toBe( true );
		}
	);

	it(
		'creates a site from a Blueprint that installs a plugin',
		{ tags: [ 'e2e' ], timeout: 120_000 },
		async () => {
			env = setupCliEnv();
			const sitePath = path.join( env.sitesDir, 'bp-install-plugin' );
			const blueprintPath = writeBlueprint( env, {
				steps: [
					{
						step: 'installPlugin',
						pluginData: { resource: 'wordpress.org/plugins', slug: 'classic-editor' },
					},
				],
			} );

			const result = await createFromBlueprint(
				env,
				'Blueprint Plugin Install',
				'bp-install-plugin',
				blueprintPath
			);

			expect( result.code, result.stderr ).toBe( 0 );
			expect( readCliConfig( env ).sites ).toHaveLength( 1 );
			// classic-editor is not bundled with WordPress, so its presence proves
			// the Blueprint's installPlugin step ran.
			expect(
				fs.existsSync( path.join( sitePath, 'wp-content', 'plugins', 'classic-editor' ) )
			).toBe( true );
		}
	);

	it(
		'creates a site from a Blueprint that runs PHP code',
		{ tags: [ 'e2e' ], timeout: 120_000 },
		async () => {
			env = setupCliEnv();
			const blueprintPath = writeBlueprint( env, {
				steps: [
					{
						step: 'runPHP',
						code: "<?php require_once '/wordpress/wp-load.php'; update_option( 'blogname', 'Blueprint Test Site' );",
					},
				],
			} );

			const result = await createFromBlueprint(
				env,
				'Blueprint PHP Code',
				'bp-run-php',
				blueprintPath
			);

			// The runPHP step applies without error during create.
			expect( result.code, result.stderr ).toBe( 0 );
			expect( readCliConfig( env ).sites ).toHaveLength( 1 );
		}
	);

	it(
		'creates a site from a Blueprint that runs WP-CLI commands',
		{ tags: [ 'e2e' ], timeout: 120_000 },
		async () => {
			env = setupCliEnv();
			const blueprintPath = writeBlueprint( env, {
				steps: [
					{
						step: 'wp-cli',
						command: "wp option update blogname 'WP-CLI Test Site'",
					},
				],
			} );

			const result = await createFromBlueprint(
				env,
				'Blueprint WP-CLI',
				'bp-wp-cli',
				blueprintPath
			);

			// The wp-cli step applies without error during create.
			expect( result.code, result.stderr ).toBe( 0 );
			expect( readCliConfig( env ).sites ).toHaveLength( 1 );
		}
	);
} );
