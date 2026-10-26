import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { emptyBlocks, renderedBlocks } from 'cli/ai/block-render-check';
import { runWpCli } from 'cli/ai/tools/utils';
import type { SiteData } from 'cli/lib/cli-config/core';

vi.mock( 'cli/lib/daemon-client', () => ( {
	connectToDaemon: vi.fn(),
	disconnectFromDaemon: vi.fn(),
} ) );

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
	let site: SiteData;
	const create = async ( content: string ) =>
		Number(
			(
				await runWpCli( site, [
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
		site = { id: 'site', name: 'Seaside Gallery', path: root } as SiteData;
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
		expect( ( await emptyBlocks( site, [ id ] ) )[ id ] ).toEqual( empty );
	} );

	it( 'names the render file of a block whose block.json render prints nothing', async () => {
		const id = await create( '<!-- wp:studio-test/returns /-->' );
		const { reports } = await renderedBlocks.check(
			site,
			{ [ id ]: 'before' },
			{ [ id ]: 'written' }
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
				await runWpCli( site, [
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
			( await renderedBlocks.check( site, { [ id ]: 'before' }, { [ id ]: 'written' } ) ).reports
		).toEqual( [] );
	} );

	it( 'raises the problem on the post that renders nothing, until it renders', async () => {
		const id = await create( image );
		const reports = ( versions: Record< string, string > ) =>
			renderedBlocks.check( site, { [ id ]: 'before' }, versions ).then( ( r ) => r.reports );
		expect( await reports( { [ id ]: 'written' } ) ).toEqual( [
			{
				key: `rendered ${ id }`,
				problem: expect.stringContaining(
					`Seaside Gallery page ${ id } "Gallery": WordPress renders these blocks as nothing on the front end (render_block() through the_content, in wp-includes/blocks.php): core/image, written without saved HTML, which its block.json reads `
				),
			},
		] );
		expect( ( await reports( { [ id ]: 'written' } ) )[ 0 ].problem ).toMatch(
			/ The block editor writes a block's saved HTML from its attributes when it inserts it\.$/
		);
		await runWpCli( site, [ 'post', 'update', String( id ), `--post_content=${ savedImage }` ] );
		expect( await reports( { [ id ]: 'fixed' } ) ).toEqual( [
			{ key: `rendered ${ id }`, problem: undefined },
		] );
	} );
} );
