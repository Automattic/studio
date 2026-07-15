/**
 * @vitest-environment node
 *
 * Real end-to-end tests for `studio import`: unlike import.test.ts (which
 * mocks the importer and config layer), this spawns the built CLI and imports
 * each supported minimal backup fixture into a real site, asserting the
 * imported theme and database on disk and through WP-CLI.
 *
 * The fixtures under test-fixtures/backups/ were generated from a demo Studio
 * site (blog name "MyPet") with a custom theme, so each test can prove the
 * site serves the backup's content rather than a fresh install — see
 * test-fixtures/backups/readme.md for their provenance and structure.
 *
 * Requires the CLI to be built first (`npm run cli:build`); the suite skips
 * itself otherwise. Tagged `e2e` so it runs in the slower (release/manual)
 * suite rather than on every PR — run with `npm test -- --tagsFilter='e2e'`.
 */
import fs from 'fs';
import path from 'path';
import * as tar from 'tar';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	cleanupCliEnv,
	cliE2ePrerequisitesMet,
	runCli,
	setupCliEnv,
	type CliEnv,
} from '../site/tests/helpers/cli-e2e';

// Repo root is four levels up from apps/cli/commands/tests.
const FIXTURES_DIR = path.resolve(
	import.meta.dirname,
	'..',
	'..',
	'..',
	'..',
	'test-fixtures',
	'backups'
);
const FIXTURE_BLOGNAME = 'MyPet';

const BACKUP_FIXTURES = [
	{ format: 'Jetpack', file: 'jetpack-backup.tar.gz' },
	{ format: 'Local', file: 'local-backup.zip' },
	{ format: 'Playground', file: 'playground-backup.zip' },
	{ format: 'All-in-One WP Migration', file: 'aio-backup.wpress' },
] as const;

/**
 * `--runtime sandbox` keeps the run hermetic; `--no-start` defers the slow
 * WordPress install — `studio import` works against the stopped site.
 */
