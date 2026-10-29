import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { expect, it } from 'vitest';
import { unrenderedPages } from '@studio/agent/node/open-problems';
import { frontPageTemplateNotes, resolveSiteFile } from '@studio/agent/node/site-file-guards';
import { createSiteNotes } from '@studio/agent/node/site-notes';
import { createFakeHost } from '@studio/agent/node/tests/fake-host';
import { createSite } from '@studio/agent/node/tests/fixtures/wordpress-site';

const SHOWN = '<!-- wp:post-content /-->';
const NOT_SHOWN = '<!-- wp:heading -->\n<h2>Hi</h2>\n<!-- /wp:heading -->';
const pattern = ( slug: string ) => `<!-- wp:pattern {"slug":"${ slug }"} /-->`;

// WordPress renders the active theme's front-page template at the front page
// under either Reading setting, and shows a page there only through a
// post-content block: noted when the template is written, and raised at the
// end of a turn for the site's state.
it.each( [
	{ name: 'a template without post-content', file: NOT_SHOWN, problem: true },
	{ name: 'a template with post-content', file: SHOWN, problem: false },
	{ name: 'latest posts on the front', file: NOT_SHOWN, front: 'posts', problem: true },
	{
		name: 'a theme pattern with post-content',
		file: pattern( 'bakery/main' ),
		patternContent: SHOWN,
		problem: false,
	},
	{
		name: 'a theme pattern without it',
		file: pattern( 'bakery/main' ),
		patternContent: NOT_SHOWN,
		problem: true,
	},
	{ name: 'a pattern the theme does not hold', file: pattern( 'other/main' ), problem: false },
	{ name: 'no front-page template', file: undefined, problem: false },
	{
		name: 'a saved copy with post-content',
		file: NOT_SHOWN,
		saved: SHOWN,
		written: true,
		problem: false,
	},
	{
		name: 'a saved copy without post-content',
		file: SHOWN,
		saved: NOT_SHOWN,
		written: false,
		problem: true,
	},
	{ name: "the parent theme's template", parentFile: NOT_SHOWN, problem: true },
] )(
	'$name: $problem',
	async ( { file, parentFile, front = 'page', patternContent, saved, written, problem } ) => {
		const site = createSite();
		site.setOptions( { show_on_front: front, page_on_front: '9' } );
		site.save( 9, 'page', 'home' );
		const themes = path.join( site.root, 'wp-content/themes' );
		const templates: string[] = [];
		for ( const [ theme, content ] of [
			[ 'bakery', file ],
			[ 'bakery-parent', parentFile ],
		] ) {
			if ( content !== undefined ) {
				mkdirSync( path.join( themes, theme!, 'templates' ), { recursive: true } );
				templates.push( path.join( themes, theme!, 'templates/front-page.html' ) );
				writeFileSync( templates[ templates.length - 1 ], content );
			}
		}
		if ( patternContent ) {
			mkdirSync( path.join( themes, 'bakery-parent/patterns' ), { recursive: true } );
			writeFileSync(
				path.join( themes, 'bakery-parent/patterns/main.php' ),
				`<?php\n/**\n * Title: Main\n * Slug: bakery/main\n */\n?>\n${ patternContent }`
			);
			writeFileSync(
				path.join( themes, 'bakery/style.css' ),
				'/*\nTheme Name: Bakery\nTemplate: bakery-parent\n*/'
			);
		}
		if ( saved ) {
			site.save( 20, 'wp_template', 'front-page', saved );
		}

		const [ raised ] = await unrenderedPages( site.root );
		const noted = (
			await Promise.all(
				templates.map( ( template ) => frontPageTemplateNotes( resolveSiteFile( template )! ) )
			)
		).flat();

		expect( raised !== undefined ).toBe( problem );
		expect( noted.length > 0 ).toBe( written ?? problem );
		for ( const text of [ raised, ...noted ].filter( Boolean ) ) {
			expect( text ).toContain( 'get_front_page_template' );
		}
		if ( raised ) {
			expect( raised ).toContain(
				saved
					? 'the front-page template saved in the Site Editor (post 20)'
					: `wp-content/themes/${ file ? 'bakery' : 'bakery-parent' }/templates/front-page.html`
			);
			expect( raised.includes( 'page 9 ""' ) ).toBe( front === 'page' );
		}
	}
);

