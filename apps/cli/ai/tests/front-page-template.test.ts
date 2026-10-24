import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { expect, it } from 'vitest';
import { unrenderedFrontPage } from 'cli/ai/open-problems';
import { frontPageTemplateNotes, resolveSiteFile } from 'cli/ai/site-file-guards';
import { createSite } from 'cli/ai/tests/fixtures/wordpress-site';

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

		const raised = await unrenderedFrontPage( site.root );
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

it( 'notes no other template', async () => {
	const site = createSite();
	const index = path.join( site.root, 'wp-content/themes/bakery/templates/index.html' );
	mkdirSync( path.dirname( index ), { recursive: true } );
	writeFileSync( index, NOT_SHOWN );
	expect( await frontPageTemplateNotes( resolveSiteFile( index )! ) ).toEqual( [] );
} );
