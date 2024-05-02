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

// Attempts to sanitize a user path by replacing the user's home directory with a tilde.
// Returns the original path if it does not match the pattern or if it is not a string.
export function sanitizeUserpath( path: string ): string {
	// Matches expected user path on macOS
	if ( typeof path === 'string' && /\/Users\/[^/]+\/Library/.test( path ) ) {
		return path.replace( /\/Users\/[^/]+(\/Library)/, '~$1' );
	}

	return path;
}
