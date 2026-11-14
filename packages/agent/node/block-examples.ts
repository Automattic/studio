/**
 * What the site's block editor saves for a block whose block.json a call looks
 * up or its result shows, as a shell command printing it or a file read does:
 * the markup to write the block from, made by the editor itself rather than
 * read from its built save function. A block a plugin registers from its
 * script has no block.json to show, so looking one up names it too.
 */
import { savedExamples } from '@studio/agent/node/block-validator';
import type { StudioAgentHost } from '@studio/agent/shared/host';

// A block type's metadata, as block.json declares it: its API version and its
// namespaced name (register_block_type_from_metadata() in wp-includes/blocks.php).
const BLOCK_NAME = /"name"\s*:\s*"([a-z][a-z0-9-]*\/[a-z][a-z0-9-]*)"/g;

// A block.json path a call looks up under a plugin's folder or core's, whose
// folder is the block's name in the plugin's namespace, as
// plugins/jetpack/…/blocks/field-email/block.json is jetpack/field-email's.
const LOOKED_UP =
	/(?:plugins\/([a-z0-9-]+)|wp-includes)\/(?:[^\s'"*]*\/)?([a-z][a-z0-9-]*)\/block\.json/g;

const FROM = {
	example:
		'the example its block type registers, as its inserter preview makes it (getBlockFromExample in @wordpress/blocks)',
	variation: 'its default inserter variation (createBlock in @wordpress/blocks)',
	defaults: 'its default attributes (createBlock in @wordpress/blocks)',
};

/** Each block a call looks up or its result shows the block.json of, once per site. */
export function createBlockExampleNotes(
	host: StudioAgentHost
): ( sitePath: string, text: string, request?: string ) => Promise< string[] > {
	const described = new Map< string, Set< string > >();
	return async ( sitePath, text, request = '' ) => {
		const shown = text.includes( '"apiVersion"' )
			? [ ...text.matchAll( BLOCK_NAME ) ].map( ( match ) => match[ 1 ] )
			: [];
		const lookedUp = [ ...request.matchAll( LOOKED_UP ) ].map(
			( [ , plugin, folder ] ) => `${ plugin ?? 'core' }/${ folder }`
		);
		const done = described.get( sitePath ) ?? new Set< string >();
		described.set( sitePath, done );
		const wanted = [ ...new Set( [ ...shown, ...lookedUp ] ) ].filter(
			( name ) => ! done.has( name )
		);
		if ( ! wanted.length ) {
			return [];
		}
		const examples = await savedExamples( wanted, ( await host.sites.resolve( sitePath ) ).url );
		// Asked once: a name the editor does not register is not asked again.
		wanted.forEach( ( name ) => done.add( name ) );
		return examples.map( ( { name, from, markup } ) => {
			return `What the site's block editor saves for ${ name }, from ${ FROM[ from ] }, to write it from:\n${ markup }`;
		} );
	};
}
