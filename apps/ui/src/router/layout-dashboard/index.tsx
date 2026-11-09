import { findAiSessionOwnerSite } from '@studio/agent/protocol/sessions/owner-site';
import { useQueryClient } from '@tanstack/react-query';
import { createRoute, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { __, isRTL } from '@wordpress/i18n';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useConnector } from '@/data/core';
import { WindowControlsCornerContext } from '@/data/host/use-window-controls-inset';
import { useAiSettings } from '@/data/queries/use-ai-settings';
import { useAuthUser } from '@/data/queries/use-auth-user';
import { useSession, useSessionLiveSite, useSessions } from '@/data/queries/use-sessions';
import { useSiteChatDraft } from '@/data/queries/use-site-chat-draft';
import {
	useIsSiteStarting,
	useIsSiteStopping,
	useSiteOperation,
	useSites,
} from '@/data/queries/use-sites';
import { useUserPreferences } from '@/data/queries/use-user-preferences';
import { getSiteRestartId, isSiteRestarting, useSiteRestartStates } from '@/data/site-restarts';
import { useOpenSettings } from '@/data/use-open-settings';
import { PanelCommandContext } from '@/data/use-panel-command';
import { pathForSite, useSessionPreviewUI } from '@/data/use-session-ui';
import {
	useWorkspaceLayoutTracks,
	WorkspaceLayoutTracksContext,
} from '@/data/use-workspace-layout-tracks';
import { AccountPromptDialog } from '@/features/account';
import {
	getSiteAnnotations,
	requestAnnotationSend,
	useSiteAnnotations,
} from '@/features/annotations';
import { SiteWorkspace, SessionHeader } from '@/features/chats';
import { CommandPalette } from '@/features/commands';
import { pendingComposerFilesSlot } from '@/features/composer';
import {
	useOrientationAutostart,
	useOrientationReplay,
	useWhatsNewAutostart,
	useWhatsNewReplay,
} from '@/features/onboarding';
import { SidebarLayout, HeaderSidebarToggle, rememberVisit } from '@/features/sidebar';
import { PanelSplitFrame, type PanelSplitFramePanelProps } from '@/features/sites';
import {
	SiteHeaderActions,
	SiteHeaderActionsProvider,
	SitePreview,
	PanelLayoutControls,
	PreviewTabs,
} from '@/features/sites';
import { useMediaQuery, useWindowControlsOverlay } from '@/lib/hooks';
import { isDialogOpen } from '@/lib/keyboard';
import { rootRoute } from '../layout-root';
import styles from './style.module.css';

// Session detail routes and a site's own page host the preview;
// on every other route the last previewed site stays mounted
// but hidden.
function getRouteSessionId( pathname: string ): string | undefined {
	const match = /^\/sessions\/([^/]+)\/?$/.exec( pathname );
	return match ? decodeURIComponent( match[ 1 ] ) : undefined;
}

function getRouteHomeSiteId( pathname: string ): string | undefined {
	const match = /^\/sites\/([^/]+)\/?$/.exec( pathname );
	return match ? decodeURIComponent( match[ 1 ] ) : undefined;
}

function getNewSessionSiteId( pathname: string ): string | undefined {
	const match = /^\/sites\/([^/]+)\/new\/?$/.exec( pathname );
	return match ? decodeURIComponent( match[ 1 ] ) : undefined;
}

