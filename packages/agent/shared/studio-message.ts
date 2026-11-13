/**
 * What Studio adds to the conversation: its notes on a tool's result, its
 * checks of the sites at the end of a turn, and the context a turn starts from. They reach the model in the
 * tool's or the user's role, so they are tagged as Studio's, the way Pi tags
 * the summaries it adds. The same text reaches every surface.
 */
export function studioMessage(
	kind: 'notes' | 'checks' | 'context',
	lines: Array< string | undefined >
): string | undefined {
	const body = lines.filter( Boolean ).join( '\n' );
	return body ? `<studio-${ kind }>\n${ body }\n</studio-${ kind }>` : undefined;
}

/** A block validation summary of a checked file or post, as Studio states it. */
export const validationSummary = ( line: string ) => `Block validation: ${ line }`;

// A summary that says only that every block of its file is valid.
const ALL_VALID = /^([^\n]+): (\d+)\/\2 blocks valid$/;

/**
 * A block validation report: a summary line per checked file or post, then
 * its problems. The files whose every block is valid share one line, as a
 * call that writes a theme checks each of its templates and parts.
 */
export function validationLines( {
	summaries,
	problems,
}: {
	summaries: string[];
	problems: string[];
} ): string[] {
	const valid = summaries.flatMap( ( summary ) => {
		const [ , file, blocks ] = ALL_VALID.exec( summary ) ?? [];
		return file ? [ `${ file } ${ blocks }/${ blocks }` ] : [];
	} );
	return [
		...( valid.length > 1
			? [
					validationSummary( `every block valid in ${ valid.join( ', ' ) }` ),
					...summaries
						.filter( ( summary ) => ! ALL_VALID.test( summary ) )
						.map( validationSummary ),
			  ]
			: summaries.map( validationSummary ) ),
		...problems,
	];
}
