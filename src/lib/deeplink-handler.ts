import { handleAuthDeeplink } from 'src/lib/oauth';
import { handleSyncConnectSiteDeeplink } from 'src/lib/sync-connect-site-deeplink';

/**
 * Main deeplink handler that routes incoming deeplinks to the appropriate handler.
 * Supports the following deeplink schemes:
 * - wpcom-local-dev://auth - OAuth authentication callback
 * - wpcom-local-dev://sync-connect-site - Sync site connection from WordPress.com
 */
export async function handleDeeplink( url: string ): Promise< void > {
	const urlObject = new URL( url );
	const { host } = urlObject;

	switch ( host ) {
		case 'auth':
			await handleAuthDeeplink( urlObject );
			break;
		case 'sync-connect-site':
			await handleSyncConnectSiteDeeplink( urlObject );
			break;
		default:
			console.warn( `Unknown deeplink host: ${ host }` );
	}
}
