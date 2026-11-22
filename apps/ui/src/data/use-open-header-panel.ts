import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import { useSites } from '@/data/queries/use-sites';
import { useOpenSite } from '@/data/use-open-site';
import { useSessionPreviewUI } from '@/data/use-session-ui';
import type { SitesProviderId } from '@studio/providers';

type HeaderPanelRequest = (
	| {
			panel: 'publish';
			siteId: string;
			view: 'publish' | 'pull';
			// The provider to publish to; without one, the panel lists the published sites.
			provider?: SitesProviderId;
			remoteSiteId?: string | number;
	  }
	| { panel: 'share'; siteId: string; createIfMissing?: boolean }
) & { trigger?: HTMLElement };

// A request to open a site's header panel, held until that site's header is on screen.
let pending: HeaderPanelRequest | null = null;
const listeners = new Set< () => void >();

export function requestHeaderPanel( request: HeaderPanelRequest ) {
	pending = request;
	listeners.forEach( ( listener ) => listener() );
}

export function subscribeHeaderPanelRequest< Panel extends HeaderPanelRequest[ 'panel' ] >(
	siteId: string,
	panel: Panel,
	onRequest: ( request: Extract< HeaderPanelRequest, { panel: Panel } > ) => void
) {
	const listener = () => {
		if ( pending?.siteId === siteId && pending.panel === panel ) {
			const request = pending as Extract< HeaderPanelRequest, { panel: Panel } >;
			pending = null;
			onRequest( request );
		}
	};
	listeners.add( listener );
	listener();
	return () => {
		listeners.delete( listener );
	};
}

// Opens a header panel without changing the site's preview layout.
export function useOpenHeaderPanel() {
	const navigate = useNavigate();
	const { data: sites } = useSites();
	const openSite = useOpenSite( { animateSelection: false } );
	const { siteId: previewSiteId } = useSessionPreviewUI();
	return useCallback(
		( request: HeaderPanelRequest ) => {
			requestHeaderPanel( request );
			if ( previewSiteId !== request.siteId ) {
				const site = sites?.find( ( candidate ) => candidate.id === request.siteId );
				if ( site ) openSite( site );
				else void navigate( { to: '/sites/$siteId/new', params: { siteId: request.siteId } } );
			}
		},
		[ navigate, openSite, previewSiteId, sites ]
	);
}
