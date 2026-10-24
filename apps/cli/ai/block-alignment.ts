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
	layout?: { type?: unknown; inherit?: unknown; contentSize?: unknown };
}

interface OpenBlock {
	label: string;
	constrains: boolean;
	reachesEdges: boolean;
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

/**
 * What keeps each full-width block in this markup, and the page content, from
 * the page edges, taking its top-level blocks to span the page: those of a
 * template do, and those of content do unless the template holds them.
 */
export function trappedFullWidthNotes( markup: string ): string[] {
	const open: OpenBlock[] = [];
	const notes = new Set< string >();
	for ( const [ , closing, name, json, selfClosing ] of markup.matchAll( BLOCK_DELIMITER ) ) {
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
		const reachesEdges = ! parent || ( parent.reachesEdges && ( full || ! parent.constrains ) );
		const block = {
			label: labelOf( name, attributes ),
			constrains: constrains( attributes ),
			reachesEdges,
		};
		const isPostContent = block.label.startsWith( POST_CONTENT );
		if ( ( full || isPostContent ) && ! reachesEdges ) {
			// The outermost block that stops short: the one align full would free.
			const stop = [ ...open, block ].find( ( { reachesEdges: reaches } ) => ! reaches ) ?? block;
			const subject = isPostContent
				? `${ POST_CONTENT }, and so no align full block in a page's content,`
				: `${ block.label }, align full,`;
			notes.add(
				`${ subject } cannot reach the page edges: ${ stop.label } is not align full, and the constrained layout around it holds it to the content width (wp-includes/block-supports/layout.php). Give ${ stop.label } align full.`
			);
		}
		if ( ! selfClosing ) {
			open.push( block );
		}
	}
	return [ ...notes ];
}
