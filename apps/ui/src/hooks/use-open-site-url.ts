import { useConnector } from '@/data/core';
import { useStartSite } from '@/data/queries/use-sites';
import type { SiteDetails } from '@/data/core';

/**
 * Opens a relative URL on the site in the browser, starting the site first
 * when it isn't running.
 */
export function useOpenSiteUrl( site: SiteDetails ) {
	const connector = useConnector();
	const startSite = useStartSite();

	return async ( relativeUrl: string ) => {
		if ( ! site.running ) {
			try {
				await startSite.mutateAsync( site.id );
			} catch {
				return;
			}
		}
		void connector.openSiteUrl( site.id, relativeUrl ).catch( ( error ) => {
			console.error( 'Failed to open site URL:', error );
		} );
	};
}
