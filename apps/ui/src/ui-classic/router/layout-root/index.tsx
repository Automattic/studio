import { aiSessionBelongsToSite } from '@studio/common/ai/sessions/owner-site';
import { SITE_EVENTS } from '@studio/common/lib/cli-events';
import { useQueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Outlet, useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { normalizeSettingsTab } from '@/components/settings-view';
import { useConnector } from '@/data/core';
import { SESSIONS_QUERY_KEY } from '@/data/queries/use-sessions';
import { SITES_QUERY_KEY } from '@/data/queries/use-sites';
import { useAddSiteListener } from '@/hooks/use-add-site-listener';
import { useMouseNavigation } from '@/hooks/use-mouse-navigation';
import type { AiSessionSummary, Connector, SiteDetails, UserSettingsEventTab } from '@/data/core';
import type { QueryClient } from '@tanstack/react-query';

export interface RouterContext {
	queryClient: QueryClient;
	connector: Connector;
}

function getSettingsTabFromEvent( tabName: UserSettingsEventTab | undefined ) {
	return normalizeSettingsTab( tabName );
}

function RootLayout() {
	const connector = useConnector();
	const navigate = useNavigate();

	useAddSiteListener();
	useMouseNavigation();

	useEffect( () => {
		return connector.onUserSettings( ( tabName ) => {
			void navigate( {
				to: '/settings',
				search: { tab: getSettingsTabFromEvent( tabName ) },
			} );
		} );
	}, [ connector, navigate ] );

	return (
		<>
			<DeletedSiteRedirect />
			<Outlet />
		</>
	);
}

/**
 * Sends the user to the root — which lands on the next available site — when
 * the site they're looking at is deleted from outside the app (`studio site
 * delete` in a terminal). Deleting a site takes its chats with it, so the open
 * route would otherwise be left pointing at a session that no longer exists.
 * The in-app delete flow redirects itself, from the confirmation dialog.
 */
export function DeletedSiteRedirect() {
	const connector = useConnector();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const params = useParams( { strict: false } ) as { sessionId?: string; siteId?: string };
	// Read through a ref: the subscription outlives any single route, and
	// resubscribing on every navigation would drop in-flight events.
	const paramsRef = useRef( params );
	useEffect( () => {
		paramsRef.current = params;
	}, [ params ] );

	useEffect(
		() =>
			connector.onSiteEvent( ( event ) => {
				if ( event.event !== SITE_EVENTS.DELETED ) {
					return;
				}

				const { sessionId, siteId } = paramsRef.current;
				if ( siteId && siteId === event.siteId ) {
					void navigate( { to: '/' } );
					return;
				}
				if ( ! sessionId ) {
					return;
				}

				// Both caches still hold pre-delete data at this point: the
				// refetches this same event triggers elsewhere haven't landed yet,
				// so the deleted site and its chats are still resolvable.
				const sites = queryClient.getQueryData< SiteDetails[] >( SITES_QUERY_KEY );
				const sessions = queryClient.getQueryData< AiSessionSummary[] >( SESSIONS_QUERY_KEY );
				const deletedSite = sites?.find( ( site ) => site.id === event.siteId );
				const openSession = sessions?.find( ( session ) => session.id === sessionId );

				const belongsToDeletedSite =
					openSession &&
					( deletedSite
						? aiSessionBelongsToSite( openSession, deletedSite )
						: openSession.ownerSiteId === event.siteId );
				if ( belongsToDeletedSite ) {
					void navigate( { to: '/' } );
				}
			} ),
		[ connector, navigate, queryClient ]
	);

	return null;
}

export const rootRoute = createRootRouteWithContext< RouterContext >()( {
	component: RootLayout,
} );
