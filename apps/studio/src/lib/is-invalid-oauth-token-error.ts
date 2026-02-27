interface InvalidTokenError {
	error: 'invalid_token';
}

export function isInvalidTokenError( response: unknown ): response is InvalidTokenError {
	return (
		response !== null &&
		typeof response === 'object' &&
		'error' in response &&
		response.error === 'invalid_token'
	);
}
