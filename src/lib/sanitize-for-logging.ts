export function sanitizeForLogging( data: object ): object {
	return Object.entries( data ).reduce( ( acc, [ key, value ] ) => {
		if ( value && typeof value === 'object' ) {
			return {
				...acc,
				[ key ]: sanitizeForLogging( value ),
			};
		}

		const isSensitive = [ 'auth', 'email', 'password', 'secret', 'token' ].some( ( sensitiveKey ) =>
			key.toLowerCase().includes( sensitiveKey )
		);

		if ( isSensitive && typeof value === 'string' ) {
			return { ...acc, [ key ]: 'REDACTED' };
		}

		return { ...acc, [ key ]: value };
	}, {} );
}
