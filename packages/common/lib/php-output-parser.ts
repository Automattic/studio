/**
 * Parse JSON from WP-CLI stdout, handling stray output (PHP notices, plugin echoes) around it.
 *
 * Tries JSON.parse first for the common clean-output case. If that fails, tries each line,
 * last first, so a single-line payload such as `null` survives text printed before or after
 * it. As a last resort, parses from the first '{' or '[' in the output.
 *
 * Defaults to `any` to match JSON.parse behavior; callers can narrow the type
 * via the generic parameter, e.g. `parseJsonFromPhpOutput<string[]>(stdout)`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseJsonFromPhpOutput< T = any >( output: string ): T {
	try {
		return JSON.parse( output );
	} catch {
		// Output likely contains PHP warnings/notices around the JSON.
	}

	const lines = output.split( /\r?\n/ ).filter( ( line ) => line.trim() );
	for ( const line of lines.reverse() ) {
		try {
			return JSON.parse( line );
		} catch {
			// Not the JSON line.
		}
	}

	const objectStart = output.indexOf( '{' );
	const arrayStart = output.indexOf( '[' );

	let startIndex: number;
	if ( objectStart === -1 && arrayStart === -1 ) {
		throw new SyntaxError( `No JSON found in output: ${ output.substring( 0, 100 ) }` );
	} else if ( objectStart === -1 ) {
		startIndex = arrayStart;
	} else if ( arrayStart === -1 ) {
		startIndex = objectStart;
	} else {
		startIndex = Math.min( objectStart, arrayStart );
	}

	return JSON.parse( output.substring( startIndex ) );
}
