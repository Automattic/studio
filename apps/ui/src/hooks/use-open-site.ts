import { TRACKS_EVENTS } from '@studio/common/lib/record-tracks-event';
import { useNavigate } from '@tanstack/react-router';
import { useConnector } from '@/data/core';
import { useAgenticFeatures } from '@/data/queries/use-agentic-features';
import type { AiSessionSummary, SiteDetails } from '@/data/core';

// Opens a site where the sidebar does: its latest chat, a new chat, or, without
// Studio Code, its own page. Signed-out users still get the chat surface, where
// the value of logging in can be explained in context.
export function useOpenSite() {
	const navigate = useNavigate();
	const connector = useConnector();
	const { chatEnabled, chatPromptsSignIn } = useAgenticFeatures();

	return ( site: SiteDetails, latestSession?: AiSessionSummary ) => {
		if ( ! chatEnabled && ! chatPromptsSignIn ) {
			void connector.trackEvent( TRACKS_EVENTS.PANEL_OPENED, { panel: 'overview' } );
			void navigate( { to: '/sites/$siteId', params: { siteId: site.id } } );
			return;
		}
		void connector.trackEvent( TRACKS_EVENTS.PANEL_OPENED, { panel: 'assistant' } );
		if ( latestSession && ! chatPromptsSignIn ) {
			void navigate( { to: '/sessions/$sessionId', params: { sessionId: latestSession.id } } );
			return;
		}
		void navigate( { to: '/sites/$siteId/new', params: { siteId: site.id } } );
	};
}
