/**
 * Polls `url` with HTTP requests until the server answers, and resolves to that
 * response with its body discarded. An HTTP request, not a bare TCP connect:
 * connect/destroy socket churn crashed Node on Windows
 * (see `packages/common/lib/port-finder.ts`).
 */
export async function waitForServerReady(
	url: string,
	options: { timeoutMs: number; pollIntervalMs: number; signal?: AbortSignal }
): Promise< Response > {
	const { timeoutMs, pollIntervalMs, signal } = options;
	const deadline = Date.now() + timeoutMs;

	while ( true ) {
		signal?.throwIfAborted();
		try {
			const response = await fetch( url, { redirect: 'manual', signal } );
			await response.body?.cancel().catch( () => {} );
			return response;
		} catch {
			signal?.throwIfAborted();
			if ( Date.now() > deadline ) {
				throw new Error( `${ url } did not respond within ${ timeoutMs }ms` );
			}
			await new Promise< void >( ( resolve ) => setTimeout( resolve, pollIntervalMs ) );
		}
	}
}
