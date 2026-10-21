import { WP_ENVIRONMENT_TYPES } from '@studio/common/lib/wp-environment-type';

const BOOLEAN_VALUES = [ 'true', 'false' ];

// The constants `ensureWpConfig()` writes on every site start, with the values
// it writes. They describe the local site, so they must not reach a remote
// host's wp-config.php. DB_NAME is only Studio's when it still holds Studio's default.
const STUDIO_MANAGED_CONSTANTS: Record< string, string[] > = {
	WP_ENVIRONMENT_TYPE: WP_ENVIRONMENT_TYPES.map( ( type ) => `'${ type }'` ),
	WP_DEBUG: BOOLEAN_VALUES,
	WP_DEBUG_LOG: BOOLEAN_VALUES,
	WP_DEBUG_DISPLAY: BOOLEAN_VALUES,
	SCRIPT_DEBUG: BOOLEAN_VALUES,
	DB_NAME: [ "'wordpress'" ],
};

// Matches the exact line WP_Config_Transformer writes: define( 'NAME', value );
const STUDIO_DEFINE_LINE_REGEX = /^define\( '([A-Z_]+)', (.+) \);[ \t]*$/;

function isStudioDefineLine( line: string ): boolean {
	const match = STUDIO_DEFINE_LINE_REGEX.exec( line );
	if ( ! match ) {
		return false;
	}
	const [ , name, value ] = match;
	return STUDIO_MANAGED_CONSTANTS[ name ]?.includes( value ) ?? false;
}

// Whether a define after this line is a statement of its own, rather than the
// body of a brace-less `if`, `else` or loop.
function endsStatement( line: string ): boolean {
	const trimmed = line.trim();
	return (
		/[;{}]$/.test( trimmed ) ||
		trimmed.endsWith( '*/' ) ||
		trimmed.startsWith( '//' ) ||
		trimmed.startsWith( '#' ) ||
		/^<\?php\b/.test( trimmed )
	);
}

/**
 * Removes the defines Studio writes for its managed constants from wp-config.php
 * content. Like `removeDbConstants()`, it only matches the exact lines Studio
 * writes, so constants a user defines in another form are left as is.
 */
export function stripStudioWpConfigConstants( content: string ): string {
	const lines = content.split( /(?<=\n)/ );
	let previousLine: string | undefined;

	return lines
		.filter( ( line ) => {
			const text = line.replace( /\r?\n$/, '' );
			const isPrecededByStatementEnd = previousLine === undefined || endsStatement( previousLine );
			if ( isPrecededByStatementEnd && isStudioDefineLine( text ) ) {
				return false;
			}
			if ( text.trim() !== '' ) {
				previousLine = text;
			}
			return true;
		} )
		.join( '' );
}
