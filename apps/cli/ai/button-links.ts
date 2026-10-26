/**
 * Buttons in block markup that open nothing. A core/button saves its "url"
 * as the href of its link (its "url" attribute is sourced from a[href], in
 * wp-includes/blocks/button/block.json), so a button written without one is
 * a link with no href, which the browser gives no action, and one whose href
 * is "#" opens the top of the page it is on. A button whose "tagName" is
 * "button" has no link by design, as a form's submit button does, and is
 * not named.
 */

const BUTTON = /<!--\s+wp:button(?:\s+\{[\s\S]*?\})?\s+-->([\s\S]*?)<!--\s+\/wp:button\s+-->/g;

/** The note on the buttons in `markup` that link nowhere, if any. */
export function buttonsWithoutLinkNotes( markup: string ): string[] {
	const texts = new Map< string, number >();
	for ( const [ , inner ] of markup.matchAll( BUTTON ) ) {
		const link = inner.match( /<a\b[^>]*>/ );
		if ( ! link ) {
			continue;
		}
		const href = link[ 0 ].match( /\shref="([^"]*)"/ )?.[ 1 ];
		if ( href && href !== '#' ) {
			continue;
		}
		// The text between its tags.
		const text =
			inner
				.split( /<[^>]*>/ )
				.join( '' )
				.trim() || '(no text)';
		texts.set( text, ( texts.get( text ) ?? 0 ) + 1 );
	}
	if ( ! texts.size ) {
		return [];
	}
	const named = [ ...texts ]
		.map( ( [ text, count ] ) => ( count > 1 ? `"${ text }" ×${ count }` : `"${ text }"` ) )
		.join( ', ' );
	return [
		`core/button blocks that open nothing: ${ named }. A button's link is its "url", saved as the href of its <a> (wp-includes/blocks/button/block.json); without one the browser gives the link no action, and "#" opens the top of the page. Give each the URL of what it offers.`,
	];
}