// A new front-page template is refused without a page's content; one the
// theme already holds is the theme's, and a change to it is only noted.
it.each( [
	{ name: 'a new template without post-content', text: NOT_SHOWN, refused: true },
	{ name: 'a new template with post-content', text: SHOWN, refused: false },
	// port c-2 climbing-gym: a stray core pattern let the page live in the theme.
	{
		name: 'a new template with a pattern the theme does not hold',
		text: NOT_SHOWN + pattern( 'core/pricing' ),
		refused: true,
	},
	{ name: 'a change to a template the theme holds', text: NOT_SHOWN, held: true, refused: false },
] )( '$name: refused $refused', async ( { text, held, refused } ) => {
	const site = createSite();
	const template = path.join( site.root, 'wp-content/themes/bakery/templates/front-page.html' );
	mkdirSync( path.dirname( template ), { recursive: true } );
	if ( held ) {
		writeFileSync( template, NOT_SHOWN );
	}
	const refusal = await createSiteNotes( createFakeHost() ).beforeWrite( template, text );
	expect( refusal !== undefined ).toBe( refused );
	if ( refusal ) {
		expect( refusal ).toContain( 'get_front_page_template' );
	}
} );

it( 'notes no other template', async () => {
	const site = createSite();
	const index = path.join( site.root, 'wp-content/themes/bakery/templates/index.html' );
	mkdirSync( path.dirname( index ), { recursive: true } );
	writeFileSync( index, NOT_SHOWN );
	expect( await frontPageTemplateNotes( resolveSiteFile( index )! ) ).toEqual( [] );
} );

// Each page renders with the first template of the page hierarchy the site
// has, and shows its content only through a post-content block.
it.each( [
	{
		name: "a page's own template without post-content",
		files: { 'page-classes': NOT_SHOWN, page: SHOWN },
		raised: [ 'page 6 "Classes" with wp-content/themes/bakery/templates/page-classes.html' ],
	},
	{ name: "a page's own template with post-content", files: { 'page-classes': SHOWN }, raised: [] },
	{
		name: 'a template by page ID',
		files: { 'page-6': NOT_SHOWN },
		raised: [ 'page 6 "Classes" with wp-content/themes/bakery/templates/page-6.html' ],
	},
	{
		name: 'page.html without post-content, for every page but the posts page',
		files: { page: NOT_SHOWN },
		raised: [
			'page 6 "Classes", page 7 "About", page 9 "Home" with wp-content/themes/bakery/templates/page.html',
			'so their content never shows, and edits to them change nothing',
		],
		problems: 1,
	},
	{
		name: "the parent theme's index.html",
		parentFiles: { index: NOT_SHOWN },
		raised: [
			'page 6 "Classes", page 7 "About", page 9 "Home" with wp-content/themes/bakery-parent/templates/index.html',
		],
	},
	{
		name: 'a Site Editor copy before the theme file',
		files: { 'page-about': SHOWN },
		saved: { 'page-about': NOT_SHOWN },
		raised: [ 'page 7 "About" with the page-about template saved in the Site Editor (post 30)' ],
	},
	{
		name: 'the front page by its front-page template only',
		files: { 'front-page': NOT_SHOWN, page: SHOWN },
		raised: [ 'get_front_page_template' ],
	},
	{
		name: 'the front page by a front-page template with post-content',
		files: { 'front-page': SHOWN, page: NOT_SHOWN },
		raised: [ 'page 6 "Classes", page 7 "About" with' ],
	},
	{ name: 'no templates', raised: [] },
] )( '$name', async ( { files = {}, parentFiles = {}, saved = {}, raised, problems: count } ) => {
	const site = createSite();
	site.setOptions( { show_on_front: 'page', page_on_front: '9', page_for_posts: '8' } );
	site.save( 6, 'page', 'classes', '', 1, 'publish', 'Classes' );
	site.save( 7, 'page', 'about', '', 1, 'publish', 'About' );
	site.save( 8, 'page', 'journal', '', 1, 'publish', 'Journal' );
	site.save( 9, 'page', 'home', '', 1, 'publish', 'Home' );
	for ( const [ theme, templates ] of [
		[ 'bakery', files ],
		[ 'bakery-parent', parentFiles ],
	] as const ) {
		const dir = path.join( site.root, 'wp-content/themes', theme, 'templates' );
		mkdirSync( dir, { recursive: true } );
		for ( const [ slug, content ] of Object.entries( templates ) ) {
			writeFileSync( path.join( dir, `${ slug }.html` ), content! );
		}
	}
	for ( const [ slug, content ] of Object.entries( saved ) ) {
		site.save( 30, 'wp_template', slug, content );
	}

	const problems = await unrenderedPages( site.root );
	expect( problems ).toHaveLength( count ?? raised.length );
	raised.forEach( ( text, index ) => expect( problems[ count ? 0 : index ] ).toContain( text ) );
} );

