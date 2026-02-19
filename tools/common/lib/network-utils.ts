import dns from 'dns/promises';

/**
 * Check if the system has internet connectivity by testing DNS resolution.
 *
 * @returns Promise that resolves to true if online, false if offline
 */
export async function isOnline(): Promise< boolean > {
	try {
		const timeoutPromise = new Promise( ( _, reject ) =>
			setTimeout( () => reject( new Error( 'Timeout' ) ), 5000 )
		);

		await Promise.race( [ dns.resolve( 'public-api.wordpress.com' ), timeoutPromise ] );

		return true;
	} catch {
		return false;
	}
}
