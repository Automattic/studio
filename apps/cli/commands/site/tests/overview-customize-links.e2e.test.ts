/**
 * @vitest-environment node
 *
 * Overview "Customize" shortcuts against the built CLI, migrated from
 * `apps/studio/e2e/overview-customize-links.test.ts`. Needs `npm run cli:build`
 * and the bundled WordPress under `~/.studio/server-files` (seeded by running
 * Studio once); the suite skips itself otherwise.
 * The desktop suite's button clicks are UI-only, but the URL each button opens
 * is reproducible headless: this logs in via `/studio-auto-login` and confirms
 * a block theme is active and every Site Editor route the buttons target loads
 * for an authenticated admin.
 */
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	autoLoginCookie,
	cleanupCliEnv,
	cliE2ePrerequisitesMet,
	readCliConfig,
	runCli,
	setupCliEnv,
	waitForSiteResponse,
	type CliEnv,
} from './helpers/cli-e2e';

// The Site Editor's server HTML is a shell it hydrates with JS; `id="site-editor"`
// is the mount root, present for every route. The `path=` query only steers the
// client, so headless we can confirm the editor loads but not the per-path view.
const SITE_EDITOR_MARKER = 'id="site-editor"';

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
	let cookie: string;

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

		const { sites } = readCliConfig( env );
		expect( sites ).toHaveLength( 1 );
		const [ site ] = sites;
		siteUrl = `http://localhost:${ String( site.port ) }`;

		// Poll the homepage to 200 so the proxy's warm-up 302 is gone before the
		// authenticated route checks.
		await waitForSiteResponse( siteUrl, { expectedStatus: 200 } );
		cookie = await autoLoginCookie( siteUrl );
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
		'loads the $label editor page for an authenticated admin',
		{ tags: [ 'e2e' ], timeout: 60_000 },
		async ( { route } ) => {
			// Follow redirects: WordPress canonicalizes the older `?path=` scheme to
			// `?p=`, so several of these routes 302 to the equivalent editor URL.
			const response = await fetch( `${ siteUrl }${ route }`, {
				headers: { Cookie: cookie },
				redirect: 'follow',
			} );
			expect( response.status ).toBe( 200 );
			expect( await response.text() ).toContain( SITE_EDITOR_MARKER );
		}
	);
} );
