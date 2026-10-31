import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from 'fs';
import os from 'os';
import path from 'path';
import { emptyBlocks, renderedBlocks } from '@studio/agent/node/block-render-check';
import { runWpCli } from '@studio/agent/node/tools/utils';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { liveHost, liveSite } from 'cli/ai/tests/live-host';
import type { HostSite, StudioAgentHost } from '@studio/agent/node';

// A real WordPress install to render content with, when one is given.
const WORDPRESS = process.env.STUDIO_TEST_WORDPRESS;

const image = '<!-- wp:image {"id":5,"sizeSlug":"large"} /-->';
const savedImage =
	'<!-- wp:image {"sizeSlug":"large"} --><figure class="wp-block-image size-large"><img src="https://example.com/a.png" alt=""/></figure><!-- /wp:image -->';
// A dynamic block that renders its own output from its inner blocks' attributes.
const wrapper = `<?php
add_action( 'init', function () {
	register_block_type( 'studio-test/wrapper', array( 'render_callback' => function () { return '<div>Wrapped</div>'; } ) );
	register_block_type( __DIR__ . '/returns' );
	register_block_type( 'studio-test/cart', array( 'render_callback' => function () { return is_user_logged_in() ? '<a>Cart</a>' : ''; } ) );
} );
`;
// A block.json render file that returns its HTML instead of printing it.
const returns = {
	'block.json': JSON.stringify( {
		apiVersion: 3,
		name: 'studio-test/returns',
		title: 'Returns',
		render: 'file:./render.php',
	} ),
	'render.php': "<?php\nreturn '<p>Hours</p>';\n",
};

