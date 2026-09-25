const MAX_SUMMARY_LENGTH = 500;
const ERROR_LINE = /^(PHP )?(Error|Fatal error|Parse error):/;

/**
 * Picks the line worth showing from WP-CLI stderr. PHP deprecation notices are printed on every
 * run, so the real `Error: …` usually comes last; callers should log the full stderr separately.
 */
export function summarizeWpCliStderr( stderr: string ): string {
	const lines = stderr
		.split( '\n' )
		.map( ( line ) => line.trim() )
		.filter( Boolean );
	const summary =
		[ ...lines ].reverse().find( ( line ) => ERROR_LINE.test( line ) ) ?? lines.at( -1 ) ?? '';
	return summary.length > MAX_SUMMARY_LENGTH
		? `${ summary.slice( 0, MAX_SUMMARY_LENGTH ) }…`
		: summary;
}
