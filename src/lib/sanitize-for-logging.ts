const sensitiveKeys = [ 'auth', 'email', 'password', 'secret', 'token' ];

export function sanitizeForLogging( data: object ): object {
	return Object.entries( data ).reduce( ( acc, [ key, value ] ) => {
		if ( value && typeof value === 'object' ) {
			return {
				...acc,
				[ key ]: sanitizeForLogging( value ),
			};
		}

		const isSensitive = sensitiveKeys.some( ( sensitiveKey ) =>
			key.toLowerCase().includes( sensitiveKey )
		);

		if ( isSensitive && typeof value === 'string' ) {
			return { ...acc, [ key ]: 'REDACTED' };
		}

		return { ...acc, [ key ]: value };
	}, {} );
}

// Attempts to sanitize data that is somewhat structured but invalid format.
// The output will always end in a new-line, but it's easier to implement that way.
export function sanitizeUnstructuredData( data: string ): string {
	return sensitiveKeys.reduce( ( sanitized, sensitiveKey ) => {
		return sanitized.replace( new RegExp( `${ sensitiveKey }.*(\n|$)`, 'ig' ), 'REDACTED\n' );
	}, data );
}

// Attempts to sanitize a user path by redacting the username from the path.
// Returns the original path in development mode
export function sanitizeUserpath( path: string ): string {
	// Disable no-useless-escape to account for both Windows and Unix userpath slash formats
	// eslint-disable-next-line no-useless-escape
	const userpathRegex = /^([A-Z]:)?([\\\/])Users\2([^\\\/]+)\2/i;

	if ( process.env.NODE_ENV !== 'development' ) {
		return path.replace( userpathRegex, '$1$2Users$2[REDACTED]$2' );
	}
	return path;
}