describe.runIf( WORDPRESS )( 'the blocks WordPress renders as nothing', () => {
	let site: HostSite;
	let host: StudioAgentHost;
	const create = async ( content: string ) =>
		Number(
			(
				await runWpCli( host, site, [
					'post',
					'create',
					'--post_type=page',
					'--post_status=publish',
					'--post_title=Gallery',
					`--post_content=${ content }`,
					'--porcelain',
				] )
			).trim()
		);
	beforeAll( () => {
		const root = mkdtempSync( path.join( os.tmpdir(), 'block-render-check-' ) );
		cpSync( WORDPRESS!, root, { recursive: true } );
		mkdirSync( path.join( root, 'wp-content/mu-plugins' ), { recursive: true } );
		writeFileSync( path.join( root, 'wp-content/mu-plugins/wrapper.php' ), wrapper );
		mkdirSync( path.join( root, 'wp-content/mu-plugins/returns' ) );
		for ( const [ name, text ] of Object.entries( returns ) ) {
			writeFileSync( path.join( root, 'wp-content/mu-plugins/returns', name ), text );
		}
		site = liveSite( root, 'Seaside Gallery' );
		host = liveHost( site );
	} );
	afterAll( () => rmSync( site.path, { recursive: true, force: true } ) );

	it.each( [
		{
			name: 'a block written without the saved HTML its attributes are read from',
			content: image,
			empty: [
				{
					name: 'core/image',
					saved: false,
					sourced: expect.arrayContaining( [ 'url', 'alt' ] ),
					render: null,
				},
			],
		},
		{
			name: 'the same block inside a static one',
			content: `<!-- wp:group --><div class="wp-block-group">${ image }</div><!-- /wp:group -->`,
			empty: [
				{
					name: 'core/image',
					saved: false,
					sourced: expect.arrayContaining( [ 'url' ] ),
					render: null,
				},
			],
		},
		{ name: 'a block with its saved HTML', content: savedImage, empty: [] },
		{
			name: 'the blank lines between blocks',
			content: `${ savedImage }\n\n<!-- wp:paragraph --><p>Tide</p><!-- /wp:paragraph -->`,
			empty: [],
		},
		{
			name: 'an empty paragraph, which still renders its tag',
			content: '<!-- wp:paragraph --><p></p><!-- /wp:paragraph -->',
			empty: [],
		},
		{
			name: 'a block a dynamic block renders into its own output',
			content: `<!-- wp:studio-test/wrapper -->${ image }<!-- /wp:studio-test/wrapper -->`,
			empty: [],
		},
	] )( '$name', async ( { content, empty } ) => {
		const id = await create( content );
		expect( ( await emptyBlocks( host, site, [ id ] ) )[ id ] ).toEqual( empty );
	} );

	it( 'names the render file of a block whose block.json render prints nothing', async () => {
		const id = await create( '<!-- wp:studio-test/returns /-->' );
		const { reports } = await renderedBlocks.check(
			site,
			{ [ id ]: 'before' },
			{ [ id ]: 'written' },
			host
		);
		expect( reports[ 0 ].problem ).toBe(
			`Seaside Gallery page ${ id } "Gallery": WordPress renders these blocks as nothing on the front end (render_block() through the_content, in wp-includes/blocks.php): studio-test/returns, whose output is what ${ realpathSync(
				path.join( site.path, 'wp-content/mu-plugins/returns/render.php' )
			) } prints: register_block_type_from_metadata() (wp-includes/blocks.php) requires the file inside ob_start() and returns ob_get_clean().`
		);
	} );

	it( 'leaves content the front end renders only inside another, as a pattern is', async () => {
		const id = Number(
			(
				await runWpCli( host, site, [
					'post',
					'create',
					'--post_type=wp_block',
					'--post_status=publish',
					'--post_title=Slides',
					`--post_content=${ image }`,
					'--porcelain',
				] )
			).trim()
		);
		expect(
			( await renderedBlocks.check( site, { [ id ]: 'before' }, { [ id ]: 'written' }, host ) )
				.reports
		).toEqual( [] );
	} );

	describe( 'a changed template or template part, rendered in the front page', () => {
		const theme = ( file: string ) =>
			path.join( site.path, 'wp-content/themes/twentytwentyfive', file );
		const cart = '<!-- wp:studio-test/cart /-->';
		const stated =
			'Seaside Gallery front page: of the blocks in the changed templates, template parts and patterns, WordPress renders studio-test/cart as nothing for a visitor who is not logged in (render_block() through get_the_block_template_html(), in wp-includes/block-template.php).';
		// A theme file as a call writes it, and what the next call is told.
		const write = async ( file: string, markup: string ) => {
			const before = await renderedBlocks.read( site.path, undefined, host );
			writeFileSync( theme( file ), markup );
			const after = await renderedBlocks.read( site.path, undefined, host );
			return ( await renderedBlocks.check( site, before, after, host ) ).reports;
		};
		const released: Record< string, string > = {};
		beforeAll( () => {
			for ( const file of [ 'parts/header.html', 'parts/footer.html' ] ) {
				released[ file ] = readFileSync( theme( file ), 'utf8' );
			}
		} );
		afterEach( () => {
			for ( const [ file, text ] of Object.entries( released ) ) {
				writeFileSync( theme( file ), text );
			}
			rmSync( theme( 'templates/front-page.html' ), { force: true } );
		} );

		it( 'states the blocks it holds that render as nothing for a visitor', async () => {
			expect(
				await write( 'parts/header.html', `${ released[ 'parts/header.html' ] }${ cart }` )
			).toEqual( [ { key: 'front page rendered', summary: stated } ] );
		} );

		it( 'states the blocks of a template part saved in the Site Editor', async () => {
			const before = await renderedBlocks.read( site.path, undefined, host );
			// As the Site Editor saves a part: a wp_template_part post of the theme and area.
			const id = await runWpCli( host, site, [
				'eval',
				`$id = wp_insert_post( array( 'post_type' => 'wp_template_part', 'post_name' => 'header', 'post_status' => 'publish', 'post_title' => 'Header', 'post_content' => ${ JSON.stringify(
					released[ 'parts/header.html' ] + cart
				) } ) ); wp_set_object_terms( $id, get_stylesheet(), 'wp_theme' ); wp_set_object_terms( $id, 'header', 'wp_template_part_area' ); echo $id;`,
			] );
			try {
				const after = await renderedBlocks.read( site.path, undefined, host );
				expect( ( await renderedBlocks.check( site, before, after, host ) ).reports ).toEqual( [
					{ key: 'front page rendered', summary: stated },
				] );
			} finally {
				await runWpCli( host, site, [ 'post', 'delete', id.trim(), '--force' ] );
			}
		} );

		it( 'renders the template WordPress picks for the front page', async () => {
			expect(
				await write(
					'templates/front-page.html',
					`<!-- wp:template-part {"slug":"header"} /-->${ cart }`
				)
			).toEqual( [ { key: 'front page rendered', summary: stated } ] );
		} );

		it.each( [
			{ name: 'blocks that render', markup: '' },
			{
				name: 'a block a dynamic block renders into its own output',
				markup: `<!-- wp:studio-test/wrapper -->${ image }<!-- /wp:studio-test/wrapper -->`,
			},
		] )( 'states nothing for $name', async ( { markup } ) => {
			expect(
				await write(
					'parts/header.html',
					`${ released[ 'parts/header.html' ] }<!-- wp:paragraph --><p>Open</p><!-- /wp:paragraph -->${ markup }`
				)
			).toEqual( [] );
		} );

		describe( 'with a page as the front page', () => {
			beforeAll( async () => {
				const page = await create( image );
				await runWpCli( host, site, [ 'option', 'update', 'show_on_front', 'page' ] );
				await runWpCli( host, site, [ 'option', 'update', 'page_on_front', String( page ) ] );
			} );
			afterAll( () => runWpCli( host, site, [ 'option', 'update', 'show_on_front', 'posts' ] ) );

			it( "leaves the page's content, which the posts are checked for", async () => {
				expect(
					await write( 'parts/header.html', `${ released[ 'parts/header.html' ] }${ savedImage }` )
				).toEqual( [] );
			} );

			it( 'states the blocks of a part rendered after the content', async () => {
				expect(
					await write( 'parts/footer.html', `${ released[ 'parts/footer.html' ] }${ cart }` )
				).toEqual( [ { key: 'front page rendered', summary: stated } ] );
			} );
		} );
	} );

	it( 'raises the problem on the post that renders nothing, until it renders', async () => {
		const id = await create( image );
		const reports = ( versions: Record< string, string > ) =>
			renderedBlocks.check( site, { [ id ]: 'before' }, versions, host ).then( ( r ) => r.reports );
		expect( await reports( { [ id ]: 'written' } ) ).toEqual( [
			{
				key: `rendered ${ id }`,
				post: id,
				problem: expect.stringContaining(
					`Seaside Gallery page ${ id } "Gallery": WordPress renders these blocks as nothing on the front end (render_block() through the_content, in wp-includes/blocks.php): core/image, written without saved HTML, which its block.json reads `
				),
			},
		] );
		expect( ( await reports( { [ id ]: 'written' } ) )[ 0 ].problem ).toMatch(
			/ The block editor writes a block's saved HTML from its attributes when it inserts it\.$/
		);
		await runWpCli( host, site, [
			'post',
			'update',
			String( id ),
			`--post_content=${ savedImage }`,
		] );
		expect( await reports( { [ id ]: 'fixed' } ) ).toEqual( [
			{ key: `rendered ${ id }`, post: id, problem: undefined },
		] );
	} );
} );
