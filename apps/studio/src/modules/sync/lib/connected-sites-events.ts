export const CONNECTED_WPCOM_SITES_UPDATED_EVENT = 'studio-connected-wpcom-sites-updated';

export const notifyConnectedWpcomSitesUpdated = () => {
	if ( typeof window === 'undefined' ) {
		return;
	}

	window.dispatchEvent( new Event( CONNECTED_WPCOM_SITES_UPDATED_EVENT ) );
};
