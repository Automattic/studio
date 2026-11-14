const sensitiveKeys = [ 'auth', 'email', 'password', 'secret', 'token' ];

// Attempts to sanitize data that is somewhat structured but invalid format.
// The output will always end in a new-line, but it's easier to implement that way.
export function sanitizeUnstructuredData( data: string ): string {
	return sensitiveKeys.reduce( ( sanitized, sensitiveKey ) => {
		return sanitized.replace( new RegExp( `${ sensitiveKey }.*(\n|$)`, 'ig' ), 'REDACTED\n' );
	}, data );
}
