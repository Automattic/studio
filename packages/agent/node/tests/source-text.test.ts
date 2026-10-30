import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, expect, it, vi } from 'vitest';
import { missingSourceText } from '@studio/agent/node/source-text';
import { createFakeHostWithSites } from '@studio/agent/node/tests/fake-host';

afterEach( () => vi.unstubAllGlobals() );

// The old site of the html-site-move eval case, in the site's folder.
const root = mkdtempSync( path.join( os.tmpdir(), 'source-text-' ) );
const FOOTER =
	'<footer>Harbor Lights Sailing School &middot; Pier 4 &middot; Teaching sailors since 1998</footer>';
mkdirSync( path.join( root, 'old-site' ) );
mkdirSync( path.join( root, 'wp-includes' ) );
writeFileSync(
	path.join( root, 'old-site/index.html' ),
	`<html><head><title>Harbor Lights</title><style>p { color: red }</style></head><body>
	<nav><a href="about.html">About Us</a></nav>
	<h1>Learn to sail on Harbor Bay</h1>
	<p>Small classes, patient instructors, and the best light on the coast.</p>${ FOOTER }</body></html>`
);
writeFileSync(
	path.join( root, 'old-site/about.html' ),
	// A shortcode WordPress replaces, as run h2h5's pet store saved its products grid.
	`<html><body><p>Harbor Lights started in 1998 with one dinghy.</p><!-- wp:shortcode -->[products limit="4" columns="4" orderby="date"]<!-- /wp:shortcode -->${ FOOTER }</body></html>`
);
// WordPress's own pages are not the site's.
writeFileSync( path.join( root, 'wp-includes/page.html' ), '<p>Nothing to see here today.</p>' );

const host = createFakeHostWithSites( [
	{ id: '1', name: 'Harbor', path: root, url: 'http://localhost:8881' },
] );

function serve( pages: Record< string, string > ) {
	vi.stubGlobal(
		'fetch',
		vi.fn( async ( url: string ) => {
			if ( ! ( url in pages ) ) {
				throw new TypeError( 'fetch failed' );
			}
			return new Response( pages[ url ] );
		} )
	);
}

const home = ( footer: string ) =>
	`<body><a href="/about-us/">About Us</a><h1>Learn to sail on Harbor Bay</h1><p>Small classes, patient instructors, and the best light on the coast.</p>${ footer }</body>`;

it.each< { name: string; pages: Record< string, string >; missing?: string } >( [
	{
		name: 'the text the site does not show, once it shows some',
		pages: {
			'http://localhost:8881/': home( '<footer>Designed with WordPress</footer>' ),
			'http://localhost:8881/about-us/': '<p>Harbor Lights started in 1998 with one dinghy.</p>',
		},
		missing:
			'"Harbor Lights Sailing School &middot; Pier 4 &middot; Teaching sailors since 1998" (old-site/about.html, old-site/index.html)',
	},
	{
		name: 'nothing, when the site shows it all, split and texturized',
		pages: {
			'http://localhost:8881/': home(
				'<footer><p>Harbor Lights Sailing School</p><p>Pier 4 — Teaching sailors since 1998</p></footer>'
			),
			'http://localhost:8881/about-us/':
				'<p>Harbor Lights started in 1998 with one&nbsp;dinghy.</p>',
		},
	},
	{
		name: 'nothing, when the site shows none of it',
		pages: { 'http://localhost:8881/': '<body><p>Hello world, welcome to WordPress.</p></body>' },
	},
	{ name: 'nothing, when the site is not running', pages: {} },
] )( 'says $name', async ( { pages, missing } ) => {
	serve( pages );
	const problem = await missingSourceText( host, root );
	if ( missing ) {
		expect( problem ).toContain( `shows 3 of the 4 runs of text` );
		expect( problem ).toContain( `show: ${ missing }.` );
	} else {
		expect( problem ).toBeUndefined();
	}
} );
