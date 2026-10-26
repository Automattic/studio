import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { freeTrappedBlocks, trappedFullWidthNotes } from 'cli/ai/block-alignment';
import { cleanupValidatorPages, validateBlocks } from 'cli/ai/block-validator';
import { freeFullWidthBlocks } from 'cli/ai/site-file-guards';

const group = ( attributes: object, inner: string ) =>
	`<!-- wp:group ${ JSON.stringify( attributes ) } --><div>${ inner }</div><!-- /wp:group -->`;
const cover = '<!-- wp:cover {"align":"full","className":"hero"} --><div></div><!-- /wp:cover -->';
const constrained = { layout: { type: 'constrained' } };

describe( 'trappedFullWidthNotes', () => {
	// [ markup, the block named as the one to free ]
	it.each( [
		// A template whose page content sits in a constrained main: the smoke run's.
		[
			group( { tagName: 'main', ...constrained }, '<!-- wp:post-content /-->' ),
			'core/post-content',
		],
		[
			group( { tagName: 'main', ...constrained }, '<!-- wp:post-content {"align":"full"} /-->' ),
			undefined,
		],
		// A full cover inside a group that is held to the content width.
		[ group( constrained, group( constrained, cover ) ), 'core/group' ],
		[ group( { align: 'full', ...constrained }, cover ), undefined ],
		// The legacy layout that inherits the content width is constrained too.
		[ group( { layout: { inherit: true } }, group( {}, cover ) ), 'core/group' ],
		// A group without a constrained layout passes its width through.
		[ group( constrained, group( { align: 'full' }, group( {}, cover ) ) ), undefined ],
		[ cover, undefined ],
		[ group( constrained, cover ), undefined ],
	] )( '%s frees %s', ( markup, stop ) => {
		const notes = trappedFullWidthNotes( markup );
		expect( notes ).toHaveLength( stop ? 1 : 0 );
		if ( stop ) {
			expect( notes[ 0 ] ).toContain( `Give ${ stop } align full.` );
		}
	} );
} );

const main = ( inner: string, attributes: object = constrained ) =>
	`<!-- wp:group ${ JSON.stringify( {
		tagName: 'main',
		...attributes,
	} ) } -->\n<main class="wp-block-group">${ inner }</main>\n<!-- /wp:group -->`;
const classedGroup = ( attributes: object, inner: string ) =>
	`<!-- wp:group ${ JSON.stringify(
		attributes
	) } -->\n<div class="wp-block-group">${ inner }</div>\n<!-- /wp:group -->`;
const fullCover =
	'<!-- wp:cover {"align":"full"} -->\n<div class="wp-block-cover alignfull"><span aria-hidden="true" class="wp-block-cover__background has-background-dim-100 has-background-dim"></span><div class="wp-block-cover__inner-container"></div></div>\n<!-- /wp:cover -->';
const all = () => true;

describe( 'freeTrappedBlocks', () => {
	// [ name, markup, the blocks made align full ]
	it.each< [ string, string, string[] ] >( [
		[
			'page content in a constrained main',
			main( '<!-- wp:post-content {"layout":{"type":"constrained"}} /-->' ),
			[ 'core/post-content' ],
		],
		[
			'a group holding a full cover',
			main( classedGroup( constrained, fullCover ) ),
			[ 'core/group' ],
		],
		[ 'page content that lays out its blocks in flow', main( '<!-- wp:post-content /-->' ), [] ],
		[
			'page content with a class',
			main( '<!-- wp:post-content {"className":"prose","layout":{"type":"constrained"}} /-->' ),
			[],
		],
		[
			'page content with its own content width',
			main( '<!-- wp:post-content {"layout":{"type":"constrained","contentSize":"1240px"}} /-->' ),
			[],
		],
		[
			'page content in a main with its own content width',
			main( '<!-- wp:post-content {"layout":{"type":"constrained"}} /-->', {
				layout: { type: 'constrained', contentSize: '760px' },
			} ),
			[],
		],
		[
			'a group with a background',
			main( classedGroup( { backgroundColor: 'base', ...constrained }, fullCover ) ),
			[],
		],
		[ 'a group with no wrapper class', main( group( constrained, fullCover ) ), [] ],
	] )( 'frees %s', ( _name, markup, freed ) => {
		const result = freeTrappedBlocks( markup, all );
		expect( result.freed ).toEqual( freed );
		if ( freed.length ) {
			expect( trappedFullWidthNotes( result.markup ) ).toEqual( [] );
		} else {
			expect( result.markup ).toBe( markup );
		}
	} );

	it( 'leaves a block type that does not support align full', () => {
		const markup = main( '<!-- wp:post-content {"layout":{"type":"constrained"}} /-->' );
		expect( freeTrappedBlocks( markup, () => false ).freed ).toEqual( [] );
	} );

	it.runIf( process.env.STUDIO_BLOCK_EDITOR_URL )(
		'makes markup the block editor finds valid',
		async () => {
			const { markup } = freeTrappedBlocks( main( classedGroup( constrained, fullCover ) ), all );
			const report = await validateBlocks( markup, process.env.STUDIO_BLOCK_EDITOR_URL ?? '' );
			await cleanupValidatorPages();
			expect( report ).toMatchObject( { invalidBlocks: 0, totalBlocks: 3 } );
		},
		60000
	);
} );

describe.runIf( process.env.STUDIO_TEST_WORDPRESS )( 'freeFullWidthBlocks', () => {
	it( 'saves the template with the blocks core supports align full on', async () => {
		const siteRoot = mkdtempSync( path.join( tmpdir(), 'studio-align-' ) );
		symlinkSync(
			path.join( process.env.STUDIO_TEST_WORDPRESS ?? '', 'wp-includes' ),
			path.join( siteRoot, 'wp-includes' )
		);
		const relativePath = 'wp-content/themes/studio-test-align/templates/page.html';
		mkdirSync( path.dirname( path.join( siteRoot, relativePath ) ), { recursive: true } );
		writeFileSync(
			path.join( siteRoot, relativePath ),
			main( '<!-- wp:post-content {"layout":{"type":"constrained"}} /-->' )
		);
		try {
			const notes = await freeFullWidthBlocks( {
				siteRoot,
				relativePath,
				theme: { slug: 'studio-test-align', dir: '', file: 'templates/page.html' },
			} );
			expect( notes ).toEqual( [
				expect.stringContaining( 'Studio made core/post-content align full' ),
			] );
			expect( readFileSync( path.join( siteRoot, relativePath ), 'utf8' ) ).toContain(
				'<!-- wp:post-content {"layout":{"type":"constrained"},"align":"full"} /-->'
			);
		} finally {
			rmSync( siteRoot, { recursive: true } );
		}
	}, 60000 );
} );
