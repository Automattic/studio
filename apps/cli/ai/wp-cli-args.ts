// Splits a wp_cli tool command into the arguments WP-CLI receives.

// Split a shell-ish command into args, respecting quotes. Quotes are only
// recognized at arg start or right after `=` so values like `Ember & Oak`
// in `--post_title="Ember & Oak"` come through whole.
function splitBasicCommandArgs( command: string ): string[] {
	const args: string[] = [];
	let current = '';
	let inQuote: string | null = null;

	for ( let i = 0; i < command.length; i++ ) {
		const char = command[ i ];

		if ( inQuote ) {
			if ( char === inQuote ) {
				inQuote = null;
			} else {
				current += char;
			}
		} else if (
			( char === '"' || char === "'" ) &&
			( current === '' || current.endsWith( '=' ) )
		) {
			inQuote = char;
		} else if ( /\s/.test( char ) ) {
			if ( current ) {
				args.push( current );
				current = '';
			}
		} else {
			current += char;
		}
	}

	if ( current ) {
		args.push( current );
	}

	return args;
}

function stripMatchingOuterQuotes( value: string ): string {
	if ( value.length < 2 ) {
		return value;
	}

	const firstChar = value[ 0 ];
	const lastChar = value[ value.length - 1 ];
	if ( ( firstChar === '"' || firstChar === "'" ) && firstChar === lastChar ) {
		return value.slice( 1, -1 );
	}

	return value;
}

// Quoted post_content needs trailing flags split out (e.g. `--porcelain`
// after the closing quote); unquoted block markup is treated as a single
// literal arg through end-of-command.
function splitPostContentCommandArgs( command: string, postContentIndex: number ): string[] {
	const postContentMarker = '--post_content=';
	const prefix = command.slice( 0, postContentIndex ).trim();
	const postContentTail = command.slice( postContentIndex + postContentMarker.length ).trim();
	const prefixArgs = splitBasicCommandArgs( prefix );

	if ( ! postContentTail ) {
		return [ ...prefixArgs, postContentMarker ];
	}

	const quote = postContentTail[ 0 ];
	if ( quote === '"' || quote === "'" ) {
		const closingQuoteIndex = postContentTail.indexOf( quote, 1 );
		if ( closingQuoteIndex !== -1 ) {
			const postContent = postContentTail.slice( 1, closingQuoteIndex );
			const suffix = postContentTail.slice( closingQuoteIndex + 1 ).trim();
			return [
				...prefixArgs,
				`${ postContentMarker }${ postContent }`,
				...splitBasicCommandArgs( suffix ),
			];
		}
	}

	// No closing quote — large block content is commonly emitted without shell
	// quoting; treat everything after the marker as a single literal argument.
	return [
		...prefixArgs,
		`${ postContentMarker }${ stripMatchingOuterQuotes( postContentTail ) }`,
	];
}

export function splitCommandArgs( command: string ): string[] {
	const postContentMarker = '--post_content=';
	const postContentIndex = command.indexOf( postContentMarker );

	if ( postContentIndex !== -1 ) {
		return splitPostContentCommandArgs( command, postContentIndex );
	}

	return splitBasicCommandArgs( command );
}
