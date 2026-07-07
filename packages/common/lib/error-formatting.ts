export function getErrorMessage( error: unknown ): string | undefined {
	if ( error instanceof Error ) {
		return error.message.trim() || undefined;
	}

	if ( typeof error === 'string' ) {
		return error.trim() || undefined;
	}

	if (
		error !== null &&
		typeof error === 'object' &&
		'message' in error &&
		typeof error.message === 'string'
	) {
		return error.message.trim() || undefined;
	}

	return undefined;
}
