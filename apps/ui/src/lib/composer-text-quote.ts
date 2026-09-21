type ComposerTextQuoteListener = ( text: string ) => void;

const listeners = new Set< ComposerTextQuoteListener >();

export function emitComposerTextQuote( text: string ): void {
	for ( const listener of listeners ) {
		listener( text );
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
