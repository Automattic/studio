import { readFileSync, writeFileSync } from 'fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';
import { validateBlocks } from '@studio/agent/node/block-validator';
import { OpenProblems } from '@studio/agent/node/open-problems';
import { postContentChanges } from '@studio/agent/node/post-content-check';
import { SiteChanges } from '@studio/agent/node/site-changes';
import { createFakeHost } from '@studio/agent/node/tests/fake-host';
import { createSite } from '@studio/agent/node/tests/fixtures/wordpress-site';
import type { HostSite } from '@studio/agent/node/host';

// The block editor, which the unit tests do not load: every block is valid,
// and its save changes nothing.
vi.mock( '@studio/agent/node/block-validator', async () => ( {
	...( await vi.importActual< typeof import('@studio/agent/node/block-validator') >(
		'@studio/agent/node/block-validator'
	) ),
	validateBlocks: vi.fn( async () => ( {
		totalBlocks: 1,
		validBlocks: 1,
		invalidBlocks: 0,
		results: [],
	} ) ),
	storePresetValues: vi.fn( async ( content: string ) => ( {
		content,
		colors: [],
		fontSizes: [],
		spacingSizes: [],
	} ) ),
	bindNavigationLinks: vi.fn( async ( content: string ) => ( { content, links: [] } ) ),
} ) );

// A site whose post checks record their problems, and whose WordPress
// resolves the color presets the test sets.
function setup() {
	const site = createSite();
	const hostSite = {
		id: 'bakery',
		path: site.root,
		url: 'http://localhost:8881',
		name: 'Bakery',
	} as HostSite;
	const colors: Array< [ string, string ] > = [ [ 'base', '#ffffff' ] ];
	const host = createFakeHost();
	vi.mocked( host.sites.resolve ).mockResolvedValue( hostSite );
	vi.mocked( host.sites.wpCli ).mockImplementation( async () => ( {
		exitCode: 0,
		stdout: JSON.stringify( { colors, fontSizes: [], spacingSizes: [] } ),
		stderr: '',
	} ) );
	const open = new OpenProblems( [] );
	const changes = new SiteChanges( host, open, async () => [ hostSite ], [ postContentChanges ] );
	return { site, colors, host, open, changes };
}

// The WP-CLI calls that resolved the site's presets (theme-presets.ts).
const presetResolves = ( host: ReturnType< typeof createFakeHost > ) =>
	vi
		.mocked( host.sites.wpCli )
		.mock.calls.filter( ( [ , args ] ) => args.join( ' ' ).includes( 'wp_get_global_settings()' ) )
		.length;

const deepGroup = ( text: string ) =>
	`<!-- wp:group {"backgroundColor":"deep"} -->\n<div class="wp-block-group has-deep-background-color has-background"><p>${ text }</p></div>\n<!-- /wp:group -->`;

