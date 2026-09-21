import { useConnector } from '@/data/core';
import { useStartSite } from '@/data/queries/use-sites';
import { useOptionalSessionPreviewUI } from '@/hooks/use-session-ui';
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
	const startSite = useStartSite( { silent: true } );

	return async ( relativeUrl: string ) => {
		if ( ! preview ) {
			if ( ! site.running ) {
				try {
					// Resolves false when the start was skipped — opening the URL
					// then would just point the browser at a site that never came up.
					if ( ! ( await startSite.mutateAsync( site.id ) ) ) {
						return;
					}
				} catch {
					return;
				}
			}
			void connector.openSiteUrl( site.id, relativeUrl ).catch( ( error ) => {
				console.error( 'Failed to open site URL:', error );
			} );
			return;
		}

		// Point the panel at the destination *before* starting the site. The
		// preview only mounts its webview once the site is running, so it then
		// loads the destination directly. Starting first would mount the
		// webview on the previous path, and the load it reports back would
		// overwrite the destination we set afterwards.
		preview.setOpen( true );
		preview.setSite( site.id );
		preview.updatePath(
			`/studio-auto-login?redirect_to=${ encodeURIComponent( relativeUrl || '/' ) }`
		);

		if ( ! site.running ) {
			try {
				await startSite.mutateAsync( site.id );
			} catch {
				// The panel already points at the destination; it loads if and
				// when the site comes up.
			}
		}
	};
}
