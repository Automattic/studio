import { aiSessionBelongsToSite } from '@studio/agent/protocol/sessions/owner-site';
import { TRACKS_EVENTS } from '@studio/common/lib/record-tracks-event';
import { useNavigate } from '@tanstack/react-router';
import { useSyncExternalStore } from 'react';
import { useConnector } from '@/data/core';
import { resumeChat } from '@/data/last-visited';
import { useSessions } from '@/data/queries/use-sessions';
import { useOptionalSessionPreviewUI } from '@/data/use-session-ui';
import type { SiteDetails } from '@/data/core';

// When the site was last opened this way, for the wave across its dot field.
let selection: { siteId: string; time: number } | null = null;
const selectionListeners = new Set< () => void >();

export function useSiteSelectionTime( siteId: string | undefined ): number | undefined {
	const current = useSyncExternalStore(
		( listener ) => {
			selectionListeners.add( listener );
			return () => selectionListeners.delete( listener );
		},
		() => selection
	);
	return current && current.siteId === siteId ? current.time : undefined;
}

export function useOpenSite() {
	const navigate = useNavigate();
	const connector = useConnector();
	const { data: sessions } = useSessions();
	const preview = useOptionalSessionPreviewUI();

	return ( site: SiteDetails ) => {
		selection = { siteId: site.id, time: performance.now() };
		selectionListeners.forEach( ( listener ) => listener() );
		void connector.trackEvent( TRACKS_EVENTS.PANEL_OPENED, { panel: 'assistant' } );
		preview?.setSite( site.id );
		const session = resumeChat(
			site.id,
			( sessions ?? [] ).filter(
				( session ) =>
					!! session.firstPrompt && ! session.archived && aiSessionBelongsToSite( session, site )
			)
		);
		if ( site.running && session ) {
			void navigate( { to: '/sessions/$sessionId', params: { sessionId: session.id } } );
		} else {
			void navigate( { to: '/sites/$siteId/new', params: { siteId: site.id } } );
		}
	};
}
