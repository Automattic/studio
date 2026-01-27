/**
 * Sanitizes wp-config.php content by wrapping define() calls with defined() checks.
 *
 * This prevents PHP warnings when the exported site is pushed to WordPress.com,
 * where many constants are already defined by the hosting infrastructure.
 *
 * Transforms:
 *   define( 'CONSTANT', 'value' );
 * Into:
 *   if ( ! defined( 'CONSTANT' ) ) { define( 'CONSTANT', 'value' ); }
 *
 * @param content - The wp-config.php file content
 * @returns Sanitized content with safe constant definitions
 */
export function sanitizeWpConfig( content: string ): string {
	// Regular expression to match define() calls
	// Matches: define( 'NAME', value ); or define('NAME', value);
	// Captures:
	// - The whitespace/indentation before define
	// - The constant name (single or double quoted)
	// - The entire define statement for replacement
	// Uses .+? (non-greedy) to match the value, stopping at the last );
	const defineRegex = /^(\s*)(define\s*\(\s*(['"])([A-Z_][A-Z0-9_]*)\3\s*,.+\)\s*;)/gim;

	// Track which constants we've already wrapped to avoid double-wrapping
	const wrappedConstants = new Set< string >();

	return content.replace( defineRegex, ( match, indent, defineStatement, _quote, constantName ) => {
		// Check if this define is already wrapped with a defined() check
		// Look for patterns like: if ( ! defined( 'CONSTANT' ) )
		const alreadyWrappedPattern = new RegExp(
			`if\\s*\\(\\s*!\\s*defined\\s*\\(\\s*['"]${ constantName }['"]\\s*\\)\\s*\\)`,
			'i'
		);

		// Get some context before the match to check if it's already wrapped
		const matchIndex = content.indexOf( match );
		const contextBefore = content.substring( Math.max( 0, matchIndex - 100 ), matchIndex );

		if ( alreadyWrappedPattern.test( contextBefore ) ) {
			// Already wrapped, return as-is
			return match;
		}

		// Skip if we've already wrapped this constant (handles duplicates)
		if ( wrappedConstants.has( constantName ) ) {
			return match;
		}

		wrappedConstants.add( constantName );

		// Wrap with defined() check
		return `${ indent }if ( ! defined( '${ constantName }' ) ) { ${ defineStatement } }`;
	} );
}
