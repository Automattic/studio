import { readFileSync } from 'fs';
import path from 'path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createBlockExampleNotes } from '@studio/agent/node/block-examples';
import { cleanupValidatorPages } from '@studio/agent/node/block-validator';
import { createFakeHost } from '@studio/agent/node/tests/fake-host';

// A running site's block editor and a WordPress to read core's block.json files from, e.g.
// STUDIO_BLOCK_EDITOR_URL=http://localhost:8881 STUDIO_TEST_WORDPRESS=/path/to/wordpress npx vitest run block-examples
const EDITOR = process.env.STUDIO_BLOCK_EDITOR_URL;
const WORDPRESS = process.env.STUDIO_TEST_WORDPRESS;
const host = createFakeHost();
vi.mocked( host.sites.resolve ).mockImplementation( async ( root ) => ( {
	id: root,
	name: 'Site',
	path: root,
	url: EDITOR ?? '',
	phpVersion: '8.4',
} ) );

const blockJson = ( slug: string ) =>
	readFileSync( path.join( WORDPRESS ?? '', 'wp-includes/blocks', slug, 'block.json' ), 'utf8' );

describe.runIf( EDITOR && WORDPRESS )(
	"the markup the site's editor saves for a block a result shows the block.json of",
	() => {
		afterAll( cleanupValidatorPages );

		// Results read core's block.json files, so they are built when a test runs.
		it.each< {
			name: string;
			results: () => Array< [ string, string, string? ] >;
			notes: string[][];
		} >( [
			{
				name: 'from its example, once per site',
				results: () => [
					[ '/a', `$ cat wp-includes/blocks/details/block.json\n${ blockJson( 'details' ) }` ],
					[ '/a', blockJson( 'details' ) ],
					[ '/b', blockJson( 'details' ) ],
				],
				notes: [
					[
						'core/details, from the example its block type registers, as its inserter preview makes it (getBlockFromExample in @wordpress/blocks), to write it from:\n<!-- wp:details {"showContent":true} -->\n<details class="wp-block-details" open><summary>La Mancha</summary><!-- wp:paragraph -->',
					],
					[],
					[ 'core/details, from the example its block type registers' ],
				],
			},
			{
				name: 'for each block.json a result shows, without an example from its defaults',
				results: () => [
					[ '/a', `${ blockJson( 'accordion-heading' ) }\n${ blockJson( 'buttons' ) }` ],
				],
				notes: [
					[
						'core/accordion-heading, from its default attributes (createBlock in @wordpress/blocks), to write it from:\n<!-- wp:accordion-heading -->',
						'core/buttons, from the example its block type registers',
					],
				],
			},
			{
				// A plugin's block registered from its script has no block.json to show.
				name: 'for a block.json a call looks up, found or not, by its folder in its namespace',
				results: () => [
					[ '/a', '', 'cat wp-includes/blocks/details/block.json 2>/dev/null' ],
					[ '/a', '', 'cat wp-content/plugins/studio-test/src/blocks/unregistered/block.json' ],
				],
				notes: [ [ 'core/details, from the example its block type registers' ], [] ],
			},
			{
				name: 'not for a block the editor does not register, nor for markup naming a block',
				results: () => [
					[ '/a', '{ "apiVersion": 3, "name": "studio-test/unregistered" }' ],
					[ '/a', '<!-- wp:group {"name":"core/details"} /-->' ],
				],
				notes: [ [], [] ],
			},
		] )(
			'$name',
			async ( { results, notes } ) => {
				const describe = createBlockExampleNotes( host );
				for ( const [ i, [ site, text, request ] ] of results().entries() ) {
					const said = await describe( site, text, request );
					expect( said ).toHaveLength( notes[ i ].length );
					notes[ i ].forEach( ( note, j ) =>
						expect( said[ j ] ).toContain( `What the site's block editor saves for ${ note }` )
					);
				}
			},
			120_000
		);
	}
);
