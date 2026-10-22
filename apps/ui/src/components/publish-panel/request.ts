import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import { useSessionPreviewUI } from '@/hooks/use-session-ui';

export type PublishRequest = {
	siteId: string;
	view: 'publish' | 'pull' | 'websites';
	remoteSiteId?: number;
};

// A request to open a site's Publish panel from elsewhere (the site menu, the
// command palette, onboarding), held until that site's panel is on screen.
let pending: PublishRequest | null = null;
const listeners = new Set< () => void >();

export function requestPublish( request: PublishRequest ) {
	pending = request;
	listeners.forEach( ( listener ) => listener() );
}

export function subscribePublishRequest(
	siteId: string,
	onRequest: ( request: PublishRequest ) => void
) {
	const listener = () => {
		if ( pending?.siteId === siteId ) {
			const request = pending;
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

// Shows the site's preview, where the Publish button lives, and opens its panel.
export function useOpenPublish() {
	const navigate = useNavigate();
	const preview = useSessionPreviewUI();
	const { setOpen, siteId: previewSiteId } = preview;
	return useCallback(
		( request: PublishRequest ) => {
			requestPublish( request );
			setOpen( true );
			if ( previewSiteId !== request.siteId ) {
				void navigate( { to: '/sites/$siteId', params: { siteId: request.siteId } } );
			}
		},
		[ navigate, previewSiteId, setOpen ]
	);
}