describe( 'postContentChanges', () => {
	// eval28 redo1: page 35, deleted, kept its unclosed block open in later checks.
	it( 'leaves no problem open for a post deleted or trashed', async () => {
		const { site, open, changes } = setup();
		site.save( 35, 'page', 'home', '', 1, 'publish', 'Home' );
		site.save( 36, 'page', 'about', '', 1, 'publish', 'About' );
		await changes.snapshot();
		site.edit( 35, '<!-- wp:group --><div class="wp-block-group">' );
		site.edit( 36, '<!-- wp:group --><div class="wp-block-group">' );
		expect( ( await changes.settle() ).problems ).toHaveLength( 2 );
		open.look();

		const db = new DatabaseSync( path.join( site.root, 'wp-content/database/.ht.sqlite' ) );
		db.exec( "DELETE FROM wp_posts WHERE ID = 35; UPDATE wp_posts SET post_status = 'trash'" );
		db.close();
		expect( await changes.settle() ).toEqual( { summaries: [], problems: [], written: [] } );
		expect( open.look() ).toEqual( [] );
	} );

	// eval26 redo1: pages 14 and 17 named colors the model then added to
	// theme.json, and their problems stayed open, naming the old palette.
	it( 'validates a post left with a problem again once the presets change, without a note', async () => {
		const { site, colors, open, changes } = setup();
		site.save( 14, 'page', 'home', '', 1, 'publish', 'Home' );
		await changes.snapshot();
		site.edit(
			14,
			'<!-- wp:group {"backgroundColor":"deep"} -->\n<div class="wp-block-group has-deep-background-color has-background"></div>\n<!-- /wp:group -->'
		);
		const [ problem ] = ( await changes.settle() ).problems;
		expect( problem ).toContain( 'line 1: core/group color deep' );
		expect( open.look() ).toEqual( [] );

		colors.push( [ 'deep', '#0b2a3a' ] );
		writeFileSync(
			path.join( site.root, 'wp-content/themes/bakery/theme.json' ),
			'{ "version": 3, "settings": { "color": { "palette": [ { "slug": "deep" } ] } } }'
		);
		expect( await changes.settle() ).toEqual( { summaries: [], problems: [], written: [] } );
		expect( open.look() ).toEqual( [] );
		expect( await open.raise() ).toEqual( [] );
	} );

	// eval26 picky4: four pages a call created were validated one after another,
	// about 7.6s each, and the next call waited for all of them.
	it( 'validates the posts a call changed side by side, reporting them in their order', async () => {
		const { site, changes } = setup();
		const ids = [ 21, 22, 23, 24, 25 ];
		for ( const id of ids ) {
			site.save( id, 'page', `page-${ id }`, '', 1, 'publish', `Page ${ id }` );
		}
		await changes.snapshot();
		ids.forEach( ( id ) => site.edit( id, deepGroup( `Page ${ id }` ) ) );
		// The editor takes longest on the first posts, so they finish last.
		const validating = new Set< string >();
		let most = 0;
		vi.mocked( validateBlocks ).mockImplementation( async ( content ) => {
			const id = Number( /Page (\d+)/.exec( content )?.[ 1 ] );
			validating.add( content );
			most = Math.max( most, validating.size );
			await new Promise( ( resolve ) => setTimeout( resolve, ( 26 - id ) * 20 ) );
			validating.delete( content );
			return { totalBlocks: 1, validBlocks: 1, invalidBlocks: 0, results: [] };
		} );
		try {
			const { problems } = await changes.settle();
			expect( problems.map( ( problem ) => /page (\d+)/.exec( problem )?.[ 1 ] ) ).toEqual(
				ids.map( String )
			);
			expect( problems[ 0 ] ).toContain( 'line 1: core/group color deep' );
			expect( most ).toBe( 3 );
		} finally {
			vi.mocked( validateBlocks ).mockReset();
			vi.mocked( validateBlocks ).mockResolvedValue( {
				totalBlocks: 1,
				validBlocks: 1,
				invalidBlocks: 0,
				results: [],
			} );
		}
	} );

	it( 'resolves the presets once for the posts a check validates, and again once theme.json changes', async () => {
		const { site, host, changes } = setup();
		const ids = [ 31, 32, 33 ];
		for ( const id of ids ) {
			site.save( id, 'page', `page-${ id }`, '', 1, 'publish', `Page ${ id }` );
		}
		await changes.snapshot();
		ids.forEach( ( id ) => site.edit( id, deepGroup( `Page ${ id }` ) ) );
		expect( ( await changes.settle() ).problems ).toHaveLength( 3 );
		const resolves = presetResolves( host );
		expect( resolves ).toBe( 1 );

		ids.forEach( ( id ) =>
			site.edit( id, deepGroup( `Page ${ id } again` ), '2026-10-24 00:00:00' )
		);
		await changes.settle();
		expect( presetResolves( host ) ).toBe( resolves );

		writeFileSync(
			path.join( site.root, 'wp-content/themes/bakery/theme.json' ),
			'{ "version": 3, "settings": { "color": { "palette": [ { "slug": "deep" } ] } } }'
		);
		ids.forEach( ( id ) =>
			site.edit( id, deepGroup( `Page ${ id } once more` ), '2026-10-25 00:00:00' )
		);
		await changes.settle();
		expect( presetResolves( host ) ).toBe( resolves + 1 );
	} );

	// A post's repeated values can become presets of the theme, written to its
	// theme.json, which the next post's are made with.
	it( 'makes the presets of one post after another, as each can add to theme.json', async () => {
		const { site, host, changes } = setup();
		const themeJson = path.join( site.root, 'wp-content/themes/bakery/theme.json' );
		writeFileSync(
			themeJson,
			'{ "version": 3, "settings": { "typography": { "fontSizes": [] } } }'
		);
		// WordPress resolves the font sizes theme.json holds.
		vi.mocked( host.sites.wpCli ).mockImplementation( async () => ( {
			exitCode: 0,
			stdout: JSON.stringify( {
				colors: [],
				fontSizes: (
					JSON.parse( readFileSync( themeJson, 'utf8' ) ).settings.typography.fontSizes as Array< {
						slug: string;
						size: string;
					} >
				 ).map( ( { slug, size } ) => [ slug, size ] ),
				spacingSizes: [],
			} ),
			stderr: '',
		} ) );
		const large = ( text: string ) =>
			`<!-- wp:paragraph {"style":{"typography":{"fontSize":"2.2rem"}}} -->\n<p style="font-size:2.2rem">${ text }</p>\n<!-- /wp:paragraph -->`;
		const ids = [ 41, 42, 43 ];
		for ( const id of ids ) {
			site.save( id, 'page', `page-${ id }`, '', 1, 'publish', `Page ${ id }` );
		}
		await changes.snapshot();
		ids.forEach( ( id ) =>
			site.edit( id, [ 1, 2, 3 ].map( ( n ) => large( `Page ${ id } ${ n }` ) ).join( '\n\n' ) )
		);
		const { summaries } = await changes.settle();
		expect(
			summaries.filter( ( summary ) => summary.includes( 'Studio made the font sizes' ) )
		).toHaveLength( 1 );
		expect( JSON.parse( readFileSync( themeJson, 'utf8' ) ).settings.typography.fontSizes ).toEqual(
			[ { name: '2.2rem', slug: expect.any( String ), size: '2.2rem' } ]
		);
	} );
} );
