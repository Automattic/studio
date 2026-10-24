/**
 * What Studio adds to the conversation: its notes on a tool's result, and its
 * checks of the sites at the end of a turn. They reach the model in the
 * tool's or the user's role, so they are tagged as Studio's, the way Pi tags
 * the summaries it adds. The same text reaches every surface.
 */
export function studioMessage(
	kind: 'notes' | 'checks',
	lines: Array< string | undefined >
): string | undefined {
	const body = lines.filter( Boolean ).join( '\n' );
	return body ? `<studio-${ kind }>\n${ body }\n</studio-${ kind }>` : undefined;
}

/** A block validation report: a summary line per checked file or post, then its problems. */
export function validationLines( {
	summaries,
	problems,
}: {
	summaries: string[];
	problems: string[];
} ): string[] {
	return [ ...summaries.map( ( line ) => `Block validation: ${ line }` ), ...problems ];
}
