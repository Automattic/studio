const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const CLOSING_FENCE = /^ {0,3}(`{3,}|~{3,})\s*$/;
const LIST_ITEM = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:\s|$)/;
// Reference links and footnotes can point across blocks.
const DEFINITION = /^ {0,3}\[[^\]]+\]:/m;

/**
 * Splits markdown at the blank lines no construct spans, so each top-level
 * block can render on its own and a growing reply re-parses only its last
 * block. Fenced code, HTML comments, list items and indented continuations
 * stay whole, and text with reference definitions stays one block.
 */
export function splitMarkdownBlocks( text: string ): string[] {
	if ( DEFINITION.test( text ) ) {
		return [ text ];
	}
	const lines = text.split( '\n' );
	const blocks: string[] = [];
	let start = 0;
	let fence: string | null = null;
	let inComment = false;
	let inList = false;
	let afterBlank = false;
	lines.forEach( ( line, index ) => {
		if ( fence ) {
			const closing = CLOSING_FENCE.exec( line )?.[ 1 ];
			if ( closing?.[ 0 ] === fence[ 0 ] && closing.length >= fence.length ) {
				fence = null;
			}
			return;
		}
		if ( inComment ) {
			inComment = ! line.includes( '-->' );
			return;
		}
		if ( ! line.trim() ) {
			afterBlank = true;
			return;
		}
		const isListItem = LIST_ITEM.test( line );
		if ( afterBlank && ! /^\s/.test( line ) && ! ( inList && isListItem ) ) {
			blocks.push( lines.slice( start, index ).join( '\n' ) );
			start = index;
			inList = false;
		}
		afterBlank = false;
		inList ||= isListItem;
		fence = FENCE.exec( line )?.[ 1 ] ?? null;
		inComment = line.lastIndexOf( '<!--' ) > line.lastIndexOf( '-->' );
	} );
	blocks.push( lines.slice( start ).join( '\n' ) );
	return blocks;
}

/**
 * Closes the bold and inline code a streaming block has opened but not yet
 * closed, so it doesn't flash as raw markers until the closing ones arrive.
 */
export function closeOpenMarkdown( block: string ): string {
	if ( block.split( '\n' ).filter( ( line ) => FENCE.test( line ) ).length % 2 ) {
		return block;
	}
	let text = block;
	for ( const marker of [ '`', '**' ] ) {
		const outsideCode = marker === '`' ? text : text.replace( /`[^`]*`/g, '' );
		if ( outsideCode.split( marker ).length % 2 === 0 ) {
			text = text.trimEnd().endsWith( marker )
				? text.trimEnd().slice( 0, -marker.length ).trimEnd()
				: text + marker;
		}
	}
	return text;
}
