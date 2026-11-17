import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';
import { storePresetValues, validateBlocks } from '@studio/agent/node/block-validator';
import { OpenProblems } from '@studio/agent/node/open-problems';
import { postContentChanges } from '@studio/agent/node/post-content-check';
import { SiteChanges } from '@studio/agent/node/site-changes';
import { createFakeHost } from '@studio/agent/node/tests/fake-host';
import { createSite } from '@studio/agent/node/tests/fixtures/wordpress-site';
import type { HostSite } from '@studio/agent/shared/host';

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
	// eval29's ledes: a width no attribute of the paragraph saves, which the
	// fix gives as a block style of the active theme when it is a block theme.
	it.each( [
		{ name: 'gives the block a block style of a block theme', blockTheme: true },
		{ name: 'keeps the block as written for a classic theme', blockTheme: false },
	] )( 'for a style no attribute saves on a block, $name', async ( { blockTheme } ) => {
		const { site, host, changes } = setup();
		const theme = path.join( site.root, 'wp-content/themes/bakery' );
		if ( blockTheme ) {
			mkdirSync( path.join( theme, 'templates' ) );
			writeFileSync( path.join( theme, 'templates/index.html' ), '' );
		}
		vi.mocked( host.sites.wpCli ).mockImplementation( async ( _site, args ) => {
			const saved = /'ID' => (\d+), 'post_content' => file_get_contents\( "([^"]+)" \)/.exec(
				args.join( ' ' )
			);
			if ( saved ) {
				site.edit(
					Number( saved[ 1 ] ),
					readFileSync( saved[ 2 ], 'utf8' ),
					'2026-10-24 00:00:00'
				);
			}
			return {
				exitCode: 0,
				stdout: JSON.stringify( { colors: [], fontSizes: [], spacingSizes: [] } ),
				stderr: '',
			};
		} );
		const lede = ( className: string ) =>
			`<!-- wp:paragraph${
				className && ` {"className":"${ className }"}`
			} -->\n<p class="${ className }"${
				className ? '' : ' style="max-width:640px"'
			}>Three voices</p>\n<!-- /wp:paragraph -->`;
		const styled = lede( 'is-style-max-width-640px' );
		vi.mocked( validateBlocks ).mockImplementation( async ( content, ...args ) => {
			if ( content === styled ) {
				return { totalBlocks: 1, validBlocks: 1, invalidBlocks: 0, results: [] };
			}
			return {
				totalBlocks: 1,
				validBlocks: 0,
				invalidBlocks: 1,
				results: [
					{
						blockName: 'core/paragraph',
						place: '/0',
						isValid: false,
						issues: [ 'mismatch' ],
						originalContent: '',
					},
				],
				proposedFix: {
					fixedContent: args[ 3 ] ? styled : lede( '' ),
					losses: args[ 3 ]
						? []
						: [
								{
									place: '/0',
									blockName: 'core/paragraph',
									lost: 'drop the styles max-width:640px',
									note: 'drop max-width:640px from p',
								},
						  ],
					...( args[ 3 ] && {
						blockStyles: [
							{
								place: '/0',
								blockName: 'core/paragraph',
								slug: 'max-width-640px',
								css: 'max-width:640px',
							},
						],
					} ),
					report: { totalBlocks: 1, validBlocks: 1, invalidBlocks: 0, results: [] },
				},
			};
		} );
		site.save( 51, 'page', 'about', '', 1, 'publish', 'About' );
		await changes.snapshot();
		site.edit( 51, lede( '' ) );
		try {
			const { summaries, problems } = await changes.settle();
			const styleFile = path.join( theme, 'styles/blocks/max-width-640px.json' );
			if ( ! blockTheme ) {
				expect( existsSync( styleFile ) ).toBe( false );
				expect( site.content( 51 ) ).toBe( lede( '' ) );
				expect( problems.join( '\n' ) ).toContain(
					'saving it as the block saves it would drop max-width:640px from p, as nothing in its comment attributes saves that.'
				);
				return;
			}
			expect( site.content( 51 ) ).toBe( styled );
			expect( JSON.parse( readFileSync( styleFile, 'utf8' ) ) ).toMatchObject( {
				slug: 'max-width-640px',
				blockTypes: [ 'core/paragraph' ],
				styles: { css: 'max-width:640px' },
			} );
			expect( problems ).toEqual( [] );
			expect( summaries.join( '\n' ) ).toContain(
				`Studio saved the block editor's save of it, which fixes 1 block(s) that do not match what the block saves and moves max-width:640px on core/paragraph into the block style ${ styleFile }, which WordPress registers for its "blockTypes"`
			);
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

	// eval36-37: WooCommerce's activation made its Refund and Returns Policy
	// page, whose invalid blocks the agent was told to fix on every later call.
	it.each( [
		{ activates: false, told: [ 'page 35', 'page 37' ] },
		{ activates: true, told: [ 'page 35' ] },
	] )(
		'tells the problems of the posts a call made unless it activated code, which made them',
		async ( { activates, told } ) => {
			const { site, open, changes } = setup();
			const unclosed = '<!-- wp:group --><div class="wp-block-group">';
			site.save( 35, 'page', 'home', '', 1, 'publish', 'Home' );
			await changes.snapshot();
			site.edit( 35, unclosed );
			site.save( 37, 'page', 'refund', unclosed, 1, 'draft', 'Refund' );
			if ( activates ) {
				site.setOptions( { active_plugins: 'a:1:{i:0;s:15:"shop/shop.php";}' } );
			}
			const pages = ( problems: string[] ) =>
				problems.map( ( problem ) => /page \d+/.exec( problem )?.[ 0 ] );
			expect( pages( ( await changes.settle() ).problems ) ).toEqual( told );
			// Still open at the turn's end, only those told.
			expect( pages( await open.raise() ) ).toEqual( told );
		}
	);

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

	// eval31 pileon port 4: a block the theme registers in PHP only, given
	// "autoRegister" in functions.php, which registers it in the editor.
	it( 'validates a post left with a problem again once the code registering its blocks changes', async () => {
		const { site, open, changes } = setup();
		const functions = path.join( site.root, 'wp-content/themes/bakery/functions.php' );
		writeFileSync( functions, "<?php register_block_type( 'sudsy/newsletter' );" );
		site.save( 15, 'page', 'news', '', 1, 'publish', 'News' );
		await changes.snapshot();
		vi.mocked( validateBlocks ).mockImplementation( async () =>
			readFileSync( functions, 'utf8' ).includes( 'autoRegister' )
				? { totalBlocks: 1, validBlocks: 1, invalidBlocks: 0, results: [] }
				: {
						totalBlocks: 1,
						validBlocks: 0,
						invalidBlocks: 1,
						results: [
							{
								blockName: 'sudsy/newsletter',
								place: '/0',
								isValid: false,
								issues: [ 'unsupported' ],
								originalContent: '',
							},
						],
				  }
		);
		try {
			site.edit( 15, '<!-- wp:sudsy/newsletter /-->' );
			const [ problem ] = ( await changes.settle() ).problems;
			expect( problem ).toContain( 'sudsy/newsletter: unsupported' );
			expect( await open.raise() ).toEqual( [ problem ] );

			writeFileSync(
				functions,
				"<?php register_block_type( 'sudsy/newsletter', array( 'supports' => array( 'autoRegister' => true ) ) );"
			);
			await changes.settle();
			expect( await open.raise() ).toEqual( [] );
			expect( open.remind() ).toEqual( [] );
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

	// The posts a check saves, and its notes, when the call that changed them
	// activated code or not.
	async function settleRepeatedSizes( activates: boolean ) {
		const { site, host, changes } = setup();
		const themeJson = path.join( site.root, 'wp-content/themes/bakery/theme.json' );
		writeFileSync(
			themeJson,
			'{ "version": 3, "settings": { "typography": { "fontSizes": [] } } }'
		);
		const sizes = () =>
			(
				JSON.parse( readFileSync( themeJson, 'utf8' ) ).settings.typography.fontSizes as Array< {
					slug: string;
					size: string;
				} >
			 ).map( ( { slug, size } ): [ string, string ] => [ slug, size ] );
		// WordPress resolves the font sizes theme.json holds, and saves a post's content.
		const saves: number[] = [];
		vi.mocked( host.sites.wpCli ).mockImplementation( async ( _site, args ) => {
			const saved = /'ID' => (\d+), 'post_content' => file_get_contents\( "([^"]+)" \)/.exec(
				args.join( ' ' )
			);
			if ( saved ) {
				saves.push( Number( saved[ 1 ] ) );
				site.edit(
					Number( saved[ 1 ] ),
					readFileSync( saved[ 2 ], 'utf8' ),
					'2026-10-24 00:00:00'
				);
			}
			return {
				exitCode: 0,
				stdout: JSON.stringify( { colors: [], fontSizes: sizes(), spacingSizes: [] } ),
				stderr: '',
			};
		} );
		// The editor stores a value a preset has as the preset, taking longest on the first posts.
		const raw = '{"style":{"typography":{"fontSize":"2.2rem"}}}';
		let storing = 0;
		let most = 0;
		vi.mocked( storePresetValues ).mockImplementation( async ( content, _url, presets ) => {
			storing++;
			most = Math.max( most, storing );
			const id = Number( /Page (\d+)/.exec( content )?.[ 1 ] );
			await new Promise( ( resolve ) => setTimeout( resolve, ( 60 - id ) * 10 ) );
			storing--;
			const preset = presets.fontSizes.find( ( [ , size ] ) => size === '2.2rem' );
			return preset && content.includes( raw )
				? {
						content: content.split( raw ).join( `{"fontSize":"${ preset[ 0 ] }"}` ),
						colors: [],
						fontSizes: [ { size: '2.2rem', slug: preset[ 0 ] } ],
						spacingSizes: [],
				  }
				: { content, colors: [], fontSizes: [], spacingSizes: [] };
		} );
		const large = ( id: number ) =>
			`<!-- wp:paragraph ${ raw } -->\n<p style="font-size:2.2rem">Page ${ id }</p>\n<!-- /wp:paragraph -->`;
		// Posts the call does not change, which set the value too.
		const rest = [ 44, 45, 46, 47, 48 ];
		for ( const id of rest ) {
			site.save( id, 'page', `page-${ id }`, large( id ), 1, 'publish', `Page ${ id }` );
		}
		const ids = [ 41, 42 ];
		for ( const id of ids ) {
			site.save( id, 'page', `page-${ id }`, '', 1, 'publish', `Page ${ id }` );
		}
		await changes.snapshot();
		ids.forEach( ( id ) => site.edit( id, large( id ) ) );
		if ( activates ) {
			site.setOptions( { active_plugins: 'a:1:{i:0;s:15:"shop/shop.php";}' } );
		}
		try {
			const { summaries } = await changes.settle();
			return { saves: [ ...saves ].sort(), summaries, most, content: site.content };
		} finally {
			vi.mocked( storePresetValues ).mockReset();
			vi.mocked( storePresetValues ).mockImplementation( async ( content: string ) => ( {
				content,
				colors: [],
				fontSizes: [],
				spacingSizes: [],
			} ) );
		}
	}

	// eval26 picky4: the first page's presets saved the other three pages, which
	// the check then validated and saved again, and saved the rest one by one.
	it( 'saves the posts a check saves anyway once, and the others that take the new presets side by side', async () => {
		const { saves, summaries, most, content } = await settleRepeatedSizes( false );
		expect( saves ).toEqual( [ 41, 42, 44, 45, 46, 47, 48 ] );
		for ( const id of saves ) {
			expect( content( id ) ).toContain( '{"fontSize":"size-2-2-rem"}' );
		}
		expect( summaries[ 0 ] ).toContain(
			'Studio saved post 42, post 44, post 45, post 46, post 47, post 48, which set the same values, through the block editor with those presets'
		);
		expect( most ).toBe( 3 );
	} );

	it( 'saves the posts a check does not save, after code activated, for the new presets', async () => {
		const { saves, content } = await settleRepeatedSizes( true );
		expect( saves ).toEqual( [ 42, 44, 45, 46, 47, 48 ] );
		expect( content( 42 ) ).toContain( '{"fontSize":"size-2-2-rem"}' );
	} );
} );
