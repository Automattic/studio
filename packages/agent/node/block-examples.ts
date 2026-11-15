/**
 * What the site's block editor saves for a block whose block.json a call looks
 * up or its result shows, as a shell command printing it or a file read does:
 * the markup to write the block from, made by the editor itself rather than
 * read from its built save function. A block a plugin registers from its
 * script has no block.json to show, so looking one up names it too, as does
 * naming the block in a call that reads its plugin's code or the registry.
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

// A plugin's folder a call reads the code of, whose blocks are in its namespace.
const PLUGIN_CODE = /plugins\/([a-z0-9-]+)/g;
// A block name standing alone, not a segment of a path or a file name.
const NAMED = /(?<![\w/.-])([a-z][a-z0-9-]*)\/([a-z][a-z0-9-]*)(?![\w/.-])/g;
// The block registry, read by PHP or the REST API (/wp/v2/block-types/<name>).
const REGISTRY = /WP_Block_Type_Registry|block-types\/?/;
const IN_REGISTRY = /block-types\/([a-z][a-z0-9-]*\/[a-z][a-z0-9-]*)/g;

/**
 * The blocks a call reading a plugin's code or the block registry names:
 * one in a plugin's namespace, as `jetpack/field-select` searched for in
 * Jetpack's built script, which has no block.json to look up.
 */
function namedBlocks( request: string ): string[] {
	const plugins = new Set( [ ...request.matchAll( PLUGIN_CODE ) ].map( ( match ) => match[ 1 ] ) );
	const registry = REGISTRY.test( request );
	return [
		...[ ...request.matchAll( NAMED ) ]
			.filter( ( [ , namespace ] ) => registry || plugins.has( namespace ) )
			.map( ( [ name ] ) => name ),
		...[ ...request.matchAll( IN_REGISTRY ) ].map( ( match ) => match[ 1 ] ),
	];
}

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
		const wanted = [ ...new Set( [ ...shown, ...lookedUp, ...namedBlocks( request ) ] ) ].filter(
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
