const LITERAL_VALUE = `(?:true|false|TRUE|FALSE|'[^'\\\\\\r\\n]*'|"[^"\\\\\\r\\n]*")`;

// The constants `ensureWpConfig()` writes on every site start. Their values
// describe the local site, so they must not reach a remote host's wp-config.php.
// DB_NAME is only Studio's when it still holds Studio's default.
const STUDIO_MANAGED_CONSTANTS: Array< [ name: string, valuePattern: string ] > = [
	[ 'WP_ENVIRONMENT_TYPE', LITERAL_VALUE ],
	[ 'WP_DEBUG', LITERAL_VALUE ],
	[ 'WP_DEBUG_LOG', LITERAL_VALUE ],
	[ 'WP_DEBUG_DISPLAY', LITERAL_VALUE ],
	[ 'SCRIPT_DEBUG', LITERAL_VALUE ],
	[ 'DB_NAME', `(['"])wordpress\\2` ],
];

function buildDefineLineRegex( name: string, valuePattern: string ): RegExp {
	return new RegExp(
		`^[ \\t]*define[ \\t]*\\([ \\t]*(['"])${ name }\\1[ \\t]*,[ \\t]*${ valuePattern }[ \\t]*\\)[ \\t]*;[ \\t]*(?:\\r?\\n|$)`,
		'gm'
	);
}

/**
 * Removes the Studio-managed constants from wp-config.php content. Only
 * stand-alone `define()` lines with a literal value are removed, so a define
 * computed from an expression or wrapped in a condition is left as is.
 */
export function stripStudioWpConfigConstants( content: string ): string {
	return STUDIO_MANAGED_CONSTANTS.reduce(
		( result, [ name, valuePattern ] ) =>
			result.replace( buildDefineLineRegex( name, valuePattern ), '' ),
		content
	);
}
