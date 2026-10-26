/**
 * Whether a `fetch()` failed without reaching the server: no network, a DNS failure, a
 * refused or timed-out connection (`TypeError: fetch failed`), or an
 * `AbortSignal.timeout()` that expired first (`TimeoutError`).
 */
export function isNetworkError( error: unknown ): boolean {
	return (
		( error instanceof TypeError && error.message === 'fetch failed' ) ||
		( error instanceof Error && error.name === 'TimeoutError' )
	);
}
