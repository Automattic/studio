import { handleAddSiteWithBlueprint } from 'src/lib/deeplink/handlers/add-site-with-blueprint';
import { handleAuthDeeplink } from 'src/lib/deeplink/handlers/auth';
import { handleCheckoutReturnDeeplink } from 'src/lib/deeplink/handlers/checkout-return';
import { handleSyncConnectSiteDeeplink } from 'src/lib/deeplink/handlers/sync-connect-site';

/**
 * Main deeplink handler that routes incoming deeplinks to the appropriate handler.
 * Supports the following deeplink schemes:
 * - wp-studio://auth - OAuth authentication callback
 * - wp-studio://sync-connect-site - Sync site connection from WordPress.com
 * - wp-studio://add-site?blueprint_url=<encoded-url> - Add site with blueprint from URL
 * - wp-studio://checkout-return?studioReturnTo=<flow> - Return from a WordPress.com checkout
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
		case 'add-site':
			await handleAddSiteWithBlueprint( urlObject );
			break;
		case 'checkout-return':
			await handleCheckoutReturnDeeplink( urlObject );
			break;
		default:
			console.warn( `Unknown deeplink host: ${ host }` );
	}
}
