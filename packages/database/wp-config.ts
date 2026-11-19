/**
 * Default values for database constants in wp-config-sample.php.
 * Only these exact default values will be matched and removed.
 */
const DB_DEFAULTS: Array< [ string, string ] > = [
	[ 'DB_NAME', 'database_name_here' ],
	[ 'DB_USER', 'username_here' ],
	[ 'DB_PASSWORD', 'password_here' ],
	[ 'DB_HOST', 'localhost' ],
	[ 'DB_CHARSET', 'utf8mb4' ],
	[ 'DB_COLLATE', '' ],
];

/**
 * Builds a regex that matches the default DB settings block in wp-config.php.
 *
 * The regex is flexible with comments (they may be in any language) but strict
 * with PHP code (only matches exact default values from wp-config-sample.php).
 *
 * Structure matched per constant:
 *   [optional comment lines]  <- flexible (any language)
 *   define( 'DB_X', 'default_value' );  <- strict (exact match)
 *   [optional blank lines]
 */
function buildDefaultDbBlockRegex(): RegExp {
	// Matches a single-line comment: // ... or a docblock comment: /** ... */
	const commentLine =
		'[ \\t]*(?:\\/\\/[^\\r\\n]*|\\/\\*\\*[^*]*(?:\\*(?!\\/)[^*]*)*\\*\\/)[ \\t]*\\r?\\n';
	// Zero or more comment lines before a define
	const optionalComments = `(?:${ commentLine })*`;
	// Optional blank lines between entries
	const blankLines = '(?:[ \\t]*\\r?\\n)*';

	const definePatterns = DB_DEFAULTS.map( ( [ name, value ] ) => {
		const escapedValue = value.replace( /[.*+?^${}()|[\]\\]/g, '\\$&' );
		return `${ optionalComments }[ \\t]*define\\([ \\t]*'${ name }'[ \\t]*,[ \\t]*'${ escapedValue }'[ \\t]*\\)[ \\t]*;[ \\t]*\\r?\\n`;
	} );

	return new RegExp( definePatterns.join( blankLines ) );
}

const DB_SETTINGS_BLOCK_REGEX = buildDefaultDbBlockRegex();

const REPLACEMENT_COMMENT = normalizeLineEndings( `/**
 * Database connection information is automatically provided.
 * There is no need to set or change the following database configuration
 * values:
 *   DB_HOST
 *   DB_NAME
 *   DB_USER
 *   DB_PASSWORD
 *   DB_CHARSET
 *   DB_COLLATE
 */` );

function normalizeLineEndings( content: string ): string {
	return content.replace( /\n/g, '\r\n' );
}

/** Whether a wp-config.php still has the database settings of wp-config-sample.php. */
export function hasDefaultDbConstants( wpConfig: string ): boolean {
	return DB_SETTINGS_BLOCK_REGEX.test( wpConfig );
}

/** Replaces the sample database settings with a note that the database is provided. */
export function removeDefaultDbConstants( wpConfig: string ): string {
	return wpConfig.replace( DB_SETTINGS_BLOCK_REGEX, REPLACEMENT_COMMENT + '\n' );
}
