const LITERAL_VALUE = `(?:true|false|TRUE|FALSE|'[^'\\\\]*'|"[^"\\\\]*")`;

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

const STUDIO_DEFINE_LINE_REGEXES = STUDIO_MANAGED_CONSTANTS.map(
	( [ name, valuePattern ] ) =>
		new RegExp(
			`^[ \\t]*define[ \\t]*\\([ \\t]*(['"])${ name }\\1[ \\t]*,[ \\t]*${ valuePattern }[ \\t]*\\)[ \\t]*;[ \\t]*$`
		)
);

function isStudioDefineLine( line: string ): boolean {
	return STUDIO_DEFINE_LINE_REGEXES.some( ( regex ) => regex.test( line ) );
}

// Whether a define after this line is a statement of its own, rather than the
// body of a brace-less `if`, `else` or loop. Takes the line's code, without comments.
function endsStatement( code: string ): boolean {
	return /(?:[;{}]|<\?php)$/.test( code );
}

// Returns the code of a line with its comments removed. `state` carries an
// unterminated `/* */` comment over to the next line.
function stripComments( line: string, state: { inBlockComment: boolean } ): string {
	let code = '';
	let quote: string | null = null;
	for ( let i = 0; i < line.length; i++ ) {
		const char = line[ i ];
		const next = line[ i + 1 ];
		if ( state.inBlockComment ) {
			if ( char === '*' && next === '/' ) {
				state.inBlockComment = false;
				i++;
			}
		} else if ( quote ) {
			code += char;
			if ( char === '\\' ) {
				code += next ?? '';
				i++;
			} else if ( char === quote ) {
				quote = null;
			}
		} else if ( char === "'" || char === '"' ) {
			quote = char;
			code += char;
		} else if ( char === '/' && next === '*' ) {
			state.inBlockComment = true;
			i++;
		} else if ( ( char === '/' && next === '/' ) || char === '#' ) {
			break;
		} else {
			code += char;
		}
	}
	return code.trim();
}

/**
 * Removes the Studio-managed constants from wp-config.php content. Only a
 * `define()` with a literal value that is a statement of its own is removed, so
 * a define computed from an expression or that is the body of a condition is
 * left as is.
 */
export function stripStudioWpConfigConstants( content: string ): string {
	const lines = content.split( /(?<=\n)/ );
	const commentState = { inBlockComment: false };
	let previousCode: string | undefined;

	return lines
		.filter( ( line ) => {
			const text = line.replace( /\r?\n$/, '' );
			const startsInComment = commentState.inBlockComment;
			const code = stripComments( text, commentState );
			const isPrecededByStatementEnd = previousCode === undefined || endsStatement( previousCode );
			// A `/*` opened after the define starts a comment the next lines rely on.
			const isOwnLine = ! startsInComment && ! commentState.inBlockComment;
			if ( isOwnLine && isPrecededByStatementEnd && isStudioDefineLine( code ) ) {
				return false;
			}
			if ( code !== '' ) {
				previousCode = code;
			}
			return true;
		} )
		.join( '' );
}
