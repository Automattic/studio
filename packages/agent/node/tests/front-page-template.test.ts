import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { expect, it } from 'vitest';
import { resolveSiteFile } from '@studio/agent/node/site-file';
import { frontPageTemplateNotes } from '@studio/agent/node/site-file-guards';
import { createSiteNotes } from '@studio/agent/node/site-notes';
import { createFakeHost } from '@studio/agent/node/tests/fake-host';
import { createSite } from '@studio/agent/node/tests/fixtures/wordpress-site';

const SHOWN = '<!-- wp:post-content /-->';
const NOT_SHOWN = '<!-- wp:heading -->\n<h2>Hi</h2>\n<!-- /wp:heading -->';
const pattern = ( slug: string ) => `<!-- wp:pattern {"slug":"${ slug }"} /-->`;

// WordPress renders the active theme's front-page template at the front page
// under either Reading setting, and shows a page there only through a
// post-content block: noted when the template is written. The end of a
// turn asks WordPress (apps/cli/ai/tests/unrendered-pages.test.ts).
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

		const noted = (
			await Promise.all(
				templates.map( ( template ) => frontPageTemplateNotes( resolveSiteFile( template )! ) )
			)
		).flat();

		expect( noted.length > 0 ).toBe( written ?? problem );
		for ( const text of noted ) {
			expect( text ).toContain( 'get_front_page_template' );
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
