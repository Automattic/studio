/**
 * What the site's block editor saves for a block whose block.json a result
 * shows, as a shell command printing it or a file read does: the markup to
 * write the block from, made by the editor itself rather than read from its
 * built save function.
 */
import { savedExamples } from '@studio/agent/node/block-validator';
import type { StudioAgentHost } from '@studio/agent/node/host';

// A block type's metadata, as block.json declares it: its API version and its
// namespaced name (register_block_type_from_metadata() in wp-includes/blocks.php).
const BLOCK_NAME = /"name"\s*:\s*"([a-z][a-z0-9-]*\/[a-z][a-z0-9-]*)"/g;

const FROM = {
	example:
		'the example its block type registers, as its inserter preview makes it (getBlockFromExample in @wordpress/blocks)',
	variation: 'its default inserter variation (createBlock in @wordpress/blocks)',
	defaults: 'its default attributes (createBlock in @wordpress/blocks)',
};

/** Each block a result shows the block.json of, once per site. */
export function createBlockExampleNotes(
	host: StudioAgentHost
): ( sitePath: string, text: string ) => Promise< string[] > {
	const described = new Map< string, Set< string > >();
	return async ( sitePath, text ) => {
		if ( ! text.includes( '"apiVersion"' ) ) {
			return [];
		}
		const done = described.get( sitePath ) ?? new Set< string >();
		described.set( sitePath, done );
		const names = [
			...new Set( [ ...text.matchAll( BLOCK_NAME ) ].map( ( match ) => match[ 1 ] ) ),
		];
		const wanted = names.filter( ( name ) => ! done.has( name ) );
		if ( ! wanted.length ) {
			return [];
		}
		const examples = await savedExamples( wanted, ( await host.sites.resolve( sitePath ) ).url );
		return examples.map( ( { name, from, markup } ) => {
			done.add( name );
			return `What the site's block editor saves for ${ name }, from ${ FROM[ from ] }, to write it from:\n${ markup }`;
		} );
	};
}
