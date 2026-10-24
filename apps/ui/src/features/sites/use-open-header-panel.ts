import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import { useSessionPreviewUI } from '@/features/chats';

type HeaderPanelRequest =
	| {
			panel: 'publish';
			siteId: string;
			view: 'publish' | 'pull' | 'websites';
			remoteSiteId?: number;
	  }
	| { panel: 'share'; siteId: string };

// A request to open one of the preview header's panels from elsewhere (the
// site menu, the command palette, onboarding), held until that site's header
// is on screen.
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

// Shows the site's preview, where the header panels live, and opens one.
export function useOpenHeaderPanel() {
	const navigate = useNavigate();
	const { setOpen, siteId: previewSiteId } = useSessionPreviewUI();
	return useCallback(
		( request: HeaderPanelRequest ) => {
			requestHeaderPanel( request );
			setOpen( true );
			if ( previewSiteId !== request.siteId ) {
				void navigate( { to: '/sites/$siteId', params: { siteId: request.siteId } } );
			}
		},
		[ navigate, previewSiteId, setOpen ]
	);
}
