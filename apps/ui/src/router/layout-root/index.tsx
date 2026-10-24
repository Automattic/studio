import { aiSessionBelongsToSite } from '@studio/common/ai/sessions/owner-site';
import { SITE_EVENTS } from '@studio/common/lib/cli-events';
import { useQueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Outlet, useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { useConnector } from '@/data/core';
import { SESSIONS_QUERY_KEY } from '@/data/queries/use-sessions';
import { SITES_QUERY_KEY } from '@/data/queries/use-sites';
import { useAppMenuNavigation } from '@/features/commands';
import { useAiCreditsPurchaseResult } from '@/features/credits';
import { WapuuWorldMount, isSettingsSection, SettingsDialog } from '@/features/settings';
import { AddSiteDialog, isAddSiteSection } from '@/features/sites';
import type { AiSessionSummary, Connector, SiteDetails } from '@/data/core';
import type { SettingsSectionId } from '@/features/settings';
import type { AddSiteSection } from '@/features/sites';
import type { QueryClient } from '@tanstack/react-query';

export interface RouterContext {
	queryClient: QueryClient;
	connector: Connector;
}

function AppMenuNavigation() {
	useAppMenuNavigation();
	return null;
}

function AiCreditsPurchaseResult() {
	useAiCreditsPurchaseResult();
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

interface RootSearch {
	settings?: SettingsSectionId;
	settingsSite?: string;
	settingsFocus?: string;
	addSite?: AddSiteSection;
	pin?: true;
}

export const rootRoute = createRootRouteWithContext< RouterContext >()( {
	validateSearch: ( search: Record< string, unknown > ): RootSearch => ( {
		...( isSettingsSection( search.settings ) ? { settings: search.settings } : {} ),
		...( typeof search.settingsSite === 'string' ? { settingsSite: search.settingsSite } : {} ),
		...( typeof search.settingsFocus === 'string' ? { settingsFocus: search.settingsFocus } : {} ),
		...( isAddSiteSection( search.addSite ) ? { addSite: search.addSite } : {} ),
		...( search.pin === true || search.pin === 'true' ? { pin: true } : {} ),
	} ),
	component: () => (
		<>
			<AppMenuNavigation />
			<AiCreditsPurchaseResult />
			<DeletedSiteRedirect />
			<WapuuWorldMount />
			<Outlet />
			<SettingsDialog />
			<AddSiteDialog />
		</>
	),
} );
