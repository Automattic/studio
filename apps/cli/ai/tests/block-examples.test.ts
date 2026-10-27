import { readFileSync } from 'fs';
import path from 'path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createBlockExampleNotes } from 'cli/ai/block-examples';
import { cleanupValidatorPages } from 'cli/ai/block-validator';

// A running site's block editor, e.g.
// STUDIO_BLOCK_EDITOR_URL=http://localhost:8881 npx vitest run block-examples
const EDITOR = process.env.STUDIO_BLOCK_EDITOR_URL;

vi.mock( 'cli/lib/daemon-client', () => ( {
	connectToDaemon: vi.fn(),
	disconnectFromDaemon: vi.fn(),
} ) );
vi.mock( 'cli/ai/tools/utils', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('cli/ai/tools/utils') >() ),
	resolveSite: async ( root: string ) => ( { id: root, name: 'Site', path: root, url: EDITOR } ),
} ) );

const blocks = path.join(
	import.meta.dirname,
	'../../lib/dependency-management/wp-files/latest/wordpress/wp-includes/blocks'
);
const blockJson = ( slug: string ) =>
	readFileSync( path.join( blocks, slug, 'block.json' ), 'utf8' );

describe.runIf( EDITOR )(
	"the markup the site's editor saves for a block a result shows the block.json of",
	() => {
		afterAll( cleanupValidatorPages );

		// Results read core's block.json files, so they are built when a test runs.
		it.each< { name: string; results: () => Array< [ string, string ] >; notes: string[][] } >( [
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
				const describe = createBlockExampleNotes();
				for ( const [ i, [ site, text ] ] of results().entries() ) {
					const said = await describe( site, text );
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
