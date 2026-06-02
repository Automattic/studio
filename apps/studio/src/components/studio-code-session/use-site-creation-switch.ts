import { useCallback, useEffect, useRef, useState } from 'react';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { clearStoredSessionId, setStoredSessionId } from './use-single-session';
import type { IpcRendererEvent } from 'electron';
import type { AiSessionPlacementUpdatedEvent } from 'src/lib/ai-session-placement';

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
	// Start a fresh conversation on the current site — used by the "Stay here"
	// branch, since the existing conversation has migrated to the new site.
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
 * onto the new site and emits `ai-session-placement-updated`. The desk UI
 * (apps/ui) shows a "Continue in the site desk?" dialog off the same event;
 * this is the embedded-tab equivalent.
 *
 * On a placement onto a *different* site we immediately map that new site to
 * the current session (so it owns the conversation) and surface a choice:
 *  - Open the new site → navigate there; its tab loads the full transcript and
 *    the still-active run keeps streaming. The current site forgets the moved
 *    session so it doesn't double-own it.
 *  - Stay here → start a fresh conversation on the current site; the migrated
 *    one waits on the new site.
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
	// Guards against acting twice on one prompt. Closing the dialog (e.g. after
	// choosing "Open") fires the same dismissal path as "Stay here", so without
	// this the stay branch could also run and create a stray empty session.
	const decisionMadeRef = useRef( false );

	const handlePlacement = useCallback(
		( _event: IpcRendererEvent, payload: AiSessionPlacementUpdatedEvent ) => {
			if ( ! sessionId || payload.sessionId !== sessionId ) {
				return;
			}
			if ( payload.placement.kind !== 'site' || payload.placement.siteId === currentSiteId ) {
				return;
			}
			// The conversation now belongs to the new site regardless of which
			// branch the user picks, so claim it eagerly.
			setStoredSessionId( payload.placement.siteId, sessionId );
			decisionMadeRef.current = false;
			setPending( { siteId: payload.placement.siteId, siteName: payload.placement.siteName } );
		},
		[ sessionId, currentSiteId ]
	);

	useIpcListener( 'ai-session-placement-updated', handlePlacement );

	useEffect( () => {
		if ( deferredSwitchSiteId && sites.some( ( site ) => site.id === deferredSwitchSiteId ) ) {
			setSelectedSiteId( deferredSwitchSiteId );
			setDeferredSwitchSiteId( null );
		}
	}, [ deferredSwitchSiteId, sites, setSelectedSiteId ] );

	const openNewSite = useCallback( () => {
		if ( ! pending || decisionMadeRef.current ) {
			return;
		}
		decisionMadeRef.current = true;
		// The current site no longer owns the conversation — it moved.
		clearStoredSessionId( currentSiteId );
		if ( sites.some( ( site ) => site.id === pending.siteId ) ) {
			setSelectedSiteId( pending.siteId );
		} else {
			setDeferredSwitchSiteId( pending.siteId );
		}
		setPending( null );
	}, [ pending, currentSiteId, sites, setSelectedSiteId ] );

	const stayHere = useCallback( () => {
		if ( decisionMadeRef.current ) {
			return;
		}
		decisionMadeRef.current = true;
		setPending( null );
		onStartNewChat();
	}, [ onStartNewChat ] );

	return { pending, openNewSite, stayHere };
}
