/**
 * Extract JSON from stdout that may include non-JSON output.
 * Commonly this is PHP warnings/deprecation notices; parse from the first '{' or '['.
 */
export function parseJsonFromPhpOutput( output: string ): unknown {
	const objectStart = output.indexOf( '{' );
	const arrayStart = output.indexOf( '[' );

	let startIndex: number;
	if ( objectStart === -1 && arrayStart === -1 ) {
		return JSON.parse( output );
	} else if ( objectStart === -1 ) {
		startIndex = arrayStart;
	} else if ( arrayStart === -1 ) {
		startIndex = objectStart;
	} else {
		startIndex = Math.min( objectStart, arrayStart );
	}

	return JSON.parse( output.substring( startIndex ) );
}
