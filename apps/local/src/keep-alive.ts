const KEEP_ALIVE_INTERVAL_MS = 5 * 60_000;

interface KeepAliveOptions {
	url?: string;
	isBusy: () => boolean;
	fetch?: typeof fetch;
}

/**
 * Requests `url` while an agent run is in progress: once when `wake()` is called, as a run
 * starts, then every few minutes until no run is left. A host that pauses idle servers points
 * `url` at the server's own public address, so the request reaches it like any other and keeps
 * the server awake while the agent works. Without `url` it does nothing, and failures are ignored:
 * they never affect the run.
 */
export function createKeepAlive( { url, isBusy, fetch: request = fetch }: KeepAliveOptions ) {
	let timer: ReturnType< typeof setInterval > | undefined;

	const send = ( target: string ) => {
		request( target ).then(
			( response ) => void response.body?.cancel(),
			( error: unknown ) => console.debug( `Keepalive request to ${ target } failed:`, error )
		);
	};

	const stop = () => {
		clearInterval( timer );
		timer = undefined;
	};

	return {
		wake() {
			if ( ! url || timer ) {
				return;
			}
			send( url );
			timer = setInterval( () => ( isBusy() ? send( url ) : stop() ), KEEP_ALIVE_INTERVAL_MS );
			timer.unref();
		},
		stop,
	};
}
