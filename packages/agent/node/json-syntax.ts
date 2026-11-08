/**
 * Where a JSON text stops parsing. PHP's json_decode, which WordPress reads
 * JSON files with, says only "Syntax error"; JSON.parse gives the offset of
 * the first character it cannot read. In the redo eval case a theme.json's
 * "css" lost its closing quote, and finding the character took eight calls.
 */
interface JsonSyntaxError {
	line: number;
	column: number;
	reason: string;
	excerpt: string;
}

const BEFORE = 40;
const AFTER = 20;

export function jsonSyntaxError( text: string ): JsonSyntaxError | undefined {
	try {
		JSON.parse( text );
		return undefined;
	} catch ( error ) {
		const message = error instanceof Error ? error.message : String( error );
		const at = /^(.*?) in JSON at position (\d+)/.exec( message );
		if ( ! at ) {
			return undefined;
		}
		const position = Number( at[ 2 ] );
		const lines = text.slice( 0, position ).split( '\n' );
		return {
			line: lines.length,
			column: lines[ lines.length - 1 ].length + 1,
			reason: at[ 1 ],
			excerpt: visible(
				( position > BEFORE ? '…' : '' ) +
					text.slice( Math.max( 0, position - BEFORE ), position + AFTER ) +
					( position + AFTER < text.length ? '…' : '' )
			),
		};
	}
}

// Control characters as their JSON escapes, so a newline in a string shows.
function visible( text: string ): string {
	return Array.from( text, ( char ) =>
		char.charCodeAt( 0 ) >= 0x20 ? char : JSON.stringify( char ).slice( 1, -1 )
	).join( '' );
}
