import { useCallback, useEffect, useState } from 'react';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { setStoredSessionId } from './use-single-session';
import type { AiSessionPlacementUpdatedEvent } from '@studio/common/ai/sessions/placement';
import type { IpcRendererEvent } from 'electron';

export interface PendingSiteCreation {
	siteId: string;
	siteName: string;
}

interface UseSiteCreationSwitchArgs {
	// The session currently shown in this tab. Placement events for other
	// sessions are ignored.
	sessionId: string | undefined;
	// The site this tab is anchored to. A placement onto this same site is a
	// no-op (the conversation is already here).
	currentSiteId: string;
	// Start a fresh conversation on the current site. Called the moment the
	// conversation migrates away, so this site is left on an empty chat.
	onStartNewChat: () => void;
}

export interface SiteCreationSwitch {
	pending: PendingSiteCreation | null;
	openNewSite: () => void;
	stayHere: () => void;
}

/**
 * Reacts to a site being created mid-conversation. The agent runs in the CLI;
 * when its `site_create` tool finishes, the main process re-homes the session
 * onto the new site and emits `ai-session-placement-updated`.
 *
 * The migration happens as soon as the event arrives, not on the user's click:
 * the new site is mapped to the moved session and the current site is reset to
 * a fresh chat right away. This keeps the prompt honest ("the conversation has
 * moved") and means clicking is never the thing that discards the chat. The
 * prompt is then a pure navigation choice:
 *  - Open the new site → navigate there; its tab loads the full transcript and
 *    the still-active run keeps streaming.
 *  - Stay here → just dismiss; this site already shows its new chat.
 */
export function useSiteCreationSwitch( {
	sessionId,
	currentSiteId,
	onStartNewChat,
}: UseSiteCreationSwitchArgs ): SiteCreationSwitch {
	const { sites, setSelectedSiteId } = useSiteDetails();
	const [ pending, setPending ] = useState< PendingSiteCreation | null >( null );
	// When the user opts to switch before the new site has propagated into the
	// site list (the CREATED `site-event` races the placement event), defer the
	// switch until it appears — `selectedSite` falls back to the first site for
	// an unknown id, which would flash the wrong site.
	const [ deferredSwitchSiteId, setDeferredSwitchSiteId ] = useState< string | null >( null );

	const handlePlacement = useCallback(
		( _event: IpcRendererEvent, payload: AiSessionPlacementUpdatedEvent ) => {
			if ( ! sessionId || payload.sessionId !== sessionId ) {
				return;
			}
			if ( payload.placement.kind !== 'site' || payload.placement.siteId === currentSiteId ) {
				return;
			}
			// Hand the conversation to the new site and immediately leave this one
			// on a fresh chat, so the move is real before the user decides where to
			// look — not a side effect of dismissing the prompt.
			setStoredSessionId( payload.placement.siteId, sessionId );
			onStartNewChat();
			setPending( { siteId: payload.placement.siteId, siteName: payload.placement.siteName } );
		},
		[ sessionId, currentSiteId, onStartNewChat ]
	);

	useIpcListener( 'ai-session-placement-updated', handlePlacement );

	useEffect( () => {
		if ( deferredSwitchSiteId && sites.some( ( site ) => site.id === deferredSwitchSiteId ) ) {
			setSelectedSiteId( deferredSwitchSiteId );
			setDeferredSwitchSiteId( null );
		}
	}, [ deferredSwitchSiteId, sites, setSelectedSiteId ] );

	const openNewSite = useCallback( () => {
		if ( ! pending ) {
			return;
		}
		if ( sites.some( ( site ) => site.id === pending.siteId ) ) {
			setSelectedSiteId( pending.siteId );
		} else {
			setDeferredSwitchSiteId( pending.siteId );
		}
		setPending( null );
	}, [ pending, sites, setSelectedSiteId ] );

	const stayHere = useCallback( () => {
		// The migration already happened when the prompt opened; staying is just
		// a dismissal.
		setPending( null );
	}, [] );

	return { pending, openNewSite, stayHere };
}
