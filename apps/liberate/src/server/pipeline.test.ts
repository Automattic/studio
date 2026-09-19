import { progressOf, siteNameFrom, summarizeWatchLog } from './pipeline.ts';

// Trimmed from a real data-liberation run against a small Wix site.
const events = [
	{ event: 'agent-resolved', agent: '__none__' },
	{ event: 'discovered', count: 3, counts: { post: 1, page: 1, homepage: 1 } },
	{
		event: 'preview-pre-started',
		url: 'http://localhost:8881',
		source: 'studio',
		sitePath: '/data/jobs/abc/work/sites/mysite-com',
	},
	{ event: 'site-options-updated', title: 'Home | Mysite', tagline: '' },
	{ event: 'post-queued', url: 'https://mysite.com/', archetype: 'homepage' },
	{ event: 'media-installed', url: 'https://mysite.com/', installed: 12 },
	{ event: 'post-installed', url: 'https://mysite.com/', postId: 4, error: null },
	{ event: 'post-queued', url: 'https://mysite.com/post/hello', archetype: 'post' },
	{ event: 'post-installed', url: 'https://mysite.com/post/hello', postId: 9, error: null },
	{ event: 'post-queued', url: 'https://mysite.com/about', archetype: 'page' },
	{ event: 'post-installed', url: 'https://mysite.com/about', error: 'insert failed' },
	{ event: 'css-media-installed', total: 4, installed: 16 },
	{ event: 'design-theme-installed', themeSlug: 'dla-replica' },
];
const log = ( count: number ) =>
	events
		.slice( 0, count )
		.map( ( entry ) => JSON.stringify( entry ) )
		.join( '\n' );

describe( 'summarizeWatchLog', () => {
	it( 'counts what was copied and finds the Studio site', () => {
		const summary = summarizeWatchLog( log( events.length ) + '\n{"truncated', 100 );
		expect( summary ).toMatchObject( {
			siteName: 'Mysite',
			discovered: 3,
			total: 3,
			installed: 2,
			counts: { pages: 1, posts: 1, media: 16, products: 0 },
			site: { path: '/data/jobs/abc/work/sites/mysite-com', url: 'http://localhost:8881' },
			lookDone: true,
		} );
	} );

	it( 'caps the total at the page limit', () => {
		expect( summarizeWatchLog( log( 2 ), 2 ) ).toMatchObject( { discovered: 3, total: 2 } );
	} );
} );

describe( 'progressOf', () => {
	it( 'moves from scanning to copying to recreating the look', () => {
		expect( progressOf( summarizeWatchLog( log( 1 ), 100 ) ) ).toMatchObject( { step: 'scan' } );
		expect( progressOf( summarizeWatchLog( log( 2 ), 2 ) ) ).toMatchObject( {
			step: 'content',
			detail: 'Found 3 pages. Copying the first 2…',
		} );

		const copying = progressOf( summarizeWatchLog( log( 7 ), 100 ) );
		expect( copying ).toMatchObject( { step: 'content', detail: 'Copied 1 of 3 pages' } );
		expect( copying.progress ).toBeCloseTo( 0.08 + 0.72 / 3 );

		expect( progressOf( summarizeWatchLog( log( events.length ), 100 ) ) ).toMatchObject( {
			step: 'look',
		} );
	} );
} );

describe( 'siteNameFrom', () => {
	it.each( [
		[ 'Sonora', 'Sonora' ],
		[ '  Dopple   Creative Studio ', 'Dopple Creative Studio' ],
		[ 'Home | Acme Coffee', 'Acme Coffee' ],
		[ 'Acme Coffee — Home', 'Acme Coffee' ],
		[ 'Acme Coffee - Fresh roasts daily', 'Acme Coffee' ],
		[ 'Imported Site', undefined ],
		[ 'Home', undefined ],
		[ '', undefined ],
		[ null, undefined ],
		[ 'The pooches of Sonora should get their own catwalk', undefined ],
	] )( 'turns %j into %j', ( title, name ) => {
		expect( siteNameFrom( title ) ).toBe( name );
	} );
} );
