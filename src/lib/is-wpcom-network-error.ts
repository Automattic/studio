export function isWpcomNetworkError( value: unknown ): value is WpcomNetworkError {
	return (
		value instanceof Error &&
		'code' in value &&
		typeof value[ 'code' ] === 'string' &&
		'status' in value &&
		typeof value[ 'status' ] === 'number'
	);
}
