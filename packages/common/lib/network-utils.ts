import dns from 'dns/promises';

const CONNECTIVITY_PROBE_HOST = 'public-api.wordpress.com';
const CONNECTIVITY_TIMEOUT_MS = 5000;

/**
 * Resolves with the first promise that fulfills and rejects only once every
 * promise has rejected. Equivalent to `Promise.any()`, which the project's
 * compilation target does not provide.
 */
function firstFulfilled< T >( promises: Promise< T >[] ): Promise< T > {
	return new Promise< T >( ( resolve, reject ) => {
		let rejections = 0;
		for ( const promise of promises ) {
			promise.then( resolve, ( error ) => {
				rejections += 1;
				if ( rejections === promises.length ) {
					reject( error );
				}
			} );
		}
	} );
}

/**
 * Check if the system has internet connectivity by resolving a WordPress.com host.
 *
 * The check goes through `dns.lookup()`, which uses the operating system's
 * resolver (getaddrinfo), the same path the HTTP requests Studio makes next
 * go through. `dns.resolve()` was used before; it bypasses the OS and talks
 * to the name servers c-ares discovers on its own, which fails on Windows
 * machines where Node reports the servers as 127.0.0.1 even though the system
 * resolves fine (nodejs/node#62748). That produced a false "offline" while
 * creating sites.
 *
 * IPv4 and IPv6 are resolved separately and the first answer wins. A single
 * unspecified-family lookup waits for both records, and on networks that drop
 * AAAA queries that wait alone can exceed the timeout.
 *
 * @returns Promise that resolves to true if online, false if offline
 */
export async function isOnline(): Promise< boolean > {
	let timer: ReturnType< typeof setTimeout > | undefined;
	const timeout = new Promise< never >( ( _, reject ) => {
		timer = setTimeout(
			() => reject( new Error( 'Connectivity check timed out' ) ),
			CONNECTIVITY_TIMEOUT_MS
		);
	} );

	try {
		await Promise.race( [
			firstFulfilled( [
				dns.lookup( CONNECTIVITY_PROBE_HOST, { family: 4 } ),
				dns.lookup( CONNECTIVITY_PROBE_HOST, { family: 6 } ),
			] ),
			timeout,
		] );
		return true;
	} catch {
		return false;
	} finally {
		// Never keep the process alive for the remainder of the timeout.
		clearTimeout( timer );
	}
}
