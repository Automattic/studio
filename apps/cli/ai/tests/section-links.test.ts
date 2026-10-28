import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sectionLinks } from 'cli/ai/section-links';
import { runWpCli } from 'cli/ai/tools/utils';
import type { SiteData } from 'cli/lib/cli-config/core';

vi.mock( 'cli/lib/daemon-client', () => ( {
	connectToDaemon: vi.fn(),
	disconnectFromDaemon: vi.fn(),
} ) );
const mocks = vi.hoisted( () => ( { site: undefined as SiteData | undefined } ) );
vi.mock( 'cli/ai/tools/utils', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('cli/ai/tools/utils') >() ),
	resolveSite: async () => mocks.site,
} ) );

// A real WordPress install to render the site with, when one is given.
const WORDPRESS = process.env.STUDIO_TEST_WORDPRESS;

const link = ( label: string, url: string ) =>
	`<!-- wp:navigation-link {"label":"${ label }","url":"${ url }","kind":"custom"} /-->`;
const section = ( id: string ) =>
	`<!-- wp:group {"anchor":"${ id }"} --><div id="${ id }" class="wp-block-group"><!-- wp:paragraph --><p>${ id }</p><!-- /wp:paragraph --></div><!-- /wp:group -->`;

describe.runIf( WORDPRESS )( 'navigation links to sections of the front page', () => {
	let site: SiteData;
	let menu: number;
	const theme = ( file: string ) =>
		path.join( site.path, 'wp-content/themes/studio-test-sections', file );
	const wp = ( ...args: string[] ) => runWpCli( site, args );
	const create = async ( type: string, title: string, content: string ) =>
		Number(
			(
				await wp(
					'post',
					'create',
					`--post_type=${ type }`,
					'--post_status=publish',
					`--post_title=${ title }`,
					`--post_content=${ content }`,
					'--porcelain'
				)
			).trim()
		);
	// The site as a call leaves it, and what the next call is told.
	const check = async ( change: () => Promise< unknown > ) => {
		const before = await sectionLinks.read( site.path );
		await change();
		return sectionLinks.check( site, before, await sectionLinks.read( site.path ) );
	};

	beforeAll( async () => {
		const root = mkdtempSync( path.join( os.tmpdir(), 'section-links-' ) );
		cpSync( WORDPRESS!, root, { recursive: true } );
		site = { id: 'site', name: 'Brightline Bikes', path: root } as SiteData;
		mocks.site = site;
		mkdirSync( theme( 'templates' ), { recursive: true } );
		mkdirSync( theme( 'parts' ) );
		writeFileSync( theme( 'style.css' ), '/*\nTheme Name: Sections\n*/' );
		writeFileSync(
			theme( 'templates/index.html' ),
			'<!-- wp:template-part {"slug":"header"} /-->\n<!-- wp:post-content /-->\n<!-- wp:template-part {"slug":"footer"} /-->'
		);
		writeFileSync( theme( 'parts/header.html' ), '' );
		writeFileSync( theme( 'parts/footer.html' ), '' );
		await wp( 'theme', 'activate', 'studio-test-sections' );
		await wp( 'post', 'delete', '1', '2', '--force' );
		// Sections of the front page, one of which the site's other page has too.
		const front = await create(
			'page',
			'Home',
			[ 'features', 'about', 'hours' ].map( section ).join( '' )
		);
		await create( 'page', 'Blog', section( 'hours' ) );
		await wp( 'option', 'update', 'show_on_front', 'page' );
		await wp( 'option', 'update', 'page_on_front', String( front ) );
		menu = await create( 'wp_navigation', 'Footer', link( 'About', '#about' ) );
	}, 120000 );
	afterAll( () => rmSync( site.path, { recursive: true, force: true } ) );
	beforeEach( () => {
		// The theme is not one WordPress.org has, so no update replaces its files.
		vi.stubGlobal( 'fetch', async () => new Response( '{"themes":[],"no_update":[]}' ) );
		return () => vi.unstubAllGlobals();
	} );

	it( "links a menu's section links to the front page, where the menu every page shows holds them", async () => {
		const header = `<!-- wp:group {"anchor":"top"} --><div id="top" class="wp-block-group"><!-- wp:navigation -->${ [
			link( 'Features', '#features' ),
			link( 'Hours', '#hours' ),
			link( 'Top', '#top' ),
			link( 'Blog', '/blog/' ),
			link( 'Contact', '#contact' ),
		].join(
			''
		) }<!-- /wp:navigation --><!-- wp:studio-test/cta {"url":"#features"} /--></div><!-- /wp:group -->`;
		const { reports, next } = await check( async () => {
			writeFileSync( theme( 'parts/header.html' ), header );
			writeFileSync( theme( 'parts/footer.html' ), `<!-- wp:navigation {"ref":${ menu }} /-->` );
		} );
		expect( reports ).toEqual( [
			{
				key: 'section links',
				summary: `Brightline Bikes: links "Features" (#features), "About" (#about), which the site's other pages render too, link to sections of the front page, and an href of only "#id" goes to that id on the page it is on (a navigation link prints its url as its href, render_block_core_navigation_link() in wp-includes/blocks/navigation-link.php), which the site's other pages do not have. Studio linked "Features" (#features), "About" (#about) to the front page's section (/#id), as they do on the front page, in wp-content/themes/studio-test-sections/parts/header.html, post ${ menu }.`,
				problem: undefined,
			},
		] );
		// What Studio saved is the site as the next check starts from.
		expect( next ).toEqual( await sectionLinks.read( site.path ) );
		// A section the other page has too, and one the menu itself holds, are each
		// page's own; one no page has, and a link outside a menu, are not the front page's.
		expect( readFileSync( theme( 'parts/header.html' ), 'utf8' ) ).toBe(
			header.replace( '"url":"#features"', '"url":"/#features"' )
		);
		expect( ( await wp( 'post', 'get', String( menu ), '--field=post_content' ) ).trim() ).toBe(
			link( 'About', '/#about' )
		);
		// Linked to the front page, it is not stated again.
		expect(
			( await check( async () => writeFileSync( theme( 'parts/footer.html' ), '' ) ) ).reports
		).toEqual( [] );
	}, 120000 );

	it( "links a template part's own links to the front page's sections, and leaves a link only the front page renders", async () => {
		const paragraph = ( url: string ) =>
			`<!-- wp:paragraph --><p><a href="${ url }">Link</a></p><!-- /wp:paragraph -->`;
		const button = ( url: string ) =>
			`<!-- wp:buttons --><div class="wp-block-buttons"><!-- wp:button --><div class="wp-block-button"><a class="wp-block-button__link wp-element-button" href="${ url }">Book</a></div><!-- /wp:button --></div><!-- /wp:buttons -->`;
		const header = paragraph( '#features' ) + button( '#features' ) + paragraph( '#hours' );
		const footer = paragraph( '#features' );
		const page = Number( ( await wp( 'option', 'get', 'page_on_front' ) ).trim() );
		const content = ( await wp( 'post', 'get', String( page ), '--field=post_content' ) ).trim();
		// Links in the front page's own content render on the front page only, one
		// to a section the template part links too.
		const own = paragraph( '#about' ) + button( '#features' );
		await wp( 'post', 'update', String( page ), `--post_content=${ content }${ own }` );
		const saved = await create( 'wp_template_part', 'footer', footer );
		await wp( 'post', 'term', 'add', String( saved ), 'wp_theme', 'studio-test-sections' );
		await wp( 'post', 'update', String( saved ), '--post_name=footer' );

		const { reports } = await check( async () =>
			writeFileSync( theme( 'parts/header.html' ), header )
		);

		expect( reports[ 0 ]?.summary ).toMatch(
			/^Brightline Bikes: links #features, which .* Studio linked #features to the front page's section \(\/#id\), as they do on the front page, in wp-content\/themes\/studio-test-sections\/parts\/header\.html, post \d+\.$/
		);
		expect( reports[ 0 ]?.problem ).toBeUndefined();
		expect( readFileSync( theme( 'parts/header.html' ), 'utf8' ) ).toBe(
			paragraph( '/#features' ) + button( '/#features' ) + paragraph( '#hours' )
		);
		expect( ( await wp( 'post', 'get', String( saved ), '--field=post_content' ) ).trim() ).toBe(
			paragraph( '/#features' )
		);
		expect( ( await wp( 'post', 'get', String( page ), '--field=post_content' ) ).trim() ).toBe(
			`${ content }${ own }`
		);
		await wp( 'post', 'delete', String( saved ), '--force' );
		await wp( 'post', 'update', String( page ), `--post_content=${ content }` );
		writeFileSync( theme( 'parts/header.html' ), '' );
	}, 120000 );

	it( 'links them where the front page is chosen after its sections and links are written', async () => {
		const front = await wp( 'option', 'get', 'page_on_front' );
		await wp( 'option', 'update', 'show_on_front', 'posts' );
		writeFileSync(
			theme( 'parts/header.html' ),
			`<!-- wp:navigation -->${ link( 'Features', '#features' ) }<!-- /wp:navigation -->`
		);
		const { reports } = await check( async () =>
			wp( 'option', 'update', 'show_on_front', 'page' )
		);
		expect( front.trim() ).not.toBe( '' );
		expect( reports ).toEqual( [
			expect.objectContaining( { summary: expect.stringContaining( 'Studio linked "Features"' ) } ),
		] );
		expect( readFileSync( theme( 'parts/header.html' ), 'utf8' ) ).toContain(
			'"url":"/#features"'
		);
	}, 120000 );

	it( 'states a section link it cannot change, in a theme WordPress updates', async () => {
		vi.stubGlobal(
			'fetch',
			async () =>
				new Response( '{"themes":[],"no_update":{"studio-test-sections":{"version":"1.0"}}}' )
		);
		// A release of the theme WordPress.org has, as it answers for it.
		writeFileSync( theme( 'style.css' ), '/*\nTheme Name: Sections\nVersion: 1.0\n*/' );
		const { reports } = await check( async () =>
			writeFileSync(
				theme( 'parts/header.html' ),
				`<!-- wp:navigation -->${ link( 'Features', '#features' ) }<!-- /wp:navigation -->`
			)
		);
		expect( reports ).toEqual( [
			{
				key: 'section links',
				summary: undefined,
				problem: expect.stringMatching(
					/^Brightline Bikes: links "Features" \(#features\), which .* link to sections .*\. Link "Features" \(#features\) to the front page's section: \/#features\.$/
				),
			},
		] );
		expect( readFileSync( theme( 'parts/header.html' ), 'utf8' ) ).toContain( '"url":"#features"' );
	}, 120000 );
} );
