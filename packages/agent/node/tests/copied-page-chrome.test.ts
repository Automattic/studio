import { expect, it } from 'vitest';
import { copiedPageChrome } from '@studio/agent/node/copied-page-chrome';
import { createOpenProblems } from '@studio/agent/node/open-problems';
import { createFakeHost } from '@studio/agent/node/tests/fake-host';
import { createSite } from '@studio/agent/node/tests/fixtures/wordpress-site';

// The header a hand-written site move pasted into each page (port-2 html-site-move).
const HEADER =
	'<!-- wp:group {"tagName":"header"} -->\n<header class="wp-block-group"><!-- wp:paragraph -->\n<p><a href="/courses/">Courses</a> <a href="/about/">About Us</a></p>\n<!-- /wp:paragraph --></header>\n<!-- /wp:group -->';
const FOOTER =
	'<!-- wp:group {"tagName":"footer"} -->\n<footer class="wp-block-group"><!-- wp:paragraph -->\n<p>Harbor Lights</p>\n<!-- /wp:paragraph --></footer>\n<!-- /wp:group -->';
const body = ( text: string ) => `<!-- wp:paragraph -->\n<p>${ text }</p>\n<!-- /wp:paragraph -->`;

it.each( [
	{
		name: 'a header and footer in each page',
		pages: [ HEADER + body( 'Home' ) + FOOTER, HEADER + body( 'Courses' ) + FOOTER ],
		copied: [ 'header', 'footer' ],
	},
	{ name: 'one page', pages: [ HEADER + body( 'Home' ) + FOOTER ], copied: [] },
	{
		name: 'different pages',
		pages: [ HEADER + body( 'Home' ), body( 'Courses' ) + FOOTER ],
		copied: [],
	},
	{
		name: 'a synced pattern in each page',
		pages: [
			'<!-- wp:block {"ref":4} /-->' + body( 'Home' ),
			'<!-- wp:block {"ref":4} /-->' + body( 'About' ),
		],
		copied: [],
	},
	{ name: 'pages of one shared paragraph', pages: [ body( 'Hi' ), body( 'Hi' ) ], copied: [] },
] )( '$name', async ( { pages, copied } ) => {
	const site = createSite();
	pages.forEach( ( content, i ) =>
		site.save( 9 + i, 'page', `p${ i }`, content, 1, 'publish', `P${ i }` )
	);
	const problems = await copiedPageChrome( site.root );
	expect( problems.map( ( problem ) => problem.match( /parts\/(\w+)\.html/ )?.[ 1 ] ) ).toEqual(
		copied
	);
	if ( copied.length ) {
		expect( problems[ 0 ] ).toMatch(
			/^Pages 9 "P0", 10 "P1" each begin with the same core\/group/
		);
	}
} );

it( 'is raised at the end of a turn', async () => {
	const site = createSite();
	const open = createOpenProblems( createFakeHost() );
	await open.see( site.root );
	open.record( site.root, 'page', undefined );
	site.save( 9, 'page', 'home', HEADER + body( 'Home' ), 1, 'publish', 'Home' );
	site.save( 10, 'page', 'about', HEADER + body( 'About' ), 1, 'publish', 'About' );
	expect( ( await open.raise() ).join( '\n' ) ).toContain( 'each begin with the same core/group' );
} );
