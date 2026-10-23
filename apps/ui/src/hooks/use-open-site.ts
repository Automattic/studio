import { TRACKS_EVENTS } from '@studio/common/lib/record-tracks-event';
import { useNavigate } from '@tanstack/react-router';
import { useSyncExternalStore } from 'react';
import { useConnector } from '@/data/core';
import { useAgenticFeatures } from '@/data/queries/use-agentic-features';
import type { AiSessionSummary, SiteDetails } from '@/data/core';

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

// Opens a site where the sidebar does: its latest chat, a new chat, or, without
// Studio Code, its own page.
export function useOpenSite() {
	const navigate = useNavigate();
	const connector = useConnector();
	const { chatEnabled } = useAgenticFeatures();

	return ( site: SiteDetails, latestSession?: AiSessionSummary ) => {
		selection = { siteId: site.id, time: performance.now() };
		selectionListeners.forEach( ( listener ) => listener() );
		if ( ! chatEnabled ) {
			void connector.trackEvent( TRACKS_EVENTS.PANEL_OPENED, { panel: 'overview' } );
			void navigate( { to: '/sites/$siteId', params: { siteId: site.id } } );
			return;
		}
		void connector.trackEvent( TRACKS_EVENTS.PANEL_OPENED, { panel: 'assistant' } );
		if ( latestSession ) {
			void navigate( { to: '/sessions/$sessionId', params: { sessionId: latestSession.id } } );
			return;
		}
		void navigate( { to: '/sites/$siteId/new', params: { siteId: site.id } } );
	};
}
