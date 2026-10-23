import { describe, expect, it, vi } from 'vitest';
import { SitePin } from '../site-pin';

const SITES = [
	{ name: 'Shop', path: '/sites/shop' },
	{ name: 'Blog', path: '/sites/blog' },
	{ name: 'New', path: '/sites/new' },
];

vi.mock( 'cli/lib/site-paths', () => ( { STUDIO_SITES_ROOT: '/sites' } ) );
vi.mock( 'cli/lib/cli-config/core', () => ( { readCliConfig: async () => ( { sites: SITES } ) } ) );
vi.mock( 'cli/ai/tools/utils', () => ( {
	resolveSite: async ( nameOrPath: string ) => {
		const site = SITES.find( ( s ) => s.name === nameOrPath || s.path === nameOrPath );
		if ( ! site ) throw new Error( 'not found' );
		return site;
	},
} ) );

const shop = { name: 'Shop', path: '/sites/shop', running: true };

describe( 'SitePin', () => {
	it( "changes the request's site without asking", async () => {
		const pin = new SitePin( shop );
		expect(
			await pin.confirmationFor( 'wp_cli', { nameOrPath: 'Shop', command: 'plugin install x' } )
		).toBeUndefined();
		expect(
			await pin.confirmationFor( 'Write', { path: '/sites/shop/wp-content/a.css' } )
		).toBeUndefined();
	} );

	it( 'asks before changing another site, once per site', async () => {
		const pin = new SitePin( shop );
		const ask = await pin.confirmationFor( 'Edit', { path: 'blog/wp-content/themes/t/style.css' } );
		expect( ask?.confirmation.question ).toBe(
			'Also change "Blog"? This request is about "Shop".'
		);
		ask?.allow();
		expect(
			await pin.confirmationFor( 'wp_cli', {
				nameOrPath: 'Blog',
				command: 'option update blogname B',
			} )
		).toBeUndefined();
	} );

	it( 'reads other sites freely', async () => {
		const pin = new SitePin( shop );
		expect(
			await pin.confirmationFor( 'wp_cli', { nameOrPath: 'Blog', command: 'option get blogname' } )
		).toBeUndefined();
		expect(
			await pin.confirmationFor( 'Read', { path: '/sites/blog/wp-config.php' } )
		).toBeUndefined();
		expect( await pin.confirmationFor( 'Write', { path: '/tmp/notes.md' } ) ).toBeUndefined();
	} );

	it( 'pins the first changed site when none is active, and includes sites the turn creates', async () => {
		const pin = new SitePin( null );
		expect( await pin.confirmationFor( 'scaffold_theme', { nameOrPath: 'Shop' } ) ).toBeUndefined();
		await pin.created( 'New' );
		expect( await pin.confirmationFor( 'Write', { path: '/sites/new/x.php' } ) ).toBeUndefined();
		expect(
			( await pin.confirmationFor( 'scaffold_theme', { nameOrPath: 'Blog' } ) )?.confirmation
				.question
		).toBe( 'Also change "Blog"? This request is about "Shop".' );
	} );

	it( 'asks before creating a site while the request has one, once', async () => {
		const pin = new SitePin( shop );
		const ask = await pin.confirmationFor( 'site_create', { name: "Joe's Bakery" } );
		expect( ask?.confirmation.question ).toBe(
			'Create a new site "Joe\'s Bakery"? This request is about "Shop".'
		);
		ask?.allow();
		expect( await pin.confirmationFor( 'site_create', { name: 'Two' } ) ).toBeUndefined();
		expect(
			await new SitePin( null ).confirmationFor( 'site_create', { name: 'New' } )
		).toBeUndefined();
	} );

	it( 'pins a WordPress.com active site by ID', async () => {
		const pin = new SitePin( {
			name: 'Live',
			path: '',
			running: true,
			remote: true,
			wpcomSiteId: 7,
		} );
		expect(
			await pin.confirmationFor( 'wpcom_request', { siteId: 7, method: 'POST', path: '/posts' } )
		).toBeUndefined();
		expect(
			await pin.confirmationFor( 'wpcom_request', { siteId: 8, method: 'GET', path: '/posts' } )
		).toBeUndefined();
		expect(
			(
				await pin.confirmationFor( 'wpcom_request', { siteId: 8, method: 'POST', path: '/posts' } )
			)?.confirmation.question
		).toBe( 'Also change WordPress.com site 8? This request is about "Live".' );
		expect(
			await pin.confirmationFor( 'wp_cli', { nameOrPath: 'Shop', command: 'post create x' } )
		).toBeTruthy();
	} );
} );