// Hosts the site preview at the dashboard level so the webview stays mounted
// (and warm) while navigating between sessions, sites, and other routes. The
// previewed site follows the current session; routes without one keep the
// last previewed site loaded behind a closed panel.
function DashboardLayout() {
	const navigate = useNavigate();
	const connector = useConnector();
	const openSettings = useOpenSettings();
	const narrow = useMediaQuery( '(max-width: 540px)' );
	const windowControls = useWindowControlsOverlay();
	const { data: authUser } = useAuthUser();
	const { data: aiSettings } = useAiSettings();
	const [ providerPromptOpen, setProviderPromptOpen ] = useState( false );
	const hasProvider = !! authUser || !! aiSettings?.hasAnthropicApiKey;
	useEffect( () => {
		if ( hasProvider ) setProviderPromptOpen( false );
	}, [ hasProvider ] );
	const routePreviewContext = useRouterState( {
		select: ( state ) => ( {
			pathname: state.location.pathname,
			sessionId: getRouteSessionId( state.location.pathname ),
			homeSiteId: getRouteHomeSiteId( state.location.pathname ),
			newSessionSiteId: getNewSessionSiteId( state.location.pathname ),
		} ),
	} );
	const { sessionId, homeSiteId, newSessionSiteId } = routePreviewContext;
	const { data: sites } = useSites();
	const { data: sessionData } = useSession( sessionId );
	const { data: sessions } = useSessions();
	const sessionSummary =
		sessionData?.summary ?? sessions?.find( ( session ) => session.id === sessionId );
	// Open the orientation guide on first workbench arrival, and let Help ▸
	// Getting Started replay it.
	useOrientationAutostart();
	useOrientationReplay();
	// Same, for the per-release announcements behind Help ▸ What's New.
	useWhatsNewAutostart();
	useWhatsNewReplay();
	const preview = useSessionPreviewUI();
	const { data: preferences } = useUserPreferences();
	const sessionSite = findAiSessionOwnerSite( sites, sessionSummary );
	// A chat switched to Live previews its remote instead of the local site.
	const { draft } = useSiteChatDraft( newSessionSiteId );
	const liveUrl = useSessionLiveSite(
		newSessionSiteId ? draft : sessionSummary,
		newSessionSiteId ?? sessionSite?.id
	)?.url.replace( /\/+$/, '' );
	const homeSite = homeSiteId ? sites?.find( ( site ) => site.id === homeSiteId ) : undefined;
	const newSessionSite = newSessionSiteId
		? sites?.find( ( site ) => site.id === newSessionSiteId )
		: undefined;
	const routeSite = homeSite ?? newSessionSite ?? sessionSite;
	// While session or site data is still loading, preview-capable routes stay
	// preview-capable so navigation doesn't close and reopen the panel around
	// the fetch.
	const supportsPreview =
		homeSiteId !== undefined ||
		newSessionSiteId !== undefined ||
		( sessionId !== undefined && ( sessionData === undefined || !! routeSite ) );
	// Remember the last previewed site by id (looked up fresh each render so
	// `running` and friends don't go stale) to keep its webview warm across
	// routes and to bridge the gap while the next route's site resolves.
	const [ lastPreviewSiteId, setLastPreviewSiteId ] = useState< string | undefined >();
	useEffect( () => {
		if ( routeSite ) {
			setLastPreviewSiteId( routeSite.id );
		}
	}, [ routeSite ] );
	// Remember the user's site and its open chat, so the `/` index route and
	// the sidebar return here instead of defaulting to the first site.
	const sessionSiteId = sessionSite?.id;
	useEffect( () => {
		if ( sessionSiteId ) {
			rememberVisit( sessionSiteId, sessionId );
		} else if ( newSessionSiteId ?? homeSiteId ) {
			rememberVisit( ( newSessionSiteId ?? homeSiteId )!, newSessionSiteId ? null : undefined );
		}
	}, [ sessionSiteId, sessionId, newSessionSiteId, homeSiteId ] );
	const lastPreviewSite = lastPreviewSiteId
		? sites?.find( ( site ) => site.id === lastPreviewSiteId )
		: undefined;
	const previewSite = routeSite ?? lastPreviewSite;
	const previewSiteId = previewSite?.id;
	const annotations = useSiteAnnotations( previewSiteId );
	const { setSite: setPreviewSite } = preview;
	useLayoutEffect( () => {
		if ( previewSiteId ) {
			setPreviewSite( previewSiteId, { running: !! previewSite?.running || !! liveUrl } );
		}
	}, [ previewSiteId, previewSite?.running, liveUrl, preview.siteId, setPreviewSite ] );
	// Look up by the route's site so the path is right even before the
	// `setPreviewSite` effect lands.
	const previewPath = pathForSite( preview.pathsBySiteId, previewSiteId );

	// The remote's own path, so neither preview takes the other's page.
	const [ livePath, setLivePath ] = useState( { url: liveUrl, path: '/' } );
	const updateLivePath = useCallback(
		( path: string ) => setLivePath( { url: liveUrl, path } ),
		[ liveUrl ]
	);
	// A site's own page always shows its preview.
	const startPending = useIsSiteStarting( previewSite?.id );
	const stopPending = useIsSiteStopping( previewSite?.id );
	const previewOperation = useSiteOperation( previewSite );
	const restartStates = useSiteRestartStates();
	const queryClient = useQueryClient();
	const restarting = !! previewSiteId && isSiteRestarting( queryClient, previewSiteId );
	const previewStarting = restarting || startPending || previewOperation === 'start';
	const previewStopping = ! restarting && ( stopPending || previewOperation === 'stop' );
	const { setOpen, setChatHidden } = preview;
	const localPreviewStopping = previewStopping && ! liveUrl;
	const siteActive =
		! localPreviewStopping && ( !! liveUrl || !! previewSite?.running || previewStarting );
	const previewLoading =
		! liveUrl && ( previewStarting || preview.revealingSiteId === previewSiteId );
	const [ visiblePanel, setVisiblePanel ] = useState< {
		siteId: string | undefined;
		open: boolean;
	} >( {
		siteId: undefined,
		open: false,
	} );
	const keepPanelVisible = visiblePanel.siteId === previewSiteId && visiblePanel.open;
	const showPanel =
		( ! previewLoading || keepPanelVisible ) &&
		supportsPreview &&
		!! previewSite &&
		( !! homeSiteId ||
			( preview.siteId === previewSiteId
				? preview.open
				: preview.openBySiteId[ previewSiteId ?? '' ] ?? siteActive ) );
	if ( visiblePanel.siteId !== previewSiteId || visiblePanel.open !== showPanel ) {
		setVisiblePanel( { siteId: previewSiteId, open: showPanel } );
	}

	const chatHidden =
		showPanel &&
		( narrow || !! homeSiteId || !! preview.chatHiddenBySiteId[ previewSiteId ?? '' ] );
	const panelVisible = showPanel;
	const runLayoutTransition = useWorkspaceLayoutTracks( {
		layout: ! panelVisible ? 'chat' : chatHidden ? 'panel' : 'split',
		siteId: routeSite?.id,
		narrow,
	} );
	const panelExpanded = showPanel && ( ! narrow || chatHidden );
	const showFullView =
		showPanel && ( chatHidden || !! liveUrl || !! previewSite?.running || previewStarting );
	const [ tabHeader, setTabHeader ] = useState< HTMLDivElement | null >( null );
	useLayoutEffect( () => {
		if ( ! tabHeader ) return;
		const lead = tabHeader.querySelector< HTMLElement >( '[data-site-header-reserved]' );
		const actions = tabHeader.querySelector< HTMLElement >( '[data-site-header-actions]' );
		if ( ! lead || ! actions ) return;
		const measure = () => {
			const box = tabHeader.getBoundingClientRect();
			const title = lead.getBoundingClientRect();
			const buttons = actions.getBoundingClientRect();
			const gap =
				Number.parseFloat( getComputedStyle( tabHeader ).getPropertyValue( '--band-gap' ) ) || 0;
			tabHeader.style.setProperty(
				'--tabs-lead-width',
				`${ ( isRTL() ? box.right - title.left : title.right - box.left ) + gap }px`
			);
			tabHeader.style.setProperty( '--tabs-actions-width', `${ buttons.width + gap }px` );
		};
		const observer = new ResizeObserver( measure );
		observer.observe( lead );
		observer.observe( actions );
		observer.observe( tabHeader );
		measure();
		return () => observer.disconnect();
	}, [ tabHeader, chatHidden, showPanel ] );

	const previousSites = useRef(
		new Map<
			string,
			{ running: boolean; starting: boolean; restarting: boolean; restartId?: number }
		>()
	);
	useLayoutEffect( () => {
		const updateSiteLayout = ( siteId: string, update: () => void ) => {
			if ( siteId === previewSiteId ) runLayoutTransition( update );
			else update();
		};
		for ( const site of sites ?? [] ) {
			const previous = previousSites.current.get( site.id );
			const starting =
				site.operation?.kind === 'start' || ( site.id === previewSiteId && startPending );
			const restarting = isSiteRestarting( queryClient, site.id );
			const restartId = getSiteRestartId( queryClient, site.id );
			previousSites.current.set( site.id, {
				running: !! site.running,
				starting,
				restarting,
				restartId,
			} );
			// A fast restart can finish before React observes its pending state.
			if (
				restarting ||
				previous?.restarting ||
				( restartId !== undefined && restartId !== previous?.restartId )
			)
				continue;
			if (
				( starting && ! previous?.starting ) ||
				( previous?.running === false && site.running && ! previous.starting )
			) {
				updateSiteLayout( site.id, () => {
					setChatHidden(
						! getSiteAnnotations( site.id ).active &&
							! ( preferences?.openChatOnSiteStart ?? true ),
						site.id
					);
					setOpen( true, { siteId: site.id } );
				} );
			} else if (
				previous?.running &&
				! site.running &&
				! ( site.id === previewSiteId && liveUrl )
			) {
				updateSiteLayout( site.id, () => setOpen( false, { siteId: site.id } ) );
			}
		}
	}, [
		sites,
		previewSiteId,
		liveUrl,
		startPending,
		restartStates,
		queryClient,
		preferences?.openChatOnSiteStart,
		setChatHidden,
		setOpen,
		runLayoutTransition,
	] );
	const setPanelOpen = useCallback(
		( open: boolean, options?: { instant?: boolean; userInitiated?: boolean } ) => {
			runLayoutTransition(
				() => {
					setOpen( open, { siteId: previewSiteId, instant: options?.instant } );
					if ( homeSiteId )
						return navigate( { to: '/sites/$siteId/new', params: { siteId: homeSiteId } } );
				},
				options?.userInitiated
			);
		},
		[ setOpen, previewSiteId, homeSiteId, navigate, runLayoutTransition ]
	);
	const previousSite = useRef< {
		id: string;
		active: boolean;
		restarting: boolean;
		restartId?: number;
	} | null >( null );
	useEffect( () => {
		if ( ! previewSiteId ) return;
		const previous = previousSite.current;
		const restartId = getSiteRestartId( queryClient, previewSiteId );
		previousSite.current = { id: previewSiteId, active: siteActive, restarting, restartId };
		if (
			homeSiteId &&
			previous?.id === previewSiteId &&
			previous.active &&
			! siteActive &&
			! previous.restarting &&
			! restarting &&
			previous.restartId === restartId
		) {
			void navigate( { to: '/sites/$siteId/new', params: { siteId: homeSiteId } } );
		}
	}, [ homeSiteId, previewSiteId, siteActive, navigate, restarting, restartStates, queryClient ] );
	const setPanelFullscreen = useCallback(
		( fullscreen: boolean, options?: { instant?: boolean; userInitiated?: boolean } ) => {
			runLayoutTransition(
				() => {
					setOpen( true, { instant: options?.instant } );
					setChatHidden( fullscreen, previewSiteId, { instant: options?.instant } );
					if ( homeSiteId ) {
						return navigate( { to: '/sites/$siteId/new', params: { siteId: homeSiteId } } );
					}
				},
				options?.userInitiated
			);
		},
		[ setOpen, setChatHidden, previewSiteId, homeSiteId, navigate, runLayoutTransition ]
	);
	useEffect(
		() =>
			connector.onTogglePanel( () => {
				if ( supportsPreview && routeSite ) setPanelOpen( ! panelVisible, { userInitiated: true } );
			} ),
		[ connector, supportsPreview, routeSite, setPanelOpen, panelVisible ]
	);

	useEffect(
		() =>
			connector.onSetWorkspaceLayout?.( ( layout ) => {
				if ( ! supportsPreview || ! routeSite || isDialogOpen() ) return;
				if ( layout === 'chat' ) setPanelOpen( false, { userInitiated: true } );
				else setPanelFullscreen( layout === 'panel', { instant: true, userInitiated: true } );
			} ),
		[ connector, supportsPreview, routeSite, setPanelOpen, setPanelFullscreen ]
	);

	useEffect( () => {
		if ( annotations.active ) setPanelFullscreen( false );
	}, [ annotations.active, setPanelFullscreen ] );

	const startAnnotating = useCallback( () => {
		if ( hasProvider ) {
			setPanelFullscreen( false );
			return true;
		}
		setProviderPromptOpen( true );
		return false;
	}, [ hasProvider, setPanelFullscreen ] );
	// The notes go to the chat beside the preview, or to a new one for the site.
	const sendAnnotations = useCallback(
		( siteId: string, noteIds?: string[] ) => {
			if ( ! hasProvider ) {
				setProviderPromptOpen( true );
				return;
			}
			requestAnnotationSend( { siteId, noteIds } );
			setChatHidden( false, siteId );
			if ( ! sessionId || sessionSite?.id !== siteId ) {
				void navigate( { to: '/sites/$siteId/new', params: { siteId } } );
			}
		},
		[ hasProvider, navigate, sessionId, sessionSite?.id, setChatHidden ]
	);

	const attachScreenshot = ( siteId: string, file: File ) => {
		const pending = pendingComposerFilesSlot.getSnapshot();
		pendingComposerFilesSlot.set( {
			siteId,
			files: [ ...( pending?.siteId === siteId ? pending.files : [] ), file ],
		} );
		setChatHidden( false, siteId );
		if ( ! sessionId || sessionSite?.id !== siteId ) {
			void navigate( { to: '/sites/$siteId/new', params: { siteId } } );
		}
	};

	const renderPanel = ( { collapsed }: PanelSplitFramePanelProps ) =>
		previewSite ? (
			<SitePreview
				key={ liveUrl ?? 'local' }
				site={ previewSite }
				liveUrl={ liveUrl }
				path={ liveUrl ? ( livePath.url === liveUrl ? livePath.path : '/' ) : previewPath }
				reloadNonce={ preview.reloadNonce }
				onSendAnnotations={ sendAnnotations }
				onStartAnnotating={ startAnnotating }
				onAttachScreenshot={ attachScreenshot }
				onPathChange={ liveUrl ? updateLivePath : preview.updatePath }
				collapsed={ collapsed || ! panelExpanded }
			/>
		) : null;

	const workspaceSiteId = newSessionSiteId ?? sessionSite?.id;
	const workspace =
		( sessionId || newSessionSiteId ) && workspaceSiteId ? (
			<SiteWorkspace
				key={ workspaceSiteId }
				sessionId={ sessionId }
				siteId={ workspaceSiteId }
				hideHeader
				panelVisible={ panelExpanded }
			/>
		) : (
			<Outlet />
		);

	const content = (
		<SidebarLayout>
			<AccountPromptDialog
				open={ providerPromptOpen }
				onOpenChange={ setProviderPromptOpen }
				illustration="annotations"
				title={ __( 'Put your feedback to work' ) }
				description={ __(
					'Connect an AI provider to turn your notes and ideas into changes to your site.'
				) }
				source="assistant_tab"
				analytics={ { placement: 'annotation', intent: 'annotate' } }
				scope={ routeSite?.id }
				secondaryLabel={ __( 'Choose a different provider' ) }
				onSkip={ () => {
					setProviderPromptOpen( false );
					openSettings( 'ai', undefined, undefined, { intent: 'annotate', scope: routeSite?.id } );
				} }
			/>
			<SiteHeaderActionsProvider host={ panelExpanded ? 'panel' : 'chat' }>
				<PanelSplitFrame
					siteId={ previewSiteId }
					navigationKey={
						homeSiteId || newSessionSiteId
							? `/sites/${ homeSiteId ?? newSessionSiteId }`
							: routePreviewContext.pathname
					}
					panelOpen={ showPanel }
					chatHidden={ chatHidden }
					instant={ ( ! previewStopping || ! preview.open ) && preview.instant }
					panel={ renderPanel }
					header={
						supportsPreview && routeSite ? (
							<WindowControlsCornerContext.Provider value={ ! showPanel }>
								<div
									ref={ setTabHeader }
									className={ styles.header }
									data-panel-open={ showPanel || undefined }
									data-full-view-control={ showFullView || undefined }
									data-panel-fullscreen={ ( showPanel && chatHidden ) || undefined }
								>
									<div className={ styles.chatHeader }>
										<SessionHeader
											start={ <HeaderSidebarToggle /> }
											site={ routeSite }
											reserveSiteActions={ ! showPanel || chatHidden }
										/>
									</div>
									<SiteHeaderActions site={ routeSite } />
									<div
										className={ styles.previewTabs }
										aria-hidden={ ! showPanel || undefined }
										inert={ ! showPanel }
									>
										<PreviewTabs site={ routeSite } liveUrl={ liveUrl } path={ previewPath } />
									</div>
									<div
										className={ styles.layoutControls }
										style={ {
											right: `calc(var(--band-inset) + ${ windowControls?.controlsWidth ?? 0 }px)`,
										} }
									>
										<PanelLayoutControls
											showFullView={ showFullView }
											open={ panelVisible }
											onOpenChange={ ( open ) => setPanelOpen( open, { userInitiated: true } ) }
											fullscreen={ chatHidden }
											onFullscreenChange={ ( fullscreen ) =>
												setPanelFullscreen( fullscreen, { instant: true, userInitiated: true } )
											}
										/>
									</div>
								</div>
							</WindowControlsCornerContext.Provider>
						) : null
					}
				>
					{ workspace }
				</PanelSplitFrame>
			</SiteHeaderActionsProvider>
			<CommandPalette
				site={ homeSite ?? newSessionSite ?? sessionSite }
				session={ sessionData?.summary }
				panelShown={ panelVisible }
			/>
		</SidebarLayout>
	);
	return (
		<PanelCommandContext.Provider
			value={ {
				siteId: routeSite?.id,
				toggle: () => {
					if ( panelVisible ) setPanelOpen( false, { instant: true, userInitiated: true } );
					else setPanelFullscreen( false, { instant: true, userInitiated: true } );
				},
			} }
		>
			<WorkspaceLayoutTracksContext.Provider
				value={ { siteId: routeSite?.id, run: runLayoutTransition } }
			>
				{ content }
			</WorkspaceLayoutTracksContext.Provider>
		</PanelCommandContext.Provider>
	);
}

export const dashboardLayoutRoute = createRoute( {
	getParentRoute: () => rootRoute,
	id: 'dashboard-layout',
	component: DashboardLayout,
} );
