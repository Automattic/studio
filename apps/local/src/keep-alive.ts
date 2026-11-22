const KEEP_ALIVE_INTERVAL_MS = 5 * 60_000;

/**
 * Requests `url` as a run starts and every few minutes while one is in progress. A host that
 * pauses idle servers passes this server's public address, so the request reaches the host like
 * any other and counts as use. Failures never affect the run.
 */
export function createKeepAlive( { url, isBusy }: { url?: string; isBusy: () => boolean } ) {
	if ( ! url ) {
		return { wake() {}, stop() {} };
	}
	let timer: ReturnType< typeof setInterval > | undefined;

	const send = () => {
		fetch( url ).then(
			( response ) => void response.body?.cancel(),
			( error: unknown ) => console.debug( `Keepalive request to ${ url } failed:`, error )
		);
	};

	const stop = () => {
		clearInterval( timer );
		timer = undefined;
	};

	return {
		wake() {
			if ( timer ) {
				return;
			}
			send();
			timer = setInterval( () => ( isBusy() ? send() : stop() ), KEEP_ALIVE_INTERVAL_MS );
			timer.unref();
		},
		stop,
	};
}
