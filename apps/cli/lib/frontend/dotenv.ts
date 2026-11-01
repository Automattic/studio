import fs from 'fs';

const LINE_PATTERN = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/;

function findClosingQuote( value: string, quote: string ): number {
	for ( let index = 1; index < value.length; index++ ) {
		if ( quote === '"' && value[ index ] === '\\' ) {
			index++;
			continue;
		}
		if ( value[ index ] === quote ) {
			return index;
		}
	}
	return -1;
}

function unescapeDoubleQuoted( value: string ): string {
	return value.replace( /\\(.)/g, ( _match, char: string ) => {
		switch ( char ) {
			case 'n':
				return '\n';
			case 'r':
				return '\r';
			case 't':
				return '\t';
			default:
				return char;
		}
	} );
}

function parseValue( rawValue: string ): string {
	const value = rawValue.trim();
	const quote = value[ 0 ];
	if ( quote === '"' || quote === "'" || quote === '`' ) {
		const end = findClosingQuote( value, quote );
		if ( end !== -1 ) {
			const inner = value.slice( 1, end );
			return quote === '"' ? unescapeDoubleQuoted( inner ) : inner;
		}
	}
	const commentIndex = value.search( /\s#/ );
	return ( commentIndex === -1 ? value : value.slice( 0, commentIndex ) ).trim();
}

/**
 * Parses the dotenv syntax the frontend templates and `formatEnvFile` write:
 * `KEY=value`, an optional `export`, single, double or backtick quotes, `\"`,
 * `\\` and `\n` escapes inside double quotes, and `#` comments. Later keys win.
 */
export function parseDotenv( content: string ): Record< string, string > {
	const env: Record< string, string > = {};
	for ( const line of content.split( /\r?\n/ ) ) {
		const trimmed = line.trim();
		if ( ! trimmed || trimmed.startsWith( '#' ) ) {
			continue;
		}
		const match = LINE_PATTERN.exec( line );
		if ( match ) {
			env[ match[ 1 ] ] = parseValue( match[ 2 ] );
		}
	}
	return env;
}

export function readDotenvFile( filePath: string ): Record< string, string > {
	try {
		return parseDotenv( fs.readFileSync( filePath, 'utf8' ) );
	} catch {
		return {};
	}
}
