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
			await pin.confirmationFor( 'install_taxonomy_scripts', { nameOrPath: 'Shop' } )
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
			await pin.confirmationFor( 'install_taxonomy_scripts', { nameOrPath: 'Blog' } )
		).toBeUndefined();
	} );

	it( 'asks before WP-CLI changes another site, and lets it read one', async () => {
		const pin = new SitePin( shop );
		expect(
			( await pin.confirmationFor( 'wp_cli', { nameOrPath: 'Blog', command: 'post delete 4' } ) )
				?.confirmation.question
		).toBe( 'Also change "Blog"? This request is about "Shop".' );
		for ( const command of [
			'option get blogname',
			'post list --post_type=page',
			'theme status',
		] ) {
			expect(
				await pin.confirmationFor( 'wp_cli', { nameOrPath: 'Blog', command } )
			).toBeUndefined();
		}
	} );

	it( 'reads other sites freely', async () => {
		const pin = new SitePin( shop );
		expect(
			await pin.confirmationFor( 'Read', { path: '/sites/blog/wp-config.php' } )
		).toBeUndefined();
		expect( await pin.confirmationFor( 'Write', { path: '/tmp/notes.md' } ) ).toBeUndefined();
	} );

	it( 'pins the first changed site when none is active, and includes sites the turn creates', async () => {
		const pin = new SitePin( null );
		expect( pin.localRequestSite() ).toBeUndefined();
		expect( await pin.confirmationFor( 'site_import', { nameOrPath: 'Shop' } ) ).toBeUndefined();
		await pin.created( 'New' );
		expect( await pin.confirmationFor( 'Write', { path: '/sites/new/x.php' } ) ).toBeUndefined();
		expect(
			( await pin.confirmationFor( 'site_import', { nameOrPath: 'Blog' } ) )?.confirmation.question
		).toBe( 'Also change "Blog"? This request is about "Shop".' );
		expect( pin.localSitePaths() ).toEqual( [ '/sites/shop', '/sites/new' ] );
		expect( pin.localRequestSite() ).toBe( '/sites/shop' );
	} );

	it( 'names the site a turn creates as its own when it has none', async () => {
		const pin = new SitePin( null );
		await pin.created( 'New' );
		expect( pin.localRequestSite() ).toBe( '/sites/new' );
		expect( new SitePin( shop ).localRequestSite() ).toBe( '/sites/shop' );
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

	it( 'asks before a local change while a WordPress.com site is active', async () => {
		const pin = new SitePin( {
			name: 'Live',
			path: '',
			running: true,
			remote: true,
			wpcomSiteId: 7,
		} );
		expect(
			await pin.confirmationFor( 'install_taxonomy_scripts', { nameOrPath: 'Shop' } )
		).toBeTruthy();
	} );
} );
