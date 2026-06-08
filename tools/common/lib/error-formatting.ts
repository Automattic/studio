export function getErrorMessage( error: unknown ): string | undefined {
	if ( error instanceof Error ) {
		return error.message.trim() || undefined;
	}

	if ( typeof error === 'string' ) {
		return error.trim() || undefined;
	}

	if ( error && typeof error === 'object' && 'message' in error ) {
		const message = ( error as { message?: unknown } ).message;
		if ( typeof message === 'string' ) {
			return message.trim() || undefined;
		}
	}

	return undefined;
}
