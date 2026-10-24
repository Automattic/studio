import { afterEach, expect, it, vi } from 'vitest';
import { homeSectionLinks } from 'cli/ai/home-section-links';

vi.mock( 'cli/lib/cli-config/sites', () => ( {
	getSiteByFolder: async ( folder: string ) => {
		if ( folder !== '/sites/bakery' ) {
			throw new Error( 'not a Studio site' );
		}
		return { port: 8881 };
	},
	getSiteUrl: ( site: { port: number } ) => `http://localhost:${ site.port }`,
} ) );

afterEach( () => vi.unstubAllGlobals() );

const header =
	'<header id="top"><a href="#features">Features</a><a href="#contact">Contact</a><a href="#top">Top</a><a href="/about">About</a></header>';
const rooted = header.replace( /href="#(features|contact)"/g, 'href="/#$1"' );
const sections = '<section id="features"></section><section id="contact"></section>';

// The pages WordPress renders, by URL, as the site's server would.
function serve( pages: Record< string, string | undefined > ) {
	vi.stubGlobal(
		'fetch',
		vi.fn( async ( url: string ) => {
			if ( ! ( url in pages ) ) {
				throw new Error( `unexpected ${ url }` );
			}
			const html = pages[ url ];
			if ( html === undefined ) {
				throw new TypeError( 'fetch failed' );
			}
			return new Response( html );
		} )
	);
}

const HOME = 'http://localhost:8881/';
const OTHER = 'http://localhost:8881/?p=2147483647';

it.each( [
	{
		name: 'header links to sections only the home page renders',
		home: header + sections,
		other: header,
		links: '#features, #contact',
	},
	{
		name: 'links written /#anchor',
		home: rooted + sections,
		other: rooted,
		links: undefined,
	},
	{
		name: 'a link every page can follow, as the sections render on every page',
		home: header + sections,
		other: header + sections,
		links: undefined,
	},
	{
		name: 'a link to a section no page renders, which is no home section',
		home: header,
		other: header,
		links: undefined,
	},
	{
		name: 'a site whose server is not running',
		home: undefined,
		other: undefined,
		links: undefined,
	},
] )( '$name', async ( { home, other, links } ) => {
	serve( { [ HOME ]: home, [ OTHER ]: other } );
	const problem = await homeSectionLinks( '/sites/bakery' );
	if ( links ) {
		expect( problem ).toContain( `the links ${ links } go nowhere` );
		expect( problem ).toContain( 'Write them /#features, /#contact' );
	} else {
		expect( problem ).toBeUndefined();
	}
} );

it( 'checks only Studio sites', async () => {
	serve( {} );
	expect( await homeSectionLinks( '/elsewhere' ) ).toBeUndefined();
} );
