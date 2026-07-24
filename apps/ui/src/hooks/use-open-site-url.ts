import { useConnector } from '@/data/core';
import { useStartSite } from '@/data/queries/use-sites';
import { useOptionalSessionPreviewUI } from '@/hooks/use-session-ui';
import { getSiteUrl } from '@/lib/get-site-url';
import type { SiteDetails } from '@/data/core';

/**
 * Opens a relative URL on the site in the in-app preview panel, starting the
 * site first when it isn't running. Links go through the site's
 * `/studio-auto-login` endpoint (mirroring the main process's `openSiteURL`
 * browser behavior) so admin screens don't land on the login form.
 *
 * Outside the dashboard's SessionUIProvider (no preview panel to drive),
 * falls back to opening the external browser like it used to.
 */
export function useOpenSiteUrl( site: SiteDetails ) {
	const connector = useConnector();
	const preview = useOptionalSessionPreviewUI();
	const startSite = useStartSite();

	return async ( relativeUrl: string ) => {
		let currentSite = site;
		if ( ! site.running ) {
			try {
				await startSite.mutateAsync( site.id );
			} catch {
				return;
			}
			// Ports are allocated dynamically on start; re-read the started
			// site so the auto-login redirect doesn't embed a stale URL.
			try {
				const sites = await connector.getSites();
				currentSite = sites.find( ( candidate ) => candidate.id === site.id ) ?? site;
			} catch {
				// Keep the closure's site; worst case the redirect misses and
				// the preview still shows the site root.
			}
		}
		if ( ! preview ) {
			void connector.openSiteUrl( site.id, relativeUrl ).catch( ( error ) => {
				console.error( 'Failed to open site URL:', error );
			} );
			return;
		}
		try {
			const redirectTo = new URL( relativeUrl || '/', getSiteUrl( currentSite ) ).toString();
			preview.setOpen( true );
			preview.setSite( site.id );
			preview.updatePath( `/studio-auto-login?redirect_to=${ encodeURIComponent( redirectTo ) }` );
		} catch ( error ) {
			// Malformed URL (shouldn't happen) — fall back to the browser so
			// the click still does something.
			console.error( 'Failed to open site URL in preview:', error );
			void connector.openSiteUrl( site.id, relativeUrl ).catch( () => undefined );
		}
	};
}
