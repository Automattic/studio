/**
 * @vitest-environment node
 *
 * Overview "Customize" shortcuts against the built CLI (`npm run cli:build`
 * first), migrated from `apps/studio/e2e/overview-customize-links.test.ts`.
 * The desktop suite's button clicks and in-editor navigation are UI-only, so
 * this keeps the headless-verifiable core: a block theme is active and every
 * Site Editor route the buttons target is served.
 */
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

// Server-side every route is the same core admin file; the `path=` query is a
// client-only hint the Site Editor reads post-login.
const CUSTOMIZE_ROUTES = [
	{ label: 'Site Editor', route: '/wp-admin/site-editor.php' },
	{ label: 'Styles', route: '/wp-admin/site-editor.php?path=%2Fwp_global_styles' },
	{ label: 'Patterns', route: '/wp-admin/site-editor.php?path=%2Fpatterns' },
	{ label: 'Navigation', route: '/wp-admin/site-editor.php?path=%2Fnavigation' },
	{ label: 'Templates', route: '/wp-admin/site-editor.php?path=%2Fwp_template' },
	{ label: 'Pages', route: '/wp-admin/site-editor.php?path=%2Fpage' },
];

describe.skipIf( ! cliE2ePrerequisitesMet() )( 'CLI e2e: overview customize links', () => {
	let env: CliEnv;
	let sitePath: string;
	let siteUrl: string;

	beforeAll( async () => {
		env = setupCliEnv();
		sitePath = path.join( env.sitesDir, 'customize-links-e2e-site' );

		const result = await runCli(
			[
				'site',
				'create',
				'--name',
				'Customize Links E2E Site',
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

		// Poll the homepage to 200 so the proxy's warm-up 302 is gone before the
		// route checks assert on the real auth redirect (also a 302).
		await waitForSiteResponse( siteUrl, { expectedStatus: 200 } );
	}, 240_000 );

	afterAll( async () => {
		if ( ! env ) {
			return;
		}
		await runCli( [ 'site', 'stop', '--all' ], env );
		cleanupCliEnv( env );
	}, 60_000 );

	it( 'runs a block theme by default', { tags: [ 'e2e' ], timeout: 60_000 }, async () => {
		const result = await runCli(
			[ 'wp', 'eval', 'echo wp_is_block_theme() ? "yes" : "no";', '--path', sitePath ],
			env
		);
		expect( result.code, result.stderr ).toBe( 0 );
		expect( result.stdout ).toContain( 'yes' );
	} );

	it.each( CUSTOMIZE_ROUTES )(
		'serves the $label customize route',
		{ tags: [ 'e2e' ], timeout: 60_000 },
		async ( { route } ) => {
			// The route is served (not 404); unauthenticated it bounces to the login
			// screen, since auto-login is desktop-only.
			const response = await waitForSiteResponse( `${ siteUrl }${ route }` );
			expect( response.status ).toBe( 302 );
			expect( response.headers.get( 'location' ) ).toContain( 'wp-login.php' );
		}
	);
} );
