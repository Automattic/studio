/**
 * @vitest-environment node
 *
 * Site navigation and content actions against the built CLI (`npm run cli:build` first),
 * migrated from `apps/studio/e2e/site-navigation.test.ts`; auto-login stays in the UI suite.
 */
import fs from 'fs';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	cleanupCliEnv,
	cliE2ePrerequisitesMet,
	readCliConfig,
	runCli,
	setupCliEnv,
	waitForSiteResponse,
	type CliEnv,
} from './helpers/cli-e2e';

// 1x1 red-pixel PNG, the smallest valid image for `wp media import`.
const TINY_PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVQImWP4z8AAAAMBAQAY3YN1AAAAAElFTkSuQmCC',
	'base64'
);

describe.skipIf( ! cliE2ePrerequisitesMet() )( 'CLI e2e: site navigation', () => {
	let env: CliEnv;
	let sitePath: string;
	let siteUrl: string;

	// All cases share one running site; creating and starting WordPress is the
	// slow part.
	beforeAll( async () => {
		env = setupCliEnv();
		sitePath = path.join( env.sitesDir, 'navigation-e2e-site' );

		const result = await runCli(
			[
				'create',
				'--name',
				'Navigation E2E Site',
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

		const [ site ] = readCliConfig( env ).sites;
		siteUrl = `http://localhost:${ String( site.port ) }`;
	}, 240_000 );

	afterAll( async () => {
		if ( ! env ) {
			return;
		}
		await runCli( [ 'site', 'stop', '--all' ], env );
		cleanupCliEnv( env );
	}, 60_000 );

	/** Runs `studio wp <args>` against the shared site, asserts exit 0, and returns stdout. */
	async function wp( ...args: string[] ): Promise< string > {
		const result = await runCli( [ 'wp', ...args, '--path', sitePath ], env );
		expect( result.code, result.stderr ).toBe( 0 );
		return result.stdout;
	}

	it( 'opens site at homepage', { tags: [ 'e2e' ], timeout: 60_000 }, async () => {
		const response = await waitForSiteResponse( siteUrl, { expectedStatus: 200 } );
		expect( response.status ).toBe( 200 );
		expect( response.headers.get( 'content-type' ) ).toMatch( /text\/html/ );

		const body = await response.text();
		expect( body ).toContain( 'wp-' );
		expect( body ).toMatch( /<title>[^<]+<\/title>/ );
	} );

	it( 'serves wp-admin behind the login screen', { tags: [ 'e2e' ], timeout: 60_000 }, async () => {
		// Unauthenticated wp-admin must bounce to the login form — proves both
		// wp-admin routing and auth work. Auto-login itself is desktop-only.
		const adminResponse = await waitForSiteResponse( `${ siteUrl }/wp-admin/` );
		expect( adminResponse.status ).toBe( 302 );
		expect( adminResponse.headers.get( 'location' ) ).toContain( 'wp-login.php' );

		const loginResponse = await waitForSiteResponse( `${ siteUrl }/wp-login.php` );
		expect( loginResponse.status ).toBe( 200 );
		expect( await loginResponse.text() ).toContain( 'loginform' );
	} );

	it( 'creates a post', { tags: [ 'e2e' ], timeout: 120_000 }, async () => {
		await wp(
			'post',
			'create',
			'--post_title=E2E Test Post',
			'--post_content=This is a test post created by automated E2E tests.',
			'--post_status=publish'
		);

		const titles = await wp( 'post', 'list', '--post_type=post', '--field=post_title' );
		expect( titles ).toContain( 'E2E Test Post' );
	} );

	it( 'uploads media', { tags: [ 'e2e' ], timeout: 120_000 }, async () => {
		// Playground wp-cli only mounts the site directory (its cwd), so the
		// file must live there and be passed as a relative path.
		fs.writeFileSync( path.join( sitePath, 'e2e-test-image.png' ), TINY_PNG );

		await wp( 'media', 'import', 'e2e-test-image.png' );

		const attachments = await wp( 'post', 'list', '--post_type=attachment', '--field=post_title' );
		expect( attachments ).toContain( 'e2e-test-image' );
	} );

	it( 'activates themes', { tags: [ 'e2e' ], timeout: 120_000 }, async () => {
		// Bundled WordPress ships several default themes, so activating an
		// inactive one needs no network.
		await wp( 'theme', 'activate', 'twentytwentyfour' );

		const active = await wp( 'theme', 'list', '--status=active', '--field=name' );
		expect( active ).toContain( 'twentytwentyfour' );
	} );

	it( 'adds new themes', { tags: [ 'e2e' ], timeout: 180_000 }, async () => {
		await wp( 'theme', 'install', 'twentytwentytwo' );

		const themes = await wp( 'theme', 'list', '--field=name' );
		expect( themes ).toContain( 'twentytwentytwo' );
	} );

	it( 'activates plugin', { tags: [ 'e2e' ], timeout: 120_000 }, async () => {
		// Hello Dolly ships with WordPress (slug `hello`).
		await wp( 'plugin', 'activate', 'hello' );

		const active = await wp( 'plugin', 'list', '--status=active', '--field=name' );
		expect( active ).toContain( 'hello' );
	} );

	it( 'adds new plugin', { tags: [ 'e2e' ], timeout: 180_000 }, async () => {
		await wp( 'plugin', 'install', 'classic-editor' );

		const plugins = await wp( 'plugin', 'list', '--field=name' );
		expect( plugins ).toContain( 'classic-editor' );
	} );

	it( '"Post name" permalink structure works', { tags: [ 'e2e' ], timeout: 120_000 }, async () => {
		// `wp rewrite structure` spawns a child `wp rewrite flush` process, which hangs
		// under Playground; set the option and clear the cached rules instead.
		await wp( 'option', 'update', 'permalink_structure', '/%postname%/' );
		await wp( 'option', 'delete', 'rewrite_rules' );

		await wp(
			'post',
			'create',
			'--post_title=Permalink Test Post',
			'--post_content=Testing permalink structure.',
			'--post_status=publish'
		);

		const response = await waitForSiteResponse( `${ siteUrl }/permalink-test-post/` );
		expect( response.status ).toBe( 200 );
		const body = await response.text();
		expect( body ).toContain( 'Permalink Test Post' );
		expect( body ).toContain( 'Testing permalink structure.' );
	} );
} );