async function createStoppedSite( env: CliEnv, name: string, dirName: string ): Promise< string > {
	const sitePath = path.join( env.sitesDir, dirName );
	const result = await runCli(
		[
			'site',
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

/**
 * Whether the CLI reports the site at `sitePath` as running, via
 * `studio site list --format json` (stdout is clean JSON; progress goes to stderr).
 */
async function isSiteRunningPerCliList( env: CliEnv, sitePath: string ): Promise< boolean > {
	const result = await runCli( [ 'site', 'list', '--format', 'json' ], env );
	expect( result.code, result.stderr ).toBe( 0 );
	const sites = JSON.parse( result.stdout.trim() ) as Array< {
		path?: string;
		running?: boolean;
	} >;
	return sites.find( ( site ) => site.path === sitePath )?.running === true;
}

async function getBlogname( env: CliEnv, sitePath: string ): Promise< string | undefined > {
	const result = await runCli( [ 'wp', 'option', 'get', 'blogname', '--path', sitePath ], env );
	expect( result.code, result.stderr ).toBe( 0 );
	// PHP notices can precede the value on stdout, so assert against the last
	// non-empty line rather than the whole buffer.
	const lines = result.stdout
		.split( '\n' )
		.map( ( line ) => line.trim() )
		.filter( Boolean );
	return lines.at( -1 );
}

/** The backup's wp-content and database landed on disk. */
function assertImportedSiteOnDisk( sitePath: string ): void {
	expect( fs.existsSync( path.join( sitePath, 'wp-content', 'themes', 'mypet-theme' ) ) ).toBe(
		true
	);
	const databasePath = path.join( sitePath, 'wp-content', 'database', '.ht.sqlite' );
	expect( fs.existsSync( databasePath ) ).toBe( true );
	expect( fs.statSync( databasePath ).size ).toBeGreaterThan( 0 );
}

describe.skipIf( ! cliE2ePrerequisitesMet() )( 'CLI e2e: studio import', () => {
	let env: CliEnv | undefined;

	beforeAll( () => {
		env = setupCliEnv();
	} );

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

	for ( const { format, file } of BACKUP_FIXTURES ) {
		it(
			`imports a ${ format } backup into a stopped site`,
			{ tags: [ 'e2e' ], timeout: 240_000 },
			async () => {
				if ( ! env ) {
					throw new Error( 'CLI e2e env was not initialised' );
				}

				const sitePath = await createStoppedSite(
					env,
					`${ format } Import E2E Site`,
					`import-${ file.split( '.' )[ 0 ] }`
				);

				const result = await runCli(
					[ 'import', path.join( FIXTURES_DIR, file ), '--path', sitePath ],
					env
				);
				expect( result.code, result.stderr ).toBe( 0 );

				assertImportedSiteOnDisk( sitePath );
				expect( await getBlogname( env, sitePath ) ).toBe( FIXTURE_BLOGNAME );
			}
		);
	}

	it(
		'imports a backup into a running site and restores it to running',
		{ tags: [ 'e2e' ], timeout: 300_000 },
		async () => {
			if ( ! env ) {
				throw new Error( 'CLI e2e env was not initialised' );
			}

			const sitePath = await createStoppedSite(
				env,
				'Running Import E2E Site',
				'import-into-running-site'
			);
			const startResult = await runCli(
				[ 'site', 'start', '--path', sitePath, '--skip-browser', '--skip-log-details' ],
				env
			);
			expect( startResult.code, startResult.stderr ).toBe( 0 );
			expect( await isSiteRunningPerCliList( env, sitePath ) ).toBe( true );

			const result = await runCli(
				[ 'import', path.join( FIXTURES_DIR, 'local-backup.zip' ), '--path', sitePath ],
				env
			);
			expect( result.code, result.stderr ).toBe( 0 );

			// Importing into a running site stops it first, then restores the
			// running state after the import completes.
			expect( await isSiteRunningPerCliList( env, sitePath ) ).toBe( true );
			assertImportedSiteOnDisk( sitePath );
			expect( await getBlogname( env, sitePath ) ).toBe( FIXTURE_BLOGNAME );
		}
	);

	// Regression test for https://github.com/Automattic/studio/issues/3518
	// where db.php overwrites SQLite drop-in during restore causing database import error
	// "Could not determine the version of the SQLite integration plugin".
	it(
		'imports a backup containing db.php drop-in',
		{ tags: [ 'e2e' ], timeout: 300_000 },
		async () => {
			if ( ! env ) {
				throw new Error( 'CLI e2e env was not initialised' );
			}

			const workDir = path.join( env.root, 'db-php' );
			const cwd = path.join( workDir, 'contents' );
			fs.mkdirSync( cwd, { recursive: true } );
			await tar.x( { file: path.join( FIXTURES_DIR, 'jetpack-backup.tar.gz' ), cwd } );

			fs.writeFileSync(
				path.join( cwd, 'wp-content', 'db.php' ),
				'<?php\n/**\n * Plugin Name: Query Monitor Database Class (Drop-in)\n */\nclass QM_DB extends wpdb {}\n'
			);

			const file = path.join( workDir, 'jetpack-backup-db-php-replaced.tar.gz' );
			await tar.c( { file, cwd, gzip: true }, fs.readdirSync( cwd ) );
			const sitePath = await createStoppedSite(
				env,
				'Foreign DB Import E2E Site',
				'import-db-php'
			);

			const result = await runCli( [ 'import', file, '--path', sitePath ], env );
			expect( result.code, result.stderr ).toBe( 0 );

			const db = fs.readFileSync( path.join( sitePath, 'wp-content', 'db.php' ), 'utf8' );
			expect( db ).toContain( 'SQLITE_DB_DROPIN_VERSION' );
			expect( db ).not.toContain( 'QM_DB' );

			assertImportedSiteOnDisk( sitePath );
			expect( await getBlogname( env, sitePath ) ).toBe( FIXTURE_BLOGNAME );
		}
	);
} );
