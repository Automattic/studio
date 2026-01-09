import { sendIpcEventToRenderer } from 'src/ipc-utils';

/**
 * Handles the sync-connect-site deeplink callback.
 * This function is called when a user initiates a sync connection from WordPress.com
 * and is redirected back to the app via wp-studio://sync-connect-site
 */
export async function handleSyncConnectSiteDeeplink( urlObject: URL ): Promise< void > {
	const { searchParams } = urlObject;
	const remoteSiteId = parseInt( searchParams.get( 'remoteSiteId' ) ?? '' );
	const studioSiteId = searchParams.get( 'studioSiteId' );
	const autoOpenPush = searchParams.get( 'autoOpenPush' ) === 'true';
	const siteName = searchParams.get( 'siteName' ) ?? undefined;
	const siteUrl = searchParams.get( 'siteUrl' ) ?? undefined;

	if ( remoteSiteId && studioSiteId ) {
		void sendIpcEventToRenderer( 'sync-connect-site', {
			remoteSiteId,
			studioSiteId,
			autoOpenPush,
			siteName,
			siteUrl,
		} );
	}
}