it( 'tells one page or several what to do', async () => {
	const site = createSite();
	site.setOptions( { show_on_front: 'posts' } );
	site.save( 6, 'page', 'classes', '', 1, 'publish', 'Classes' );
	site.save( 7, 'page', 'about', '', 1, 'publish', 'About' );
	const dir = path.join( site.root, 'wp-content/themes/bakery/templates' );
	mkdirSync( dir, { recursive: true } );
	writeFileSync( path.join( dir, 'page-classes.html' ), NOT_SHOWN );
	writeFileSync( path.join( dir, 'page.html' ), NOT_SHOWN );
	expect( await unrenderedPages( site.root ) ).toEqual( [
		'WordPress renders page 6 "Classes" with wp-content/themes/bakery/templates/page-classes.html (the page template hierarchy, get_page_template in wp-includes/template.php), which has no core/post-content block, the only block that renders the page shown (wp-includes/blocks/post-content.php), so its content never shows, and edits to it change nothing on the site. Put the content in the page, and render it with <!-- wp:post-content /--> in the template, or remove the template so page.html renders the page.',
		'WordPress renders page 7 "About" with wp-content/themes/bakery/templates/page.html (the page template hierarchy, get_page_template in wp-includes/template.php), which has no core/post-content block, the only block that renders the page shown (wp-includes/blocks/post-content.php), so its content never shows, and edits to it change nothing on the site. Put the content in the page, and render it with <!-- wp:post-content /--> in the template.',
	] );
} );

// home.html renders at the posts index, which Settings → Reading may leave nowhere.
it.each( [
	{
		name: 'a static front page and no posts page',
		options: { show_on_front: 'page', page_on_front: '9', page_for_posts: '0' },
		raised:
			'and Settings → Reading shows page 9 "Home" at the front page (show_on_front, page_on_front) and names no posts page (page_for_posts), so it renders nowhere',
	},
	{
		name: 'a posts page',
		options: { show_on_front: 'page', page_on_front: '9', page_for_posts: '8' },
	},
	{
		name: 'a static front page naming no page, which shows the posts index',
		options: { show_on_front: 'page', page_on_front: '0' },
		templates: { 'front-page': SHOWN },
	},
	{ name: 'the latest posts on the front', options: { show_on_front: 'posts' } },
	{
		name: 'the latest posts on the front, with a front-page template',
		options: { show_on_front: 'posts' },
		templates: { 'front-page': SHOWN },
		raised:
			'with wp-content/themes/bakery/templates/front-page.html, which WordPress renders there before home.html',
	},
	{
		name: 'a theme WordPress updates',
		options: { show_on_front: 'page', page_on_front: '9', page_for_posts: '0' },
		theme: 'bakery-parent',
	},
	{
		name: 'a Site Editor copy',
		options: { show_on_front: 'page', page_on_front: '9', page_for_posts: '0' },
		theme: 'bakery-parent',
		saved: true,
		raised:
			'WordPress renders the home template saved in the Site Editor (post 30) at the posts index',
	},
] )( 'home.html: $name', async ( { options, templates = {}, theme = 'bakery', saved, raised } ) => {
	const site = createSite();
	site.setOptions( options as Record< string, string > );
	site.save( 8, 'page', 'journal', '', 1, 'publish', 'Journal' );
	site.save( 9, 'page', 'home', '', 1, 'publish', 'Home' );
	const dir = path.join( site.root, 'wp-content/themes', theme, 'templates' );
	mkdirSync( dir, { recursive: true } );
	for ( const [ slug, content ] of Object.entries( {
		home: NOT_SHOWN,
		page: SHOWN,
		...templates,
	} ) ) {
		writeFileSync( path.join( dir, `${ slug }.html` ), content );
	}
	if ( saved ) {
		site.save( 30, 'wp_template', 'home', NOT_SHOWN );
	}
	const problems = await unrenderedPages( site.root );
	expect( problems ).toHaveLength( raised ? 1 : 0 );
	if ( raised ) {
		expect( problems[ 0 ] ).toContain( raised );
		expect( problems[ 0 ] ).toContain( 'get_home_template in wp-includes/template.php' );
	}
} );
