/**
 * @vitest-environment node
 *
 * `studio export-static` exports a site that has its own copy of Simply Static installed, with
 * settings of its own, through Studio's bundled copy.
 *
 * Needs the CLI built first (skips otherwise). Tagged `e2e`:
 * `npm test -- --tagsFilter='e2e'`.
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
} from '../site/tests/helpers/cli-e2e';

const SIMPLY_STATIC_ZIP = path.resolve(
	import.meta.dirname,
	'../../../../wp-files/simply-static.zip'
);

describe.skipIf( ! cliE2ePrerequisitesMet() )( 'CLI e2e: export-static', () => {
	let env: CliEnv | undefined;
	let sitePath = '';

	async function cli( ...args: string[] ) {
		const result = await runCli( args, env! );
		expect( result.code, result.stderr ).toBe( 0 );
		return result;
	}

	beforeAll( async () => {
		env = setupCliEnv();
		sitePath = path.join( env.sitesDir, 'export-static-e2e-site' );
		await cli(
			'site',
			'create',
			'--name',
			'Export Static E2E Site',
			'--path',
			sitePath,
			'--wp',
			'latest',
			'--skip-browser',
			'--skip-log-details'
		);
	}, 300_000 );

	afterAll( async () => {
		if ( ! env ) {
			return;
		}
		await runCli( [ 'site', 'stop', '--all' ], env );
		cleanupCliEnv( env );
		env = undefined;
	}, 60_000 );

	it(
		"exports a site with Simply Static installed, ignoring the site's own settings",
		{ tags: [ 'e2e' ], timeout: 300_000 },
		async () => {
			await cli( 'wp', '--path', sitePath, 'plugin', 'install', SIMPLY_STATIC_ZIP, '--activate' );
			await cli(
				'wp',
				'--path',
				sitePath,
				'option',
				'update',
				'simply-static',
				'{"origin_url":"https://example.org","delivery_method":"zip"}',
				'--format=json'
			);

			const outputDir = path.join( env!.root, 'output' );
			await cli( 'export-static', outputDir, '--path', sitePath );

			const home = fs.readFileSync( path.join( outputDir, 'index.html' ), 'utf8' );
			expect( home.match( /https?:\/\/(localhost|example\.org)[^"' ]*/g ) ).toBeNull();
			expect( fs.existsSync( path.join( outputDir, 'wp-content', 'themes' ) ) ).toBe( true );
		}
	);
} );
