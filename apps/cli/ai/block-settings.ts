import { readFileSync } from 'fs';
import path from 'path';

// Matches the opening comment of a block in serialized markup, e.g.
// `<!-- wp:navigation /-->` or `<!-- wp:core/group {...} -->`. Closing
// comments (`<!-- /wp:group -->`) do not match.
const BLOCK_COMMENT = /<!--\s+wp:([a-z][a-z0-9_-]*(?:\/[a-z][a-z0-9_-]*)?)[\s/]/g;

type BlockAttribute = {
	type?: string | string[];
	enum?: unknown[];
	default?: unknown;
	source?: string;
};

function coreSlug( blockName: string ): string | undefined {
	if ( ! blockName.includes( '/' ) ) {
		return blockName;
	}
	return blockName.startsWith( 'core/' ) ? blockName.slice( 'core/'.length ) : undefined;
}

function describeAttribute( name: string, attribute: BlockAttribute ): string {
	const shape = attribute.enum
		? attribute.enum.map( ( value ) => JSON.stringify( value ) ).join( '|' )
		: [ attribute.type ?? 'any' ].flat().join( '|' );
	const fallback =
		attribute.default === undefined ? '' : `, default ${ JSON.stringify( attribute.default ) }`;
	return `${ name } (${ shape }${ fallback })`;
}

// The settings a core block type declares in its block.json: the attributes
// stored in the block comment. Attributes read from the block's HTML
// (`source`) are its content, and `__unstable`/`__experimental` ones are
// internal, so both are left out.
export function describeCoreBlockSettings( blocksDir: string, slug: string ): string | undefined {
	const file = path.join( blocksDir, slug, 'block.json' );
	let attributes: Record< string, BlockAttribute >;
	try {
		attributes = JSON.parse( readFileSync( file, 'utf8' ) ).attributes ?? {};
	} catch {
		return undefined;
	}
	const settings = Object.entries( attributes )
		.filter( ( [ name, attribute ] ) => ! attribute.source && ! name.startsWith( '__' ) )
		.map( ( [ name, attribute ] ) => describeAttribute( name, attribute ) );
	const where = file.split( path.sep ).join( '/' );
	return settings.length
		? `core/${ slug } settings, declared in ${ where }: ${ settings.join( ', ' ) }.`
		: undefined;
}

// Returns a function that, given a tool result's text, describes the settings
// of each core block type that appears in it. Each block type is described
// once per tracker.
export function createBlockSettingsNotes( blocksDir: string ): ( text: string ) => string {
	const described = new Set< string >();
	return ( text ) => {
		const notes: string[] = [];
		for ( const match of text.matchAll( BLOCK_COMMENT ) ) {
			const slug = coreSlug( match[ 1 ] );
			if ( ! slug || described.has( slug ) ) {
				continue;
			}
			described.add( slug );
			const note = describeCoreBlockSettings( blocksDir, slug );
			if ( note ) {
				notes.push( note );
			}
		}
		return notes.join( '\n' );
	};
}
