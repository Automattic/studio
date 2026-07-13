import { SITE_EVENTS } from '@studio/common/lib/cli-events';
import { useQueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Outlet, useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { useConnector } from '@/data/core';
import { SESSIONS_QUERY_KEY } from '@/data/queries/use-sessions';
import { SITES_QUERY_KEY } from '@/data/queries/use-sites';
import type { AiSessionSummary, Connector, SiteDetails } from '@/data/core';
import type { QueryClient } from '@tanstack/react-query';

export interface RouterContext {
	queryClient: QueryClient;
	connector: Connector;
}

// Bridges the Electron application menu ("Add Site…", "Settings…" and their
// keyboard shortcuts) to router navigation. Mounted at the root so the
// shortcuts work from any route, including onboarding.
function AppMenuNavigation() {
	const connector = useConnector();
	const navigate = useNavigate();

	useEffect(
		() => connector.onAddSite( () => void navigate( { to: '/onboarding' } ) ),
		[ connector, navigate ]
	);
	useEffect(
		() => connector.onOpenSettings( () => void navigate( { to: '/settings' } ) ),
		[ connector, navigate ]
	);

	return null;
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
				const deletedSitePath = sites?.find( ( site ) => site.id === event.siteId )?.path;
				const openSession = sessions?.find( ( session ) => session.id === sessionId );

				if ( deletedSitePath && openSession?.ownerSitePath === deletedSitePath ) {
					void navigate( { to: '/' } );
				}
			} ),
		[ connector, navigate, queryClient ]
	);

	return null;
}

export const rootRoute = createRootRouteWithContext< RouterContext >()( {
	component: () => (
		<>
			<AppMenuNavigation />
			<DeletedSiteRedirect />
			<Outlet />
		</>
	),
} );
