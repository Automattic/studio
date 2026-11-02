import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { postCopies, postCopiesFact } from '@studio/agent/node/post-copies';
import { SiteChanges } from '@studio/agent/node/site-changes';
import { readWordPressSite } from '@studio/agent/node/site-database';
import { siteSettingsCopy } from '@studio/agent/node/site-settings-copy';
import { describe, expect, it, vi } from 'vitest';
import { liveHost, liveSite } from 'cli/ai/tests/live-host';
import type { HostSite } from '@studio/agent/node';

let site: HostSite;
vi.mock( 'cli/lib/cli-config/sites', () => ( {
	findSiteByFolder: vi.fn( async ( folder: string ) =>
		folder === site.path ? site : undefined
	),
} ) );

const WORDPRESS = process.env.STUDIO_TEST_WORDPRESS;

// eval10: every build set the title, tagline and homepage with one
// `studio wp option update` after another, each a request of its own.
describe.runIf( WORDPRESS )( 'the settings copy saved to a real WordPress', () => {
	it( 'saves a new page and the homepage naming it by its slug, written together', async () => {
		const root = mkdtempSync( path.join( os.tmpdir(), 'settings-copy-' ) );
		const config = mkdtempSync( path.join( os.tmpdir(), 'studio-config-' ) );
		vi.stubEnv( 'DEV_CONFIG_DIR', config );
		cpSync( WORDPRESS!, root, { recursive: true } );
		site = liveSite( root, 'Spoke', 'live' );
		const host = liveHost( site );
		const option = async ( name: string ) =>
			(
				await host.sites.wpCli( site, [ 'eval', `echo get_option( '${ name }' );` ] )
			).stdout.trim();
		try {
			const fact = await readWordPressSite( root, ( wp ) => postCopiesFact( wp, host ) );
			const workspace = path.join( config, 'workspace', 'live' );
			expect( fact ).toContain( `${ workspace }/settings.json` );
			const check = new SiteChanges( host, undefined, async () => [ site ], [
				postCopies,
				siteSettingsCopy,
			] );
			await check.snapshot();
			const settings = path.join( workspace, 'settings.json' );
			const copy = JSON.parse( readFileSync( settings, 'utf8' ) );
			expect( copy.blogname ).toBe( await option( 'blogname' ) );

			writeFileSync(
				path.join( workspace, 'page', 'welcome-home.html' ),
				'<!-- wp:paragraph --><p>Hi</p><!-- /wp:paragraph -->'
			);
			writeFileSync(
				settings,
				JSON.stringify( {
					...copy,
					blogname: 'Spoke & Chain',
					blogdescription: 'Bike repair',
					show_on_front: 'page',
					page_on_front: 'welcome-home',
				} )
			);
			const { summaries, problems } = await check.settle();
			expect( problems ).toEqual( [] );
			// Saved are the options it changed: this site's homepage was a page already.
			expect( summaries ).toContain(
				`Spoke: Studio saved blogname, blogdescription, page_on_front from ${ settings } (update_option()).`
			);
			const home = await host.sites.wpCli( site, [
				'eval',
				"echo get_page_by_path( 'welcome-home' )->ID;",
			] );
			expect( await option( 'page_on_front' ) ).toBe( home.stdout.trim() );
			// Saved as Settings saves it, escaped (sanitize_option()), and copied as it shows it.
			expect( await option( 'blogname' ) ).toBe( 'Spoke &amp; Chain' );
			expect( JSON.parse( readFileSync( settings, 'utf8' ) ) ).toMatchObject( {
				blogname: 'Spoke & Chain',
				page_on_front: Number( home.stdout.trim() ),
			} );
			// eval11 wpbest 1: the model read a hidden .settings.json beside it as the settings.
			expect( readdirSync( workspace ).filter( ( name ) => name.includes( 'settings' ) ) ).toEqual(
				[ 'settings.json' ]
			);
			// The copy as saved is no change.
			expect( ( await check.settle() ).summaries ).toEqual( [] );
		} finally {
			vi.unstubAllEnvs();
			rmSync( root, { recursive: true, force: true } );
			rmSync( config, { recursive: true, force: true } );
		}
	}, 120000 );
} );
