/**
 * Whether a `fetch()` failed without reaching the server: no network, a DNS failure, a
 * refused or timed-out connection (`TypeError: fetch failed`), or a timeout signal that
 * expired first (a `TimeoutError` `DOMException`, matched by name because it may come
 * from another realm).
 */
export function isNetworkError( error: unknown ): boolean {
	if ( error instanceof TypeError && error.message === 'fetch failed' ) {
		return true;
	}
	return (
		typeof error === 'object' &&
		error !== null &&
		( error as { name?: unknown } ).name === 'TimeoutError'
	);
}
