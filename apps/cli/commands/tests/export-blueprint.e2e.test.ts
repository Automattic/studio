/** @vitest-environment node */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
	extractBlueprintBundle,
	cleanupBlueprintTempDir,
} from '@studio/common/sites/blueprint-extract';
import { afterEach, describe, expect, it } from 'vitest';
import {
	autoLoginCookie,
	cleanupCliEnv,
	cliE2ePrerequisitesMet,
	readCliConfig,
	runCli,
	setupCliEnv,
	waitForSiteResponse,
	type CliEnv,
} from '../site/tests/helpers/cli-e2e';

describe.skipIf( ! cliE2ePrerequisitesMet() )( 'Blueprint snapshot export', () => {
	let env: CliEnv | undefined;
	let sourceDatabase: DatabaseSync | undefined;
	afterEach( async () => {
		sourceDatabase?.close();
		sourceDatabase = undefined;
		if ( ! env ) return;
		await runCli( [ 'site', 'stop', '--all' ], env );
		cleanupCliEnv( env );
	}, 60_000 );

	it.each( [ true, false ] )(
		'recreates a configured site (source running: %s)',
		{ tags: [ 'e2e' ], timeout: 180_000 },
		async ( running ) => {
			env = setupCliEnv();
			const source = path.join( env.sitesDir, 'source' );
			const destination = path.join( env.sitesDir, 'destination' );
			const cli = async ( ...args: string[] ) => {
				const result = await runCli( args, env! );
				expect( result.code, result.stderr + result.stdout ).toBe( 0 );
				return result.stdout.trim();
			};
			const wp = ( sitePath: string, ...args: string[] ) =>
				cli( 'wp', ...args, '--path', sitePath );
			await cli(
				'site',
				'create',
				'--name',
				'Blueprint Source',
				'--path',
				source,
				'--wp',
				'latest',
				'--no-start',
				'--skip-browser'
			);
			if ( ! running ) {
				await wp(
					source,
					'config',
					'create',
					'--dbname=wordpress',
					'--dbuser=root',
					'--dbprefix=custom_',
					'--skip-check'
				);
			}
			await cli( 'site', 'start', '--path', source, '--skip-browser' );
			const sourceSite = readCliConfig( env ).sites.find( ( site ) => site.path === source )!;
			const sourceUrl = `http://localhost:${ sourceSite.port }`;
			fs.mkdirSync( path.join( source, 'wp-content/uploads' ), { recursive: true } );
			fs.writeFileSync( path.join( source, 'wp-content/uploads/example.txt' ), 'Blueprint media' );
			fs.writeFileSync(
				path.join( source, 'wp-content/plugins/example.php' ),
				'<?php\n/* Plugin Name: Blueprint Example */\n'
			);
			await wp( source, 'plugin', 'activate', 'example' );
			fs.mkdirSync( path.join( source, 'wp-content/themes/blueprint-theme' ), { recursive: true } );
			fs.writeFileSync(
				path.join( source, 'wp-content/themes/blueprint-theme/style.css' ),
				'/* Theme Name: Blueprint Theme */'
			);
			fs.writeFileSync(
				path.join( source, 'wp-content/themes/blueprint-theme/index.php' ),
				'<?php echo "Blueprint theme";'
			);
			await wp( source, 'theme', 'activate', 'blueprint-theme' );
			await wp(
				source,
				'post',
				'create',
				'--post_title=Blueprint page',
				`--post_content=<a href="${ sourceUrl }/hello">Hello</a>`,
				'--post_status=publish',
				'--post_type=page'
			);
			await wp(
				source,
				'option',
				'update',
				'blueprint_settings',
				JSON.stringify( { nested: [ `${ sourceUrl }/example` ] } ),
				'--format=json'
			);
			const originalConfig = fs.readFileSync( path.join( source, 'wp-config.php' ), 'utf8' );
			if ( ! running ) await cli( 'site', 'stop', '--path', source );
			sourceDatabase = new DatabaseSync( path.join( source, 'wp-content/database/.ht.sqlite' ) );
			sourceDatabase.exec(
				"PRAGMA journal_mode=WAL; CREATE TABLE blueprint_snapshot_marker (value TEXT); INSERT INTO blueprint_snapshot_marker VALUES ('committed WAL data');"
			);
			const archive = path.join( env.root, 'example-blueprint.zip' );
			await cli( 'export', archive, '--path', source, '--mode', 'blueprint' );
			expect( fs.readFileSync( path.join( source, 'wp-config.php' ), 'utf8' ) ).toBe(
				originalConfig
			);
			const bundle = await extractBlueprintBundle( archive );
			try {
				expect( bundle.blueprintJson ).toMatchObject( {
					meta: { title: 'Blueprint Source' },
					steps: [
						{
							step: 'importWordPressFiles',
							wordPressFilesZip: { resource: 'bundled', path: 'site.zip' },
						},
					],
				} );
				bundle.blueprintJson.steps = [
					{
						step: 'runPHP',
						code: "<?php file_put_contents('/wordpress/before-snapshot.txt', 'Before snapshot');",
					},
					...( bundle.blueprintJson.steps ?? [] ),
					{ step: 'setSiteOptions', options: { blogdescription: 'After snapshot' } },
				];
				fs.writeFileSync( bundle.blueprintJsonPath, JSON.stringify( bundle.blueprintJson ) );
				await cli(
					'site',
					'create',
					'--name',
					'From Blueprint',
					'--path',
					destination,
					'--wp',
					'latest',
					'--blueprint',
					bundle.blueprintJsonPath,
					'--skip-browser',
					'--no-start'
				);
			} finally {
				await cleanupBlueprintTempDir( bundle.tempDir );
			}
			const destinationSite = readCliConfig( env ).sites.find(
				( site ) => site.path === destination
			)!;
			const destinationUrl = `http://localhost:${ destinationSite.port }`;
			const restoredDatabase = new DatabaseSync(
				path.join( destination, 'wp-content/database/.ht.sqlite' )
			);
			try {
				expect(
					restoredDatabase.prepare( 'SELECT value FROM blueprint_snapshot_marker' ).get()?.value
				).toBe( 'committed WAL data' );
			} finally {
				restoredDatabase.close();
			}
			expect( await wp( destination, 'option', 'get', 'siteurl' ) ).toContain( destinationUrl );
			expect(
				JSON.parse(
					await wp( destination, 'option', 'get', 'blueprint_settings', '--format=json' )
				)
			).toEqual( { nested: [ `${ destinationUrl }/example` ] } );
			expect( await wp( destination, 'option', 'get', 'blogdescription' ) ).toContain(
				'After snapshot'
			);
			expect( fs.readFileSync( path.join( destination, 'before-snapshot.txt' ), 'utf8' ) ).toBe(
				'Before snapshot'
			);
			expect( await wp( destination, 'option', 'get', 'stylesheet' ) ).toContain(
				'blueprint-theme'
			);
			expect(
				await wp( destination, 'config', 'get', 'table_prefix', '--type=variable' )
			).toContain( running ? 'wp_' : 'custom_' );
			expect(
				await wp( destination, 'post', 'list', '--post_type=page', '--field=post_title' )
			).toContain( 'Blueprint page' );
			expect( await wp( destination, 'plugin', 'is-active', 'example' ) ).toBeDefined();
			expect(
				fs.readFileSync( path.join( destination, 'wp-content/uploads/example.txt' ), 'utf8' )
			).toBe( 'Blueprint media' );
			await cli( 'site', 'start', '--path', destination, '--skip-browser' );
			const response = await waitForSiteResponse( destinationUrl, { expectedStatus: 200 } );
			expect( response.status ).toBe( 200 );
			expect( await autoLoginCookie( destinationUrl ) ).toContain( 'wordpress_logged_in' );
		}
	);
} );
