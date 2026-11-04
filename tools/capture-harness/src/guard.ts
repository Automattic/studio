import type { ElectronApplication } from 'playwright';

/**
 * Main-process handlers that change something on WordPress.com, spend the
 * account's credits, or revoke its token. Every signed-in launch replaces them
 * with ones that throw, whatever script runs, so no step can run them with a
 * real login; a script that needs one answers it itself (`stubAgentRuns` for
 * `continueAiSession`).
 */
const BLOCKED_SIGNED_IN_HANDLERS = [
	'clearAuthenticationToken',
	'connectWpcomSites',
	'continueAiSession',
	'deleteAllSnapshots',
	'deletePreviewSite',
	'disconnectWpcomSites',
	'publishPreviewSite',
	'pullSiteFromLive',
	'pushSiteToLive',
	'renamePreviewSite',
];

const WPCOM_API = 'https://public-api.wordpress.com/**';

/**
 * Applies the signed-in guard to a running Studio Desktop (the browser
 * driver's is `BLOCKED_API` in drivers/browser.ts): the blocked handlers throw,
 * and the window's requests to WordPress.com other than reads are aborted.
 */
export async function guardElectron( app: ElectronApplication ) {
	await app.evaluate( ( { ipcMain }, names ) => {
		for ( const name of names ) {
			ipcMain.removeHandler( name );
			ipcMain.handle( name, () => {
				throw new Error( `${ name } is blocked while capturing signed in` );
			} );
		}
	}, BLOCKED_SIGNED_IN_HANDLERS );
	await app
		.context()
		.route( WPCOM_API, ( route ) =>
			route.request().method() === 'GET' ? route.fallback() : route.abort()
		);
}
