/**
 * Full-width blocks that cannot reach the page edges. A block spans the page
 * with `align: full` only inside containers that span it: a constrained layout
 * (wp-includes/block-supports/layout.php) holds each other child to the
 * content width, and the full-width blocks inside that child with it.
 */

// A block's opening, closing, or self-closing comment in serialized markup.
const BLOCK_DELIMITER =
	/<!--\s+(\/)?wp:([a-z][a-z0-9_-]*(?:\/[a-z][a-z0-9_-]*)?)\s+(?:(\{[\s\S]*?\})\s+)?(\/)?-->/g;

interface BlockAttributes {
	align?: unknown;
	className?: unknown;
	layout?: { type?: unknown; inherit?: unknown; contentSize?: unknown; wideSize?: unknown };
}

interface OpenBlock {
	label: string;
	name: string;
	attributes: BlockAttributes;
	constrains: boolean;
	reachesEdges: boolean;
	/** Where its opening comment starts and ends in the markup. */
	at: number;
	end: number;
	selfClosing: boolean;
}

interface Trap {
	subject: string;
	stop: OpenBlock;
	/** The block that holds the stop to the content width. */
	holder: OpenBlock;
}

// Which layout WordPress applies: a `layout` without a type that inherits or
// sets a content size is the constrained layout.
function constrains( { layout }: BlockAttributes ): boolean {
	return (
		layout?.type === 'constrained' ||
		( layout?.type === undefined &&
			( layout?.inherit === true || layout?.contentSize !== undefined ) )
	);
}

function labelOf( name: string, attributes: BlockAttributes ): string {
	const block = name.includes( '/' ) ? name : `core/${ name }`;
	return typeof attributes.className === 'string'
		? `${ block } (${ attributes.className
				.split( /\s+/ )
				.map( ( c ) => `.${ c }` )
				.join( '' ) })`
		: block;
}

// The page content: its align full blocks span the page only when it does.
const POST_CONTENT = 'core/post-content';

// What keeps each full-width block in the markup, and the page content, from
// the page edges, taking its top-level blocks to span the page: those of a
// template do, and those of content do unless the template holds them.
function traps( markup: string ): Trap[] {
	const open: OpenBlock[] = [];
	const found: Trap[] = [];
	for ( const match of markup.matchAll( BLOCK_DELIMITER ) ) {
		const [ delimiter, closing, name, json, selfClosing ] = match;
		if ( closing ) {
			open.pop();
			continue;
		}
		let attributes: BlockAttributes = {};
		try {
			attributes = json ? JSON.parse( json ) : {};
		} catch {
			// Invalid attributes are the block check's to report.
		}
		const parent = open.at( -1 );
		const full = attributes.align === 'full';
		const block: OpenBlock = {
			label: labelOf( name, attributes ),
			name: name.includes( '/' ) ? name : `core/${ name }`,
			attributes,
			constrains: constrains( attributes ),
			reachesEdges: ! parent || ( parent.reachesEdges && ( full || ! parent.constrains ) ),
			at: match.index,
			end: match.index + delimiter.length,
			selfClosing: Boolean( selfClosing ),
		};
		const isPostContent = block.name === POST_CONTENT;
		if ( ( full || isPostContent ) && ! block.reachesEdges ) {
			// The outermost block that stops short: the one align full would free.
			const chain = [ ...open, block ];
			const index = chain.findIndex( ( { reachesEdges } ) => ! reachesEdges );
			found.push( {
				subject: isPostContent
					? `${ POST_CONTENT }, and so no align full block in a page's content,`
					: `${ block.label }, align full,`,
				stop: chain[ index ],
				holder: chain[ index - 1 ],
			} );
		}
		if ( ! selfClosing ) {
			open.push( block );
		}
	}
	return found;
}

/** What keeps each full-width block in this markup, and the page content, from the page edges. */
export function trappedFullWidthNotes( markup: string ): string[] {
	return [
		...new Set(
			traps( markup ).map(
				( { subject, stop } ) =>
					`${ subject } cannot reach the page edges: ${ stop.label } is not align full, and the constrained layout around it holds it to the content width (wp-includes/block-supports/layout.php). Give ${ stop.label } align full.`
			)
		),
	];
}

// The attributes that give a block no look of its own: what it is and how it
// lays out its blocks.
const STRUCTURAL = new Set( [ 'layout', 'tagName', 'lock', 'metadata', 'anchor' ] );

const ownSizes = ( { layout }: BlockAttributes ) =>
	layout?.contentSize !== undefined || layout?.wideSize !== undefined;

/**
 * The markup with each block that keeps full-width blocks from the page edges
 * made align full, where that changes nothing else: a block with no look of
 * its own whose constrained layout holds its other blocks to the content width
 * the block around it held them to. `supportsFull` says whether a block type
 * supports align full (block.json supports.align).
 */
export function freeTrappedBlocks(
	markup: string,
	supportsFull: ( name: string ) => boolean
): { markup: string; freed: string[] } {
	const stops = new Map< number, OpenBlock >();
	for ( const { stop, holder } of traps( markup ) ) {
		if (
			stop.constrains &&
			! ownSizes( stop.attributes ) &&
			! ownSizes( holder.attributes ) &&
			Object.keys( stop.attributes ).every( ( key ) => STRUCTURAL.has( key ) ) &&
			supportsFull( stop.name )
		) {
			stops.set( stop.at, stop );
		}
	}
	let freed = markup;
	const labels: string[] = [];
	// From the last, so each place stays where the scan found it.
	for ( const stop of [ ...stops.values() ].sort( ( a, b ) => b.at - a.at ) ) {
		// A saved block carries the alignfull class on its wrapper, as the
		// align support adds it (wp-includes/block-supports/align.php).
		const wrapper = stop.selfClosing
			? undefined
			: /^\s*<[a-z][a-z0-9]*\b[^>]*?\bclass="([^"]*)"/i.exec( freed.slice( stop.end ) );
		if ( ! stop.selfClosing && ! wrapper ) {
			continue;
		}
		const comment = freed
			.slice( stop.at, stop.end )
			.replace(
				/^(<!--\s+wp:\S+)(?:\s+\{[\s\S]*\})?(\s+\/?-->)$/,
				`$1 ${ JSON.stringify( { ...stop.attributes, align: 'full' } ) }$2`
			);
		const after = wrapper
			? freed
					.slice( stop.end )
					.replace( wrapper[ 0 ], `${ wrapper[ 0 ].slice( 0, -1 ) } alignfull"` )
			: freed.slice( stop.end );
		freed = freed.slice( 0, stop.at ) + comment + after;
		labels.push( stop.label );
	}
	return { markup: freed, freed: labels.reverse() };
}
