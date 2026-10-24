import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { OpenProblems, unrenderedFrontPage } from 'cli/ai/open-problems';
import { createSite } from 'cli/ai/tests/fixtures/wordpress-site';

describe( 'OpenProblems', () => {
	it( 'raises each problem still open once, and the problems of the sites changed', async () => {
		const checked: string[] = [];
		const open = new OpenProblems( undefined, [
			async ( site ) => {
				checked.push( site );
				return `${ site } has a problem`;
			},
		] );
		open.record( '/a', '/a/page-1', 'page 1 is invalid' );
		open.record( '/a', '/a/page-2', 'page 2 is invalid' );
		open.record( '/a', '/a/page-2' );

		expect( await open.raise() ).toEqual( [ 'page 1 is invalid', '/a has a problem' ] );
		expect( checked ).toEqual( [ '/a' ] );
		expect( await open.raise() ).toEqual( [] );

		open.record( '/a', '/a/page-1', 'page 1 is still invalid' );
		const kept = new OpenProblems( open.toJSON(), [] );
		expect( await kept.raise() ).toEqual( [ 'page 1 is still invalid' ] );
	} );
} );

// The front-page template renders instead of the static front page, and shows
// its content only through a post-content block.
describe( 'unrenderedFrontPage', () => {
	const SHOWN = '<!-- wp:post-content /-->';
	const NOT_SHOWN = '<!-- wp:heading -->\n<h2>Hi</h2>\n<!-- /wp:heading -->';
	it.each( [
		{ name: 'a theme template without post-content', file: NOT_SHOWN, problem: true },
		{ name: 'a theme template with post-content', file: SHOWN, problem: false },
		{
			name: 'a template including a pattern',
			file: '<!-- wp:pattern {"slug":"a/b"} /-->',
			problem: false,
		},
		{ name: 'no front-page template', file: undefined, problem: false },
		{ name: 'latest posts on the front', file: NOT_SHOWN, front: 'posts', problem: false },
		{ name: 'a saved copy with post-content', file: NOT_SHOWN, saved: SHOWN, problem: false },
		{ name: 'a saved copy without post-content', file: SHOWN, saved: NOT_SHOWN, problem: true },
		{ name: "the parent theme's template", parentFile: NOT_SHOWN, problem: true },
	] )( '$name: $problem', async ( { file, parentFile, front = 'page', saved, problem } ) => {
		const site = createSite();
		site.setOptions( { show_on_front: front, page_on_front: '9' } );
		site.save( 9, 'page', 'home' );
		for ( const [ theme, content ] of [
			[ 'bakery', file ],
			[ 'bakery-parent', parentFile ],
		] ) {
			if ( content !== undefined ) {
				const template = path.join( site.root, 'wp-content/themes', theme!, 'templates' );
				mkdirSync( template, { recursive: true } );
				writeFileSync( path.join( template, 'front-page.html' ), content );
			}
		}
		if ( saved ) {
			site.save( 20, 'wp_template', 'front-page', saved );
		}

		const result = await unrenderedFrontPage( site.root );

		expect( result !== undefined ).toBe( problem );
		if ( result ) {
			expect( result ).toContain(
				saved
					? 'the front-page template saved in the Site Editor (post 20)'
					: `wp-content/themes/${ file ? 'bakery' : 'bakery-parent' }/templates/front-page.html`
			);
			expect( result ).toContain( 'get_front_page_template' );
		}
	} );
} );
