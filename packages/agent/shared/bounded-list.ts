/**
 * A list Studio states to the model, bounded so it reads at the same length
 * however many items the site has: its first `max` items, then how many more
 * there are. Every list Studio cuts short is cut here, so each one ends the
 * same way and says how much it left out.
 */
export function bounded< T >( items: T[], max: number ): { shown: T[]; more: number } {
	return { shown: items.slice( 0, max ), more: Math.max( 0, items.length - max ) };
}

/** The items in a sentence: "a, b, c, and 4 more". */
export function boundedText( items: string[], max: number, separator = ', ' ): string {
	const { shown, more } = bounded( items, max );
	return `${ shown.join( separator ) }${ more ? `, and ${ more } more` : '' }`;
}

/** The items in a sentence, the last after "and": "a, b and c". */
export function joinWithAnd( items: string[] ): string {
	return items.length < 2
		? items.join( '' )
		: `${ items.slice( 0, -1 ).join( ', ' ) } and ${ items.at( -1 ) }`;
}

/** The items one per line, then "…and 4 more" on a line of its own. */
export function boundedLines( lines: string[], max: number, indent = '' ): string[] {
	const { shown, more } = bounded( lines, max );
	return more ? [ ...shown, `${ indent }…and ${ more } more` ] : shown;
}
