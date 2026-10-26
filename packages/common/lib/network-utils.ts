import dns from 'dns/promises';

/**
 * Check if the system has internet connectivity by testing DNS resolution.
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
