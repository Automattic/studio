import { findAiSessionOwnerSite } from '@studio/agent/protocol/sessions/owner-site';
import { createRoute, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useConnector } from '@/data/core';
import { WindowControlsCornerContext } from '@/data/host/use-window-controls-inset';
import { useAiSettings } from '@/data/queries/use-ai-settings';
import { useAuthUser } from '@/data/queries/use-auth-user';
import { useSession, useSessionLiveSite } from '@/data/queries/use-sessions';
import { useSiteChatDraft } from '@/data/queries/use-site-chat-draft';
import {
	useIsSiteStarting,
	useIsSiteStopping,
	useSiteOperation,
	useSites,
} from '@/data/queries/use-sites';
import { useOpenSettings } from '@/data/use-open-settings';
import { pathForSite, useSessionPreviewUI } from '@/data/use-session-ui';
import { AccountPromptDialog } from '@/features/account';
import { requestAnnotationSend } from '@/features/annotations';
import { SiteWorkspace, SessionHeader } from '@/features/chats';
import { CommandPalette } from '@/features/commands';
import {
	useOrientationAutostart,
	useOrientationReplay,
	useWhatsNewAutostart,
	useWhatsNewReplay,
} from '@/features/onboarding';
import { SidebarLayout, HeaderSidebarToggle, rememberVisit } from '@/features/sidebar';
import { PreviewSplitFrame, type PreviewSplitFramePreviewProps } from '@/features/sites';
import {
	SiteHeaderActions,
	SiteHeaderActionsProvider,
	SitePreview,
	useHeaderPrototype,
	HeaderPrototypePicker,
	PrototypePreviewControls,
} from '@/features/sites';
import { useMediaQuery } from '@/lib/hooks';
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
	// Open the orientation guide on first workbench arrival, and let Help ▸
	// Getting Started replay it.
	useOrientationAutostart();
	useOrientationReplay();
	// Same, for the per-release announcements behind Help ▸ What's New.
	useWhatsNewAutostart();
	useWhatsNewReplay();
	const preview = useSessionPreviewUI();
	const headerPrototype = useHeaderPrototype();
	const sessionSite = findAiSessionOwnerSite( sites, sessionData?.summary );
	// A chat switched to Live previews its remote instead of the local site.
	const { draft } = useSiteChatDraft( newSessionSiteId );
	const liveUrl = useSessionLiveSite(
		newSessionSiteId ? draft : sessionData?.summary,
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
	const { setSite: setPreviewSite } = preview;
	useLayoutEffect( () => {
		if ( previewSiteId ) {
			setPreviewSite( previewSiteId );
		}
	}, [ previewSiteId, setPreviewSite ] );
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
	const previewStarting = startPending || previewOperation === 'start';
	const previewStopping = stopPending || previewOperation === 'stop';
	const { setOpen, setChatHidden } = preview;
	const [ emptyPreviewSiteId, setEmptyPreviewSiteId ] = useState< string | null >( null );
	const prototypeStopping = headerPrototype && previewStopping;
	const siteActive =
		! prototypeStopping && ( !! liveUrl || !! previewSite?.running || previewStarting );
	useEffect( () => {
		setEmptyPreviewSiteId( null );
	}, [ previewSiteId, siteActive ] );
	const showPreview =
		! prototypeStopping &&
		supportsPreview &&
		!! previewSite &&
		( siteActive || !! homeSiteId || emptyPreviewSiteId === previewSiteId );
	const chatHidden =
		showPreview &&
		( ! siteActive || !! homeSiteId || !! preview.chatHiddenBySiteId[ previewSiteId ?? '' ] );
	const previewExpanded = showPreview && ( ! narrow || chatHidden );
	const previousSite = useRef< { id: string; active: boolean } | null >( null );
	const [ previewLifecycle, setPreviewLifecycle ] = useState( {
		siteId: previewSiteId,
		active: siteActive,
		instantStop: false,
	} );
	if ( previewLifecycle.siteId !== previewSiteId || previewLifecycle.active !== siteActive ) {
		setPreviewLifecycle( {
			siteId: previewSiteId,
			active: siteActive,
			instantStop:
				previewLifecycle.siteId === previewSiteId && previewLifecycle.active && ! siteActive,
		} );
	}
	useEffect( () => {
		if ( ! previewSiteId ) return;
		const previous = previousSite.current;
		previousSite.current = { id: previewSiteId, active: siteActive };
		if ( homeSiteId && previous?.id === previewSiteId && previous.active && ! siteActive ) {
			void navigate( { to: '/sites/$siteId/new', params: { siteId: homeSiteId } } );
		}
	}, [ homeSiteId, previewSiteId, siteActive, navigate ] );
	const setPreviewFullscreen = useCallback(
		( fullscreen: boolean ) => {
			setPreviewLifecycle( ( previous ) => ( { ...previous, instantStop: false } ) );
			setOpen( true );
			if ( siteActive ) setChatHidden( fullscreen, previewSiteId );
			else setEmptyPreviewSiteId( fullscreen ? previewSiteId ?? null : null );
			if ( homeSiteId ) {
				void navigate( { to: '/sites/$siteId/new', params: { siteId: homeSiteId } } );
			}
		},
		[ setOpen, siteActive, setChatHidden, previewSiteId, homeSiteId, navigate ]
	);
	useEffect(
		() =>
			connector.onToggleSitePreview( () => {
				if ( supportsPreview && routeSite ) setPreviewFullscreen( ! chatHidden );
			} ),
		[ connector, supportsPreview, routeSite, setPreviewFullscreen, chatHidden ]
	);

	const startAnnotating = useCallback( () => {
		if ( hasProvider ) return true;
		setProviderPromptOpen( true );
		return false;
	}, [ hasProvider ] );
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

	const renderPreview = ( { collapsed }: PreviewSplitFramePreviewProps ) =>
		previewSite ? (
			<SitePreview
				key={ liveUrl ?? 'local' }
				site={ previewSite }
				liveUrl={ liveUrl }
				path={ liveUrl ? ( livePath.url === liveUrl ? livePath.path : '/' ) : previewPath }
				reloadNonce={ preview.reloadNonce }
				onSendAnnotations={ sendAnnotations }
				onStartAnnotating={ startAnnotating }
				onPathChange={ liveUrl ? updateLivePath : preview.updatePath }
				collapsed={ collapsed || ! previewExpanded }
				fullscreen={ { active: chatHidden, onClick: () => setPreviewFullscreen( ! chatHidden ) } }
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
				previewVisible={ previewExpanded }
			/>
		) : (
			<Outlet />
		);

	return (
		<SidebarLayout>
			<AccountPromptDialog
				open={ providerPromptOpen }
				onOpenChange={ setProviderPromptOpen }
				title={ __( 'Put your feedback to work' ) }
				description={ __(
					'Connect an AI provider to turn your notes and ideas into changes to your site.'
				) }
				source="assistant_tab"
				secondaryLabel={ __( 'Choose a different provider' ) }
				onSkip={ () => {
					setProviderPromptOpen( false );
					openSettings( 'ai' );
				} }
			/>
			<SiteHeaderActionsProvider host={ previewExpanded ? 'preview' : 'chat' }>
				<PreviewSplitFrame
					siteId={ previewSiteId }
					navigationKey={
						homeSiteId || newSessionSiteId
							? `/sites/${ homeSiteId ?? newSessionSiteId }`
							: routePreviewContext.pathname
					}
					previewOpen={ showPreview }
					previewLoading={ preview.revealingSiteId === previewSiteId }
					chatHidden={ chatHidden }
					instant={
						headerPrototype
							? false
							: preview.instant ||
							  previewStarting ||
							  previewStopping ||
							  previewLifecycle.instantStop
					}
					preview={ renderPreview }
					header={
						supportsPreview && routeSite ? (
							<WindowControlsCornerContext.Provider value={ true }>
								<div className={ styles.header }>
									<SessionHeader
										start={ <HeaderSidebarToggle /> }
										site={ routeSite }
										effectiveEnvironment={ liveUrl ? 'live' : 'local' }
									/>
									<SiteHeaderActions
										site={ routeSite }
										live={ !! liveUrl }
										onStartAnnotating={ startAnnotating }
										onSendAnnotations={ sendAnnotations }
										end={
											headerPrototype ? (
												<PrototypePreviewControls
													site={ routeSite }
													live={ !! liveUrl }
													fullscreen={ { active: chatHidden, onChange: setPreviewFullscreen } }
												/>
											) : undefined
										}
									/>
								</div>
							</WindowControlsCornerContext.Provider>
						) : null
					}
				>
					{ workspace }
				</PreviewSplitFrame>
			</SiteHeaderActionsProvider>
			<HeaderPrototypePicker />
			<CommandPalette
				site={ homeSite ?? newSessionSite ?? sessionSite }
				session={ sessionData?.summary }
				chatHidden={ chatHidden }
				previewFullscreen={ { active: chatHidden, onChange: setPreviewFullscreen } }
			/>
		</SidebarLayout>
	);
}

export const dashboardLayoutRoute = createRoute( {
	getParentRoute: () => rootRoute,
	id: 'dashboard-layout',
	component: DashboardLayout,
} );
