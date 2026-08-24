/**
 * @vitest-environment node
 *
 * Localization logic against the built CLI, migrated from
 * `apps/studio/e2e/localization.test.ts`. The desktop suite drives the settings
 * UI; the locale-to-site logic is UI-independent and lives here: the CLI reads
 * the Studio locale persisted in `shared.json` and applies it to a created site.
 * RTL rendering and the settings flow stay in the renderer tests.
 *
 * Needs `npm run cli:build` and the bundled WordPress under `~/.studio/server-files`;
 * the suite skips itself otherwise. Creating a non-English site downloads its
 * language pack from wordpress.org, so this case needs network access.
 */
import fs from 'fs';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	cleanupCliEnv,
	cliE2ePrerequisitesMet,
	runCli,
	setupCliEnv,
	type CliEnv,
} from './helpers/cli-e2e';

const LOCALE = 'ja';

describe.skipIf( ! cliE2ePrerequisitesMet() )( 'CLI e2e: localization', () => {
	let env: CliEnv;
	let sitePath: string;

	beforeAll( async () => {
		env = setupCliEnv();
		sitePath = path.join( env.sitesDir, 'localized-e2e-site' );

		// The Studio locale the desktop app persists; the CLI reads it from here.
		fs.writeFileSync(
			path.join( env.configDir, 'shared.json' ),
			JSON.stringify( { version: 1, locale: LOCALE } )
		);

		const result = await runCli(
			[
				'create',
				'--name',
				'Localized E2E Site',
				'--path',
				sitePath,
				'--wp',
				'latest',
				'--runtime',
				'sandbox',
				'--skip-browser',
				'--skip-log-details',
			],
			env
		);
		expect( result.code, result.stderr ).toBe( 0 );
	}, 240_000 );

	afterAll( async () => {
		if ( ! env ) {
			return;
		}
		await runCli( [ 'site', 'stop', '--all' ], env );
		cleanupCliEnv( env );
	}, 60_000 );

	it(
		"created site's WPLANG matches the Studio locale",
		{ tags: [ 'e2e' ], timeout: 120_000 },
		async () => {
			const result = await runCli( [ 'wp', 'option', 'get', 'WPLANG', '--path', sitePath ], env );
			expect( result.code, result.stderr ).toBe( 0 );
			const value = result.stdout
				.split( '\n' )
				.map( ( line ) => line.trim() )
				.filter( Boolean )
				.at( -1 );
			expect( value ).toBe( LOCALE );
		}
	);
} );
