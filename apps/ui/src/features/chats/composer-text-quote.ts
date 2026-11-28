type ComposerTextQuoteListener = (
	text: string,
	reply?: import('@studio/agent/protocol/reply-reference').ReplyReference
) => void;

const listeners = new Set< ComposerTextQuoteListener >();

export function emitComposerTextQuote(
	text: string,
	reply?: import('@studio/agent/protocol/reply-reference').ReplyReference
): void {
	for ( const listener of listeners ) {
		if ( reply ) listener( text, reply );
		else listener( text );
	}
}

export function watchComposerTextQuote( listener: ComposerTextQuoteListener ): () => void {
	listeners.add( listener );
	return () => listeners.delete( listener );
}

export function formatComposerTextQuote( text: string ): string {
	const quote = text
		.trim()
		.split( /\r?\n/ )
		.map( ( line ) => `> ${ line }` )
		.join( '\n' );
	return `${ quote }\n\n`;
}
