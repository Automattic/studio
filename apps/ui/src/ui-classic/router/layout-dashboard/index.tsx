import { findAiSessionOwnerSite } from '@studio/common/ai/sessions/owner-site';
import { TRACKS_EVENTS } from '@studio/common/lib/record-tracks-event';
import { createRoute, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { useCallback, useEffect, useState } from 'react';
import {
	PreviewSplitFrame,
	type PreviewSplitFramePreviewProps,
} from '@/components/preview-split-frame';
import { SidebarLayout } from '@/components/sidebar-layout';
import { SitePreview } from '@/components/site-preview';
import { isSiteSettingsTab, siteSettingsTabToPanel } from '@/components/site-settings-view';
import { useConnector } from '@/data/core';
import { useOrientationAutostart } from '@/data/onboarding/use-orientation-autostart';
import { useOrientationReplay } from '@/data/onboarding/use-orientation-replay';
import { useWhatsNewAutostart } from '@/data/onboarding/use-whats-new-autostart';
import { useWhatsNewReplay } from '@/data/onboarding/use-whats-new-replay';
import { useAgenticFeatures } from '@/data/queries/use-agentic-features';
import { useSession, useSessionEffectiveEnvironment } from '@/data/queries/use-sessions';
import { useSites } from '@/data/queries/use-sites';
import {
	pathForSite,
	SessionUIProvider,
	useSessionPreviewAnnotationsHandler,
	useSessionPreviewUI,
} from '@/hooks/use-session-ui';
import { writeLastVisited } from '@/lib/last-visited';
import { SiteWorkspace } from '@/ui-classic/components/site-workspace';
import { rootRoute } from '../layout-root';
import type { SiteSettingsTabId } from '@/components/site-settings-view';

// Session detail routes and the site overview host the preview; on every
// other route (settings, site settings…) the last previewed site stays
// mounted but hidden.
function getRouteSessionId( pathname: string ): string | undefined {
	const match = /^\/sessions\/([^/]+)\/?$/.exec( pathname );
	return match ? decodeURIComponent( match[ 1 ] ) : undefined;
}

function getRouteOverviewSiteId( pathname: string ): string | undefined {
	const match = /^\/sites\/([^/]+)\/overview\/?$/.exec( pathname );
	return match ? decodeURIComponent( match[ 1 ] ) : undefined;
}

function getNewSessionSiteId( pathname: string ): string | undefined {
	const match = /^\/sites\/([^/]+)\/new\/?$/.exec( pathname );
	return match ? decodeURIComponent( match[ 1 ] ) : undefined;
}

function DashboardLayout() {
	return (
		<SessionUIProvider>
			<DashboardLayoutContent />
		</SessionUIProvider>
	);
}

// Hosts the site preview at the dashboard level so the webview stays mounted
// (and warm) while navigating between sessions, sites, and other routes. The
// previewed site follows the current session; routes without one keep the
// last previewed site loaded behind a closed panel.
function DashboardLayoutContent() {
	const navigate = useNavigate();
	const connector = useConnector();
	const routePreviewContext = useRouterState( {
		select: ( state ) => ( {
			sessionId: getRouteSessionId( state.location.pathname ),
			overviewSiteId: getRouteOverviewSiteId( state.location.pathname ),
			newSessionSiteId: getNewSessionSiteId( state.location.pathname ),
			overviewTab:
				typeof state.location.search.tab === 'string' &&
				isSiteSettingsTab( state.location.search.tab )
					? state.location.search.tab
					: undefined,
			openPullOnLoad: state.location.search.sync === 'pull',
		} ),
	} );
	const { sessionId, overviewSiteId, newSessionSiteId, overviewTab, openPullOnLoad } =
		routePreviewContext;
	const [ overviewTabsBySite, setOverviewTabsBySite ] = useState<
		Record< string, SiteSettingsTabId >
	>( {} );
	useEffect( () => {
		if ( overviewSiteId && overviewTab ) {
			setOverviewTabsBySite( ( current ) =>
				current[ overviewSiteId ] === overviewTab
					? current
					: { ...current, [ overviewSiteId ]: overviewTab }
			);
		}
	}, [ overviewSiteId, overviewTab ] );
	const { isReady: agenticFeaturesReady, chatEnabled } = useAgenticFeatures();
	const { data: sites } = useSites();
	const { data: sessionData } = useSession( sessionId );
	// Open the orientation guide on first workbench arrival, and let Help ▸
	// Getting Started replay it.
	useOrientationAutostart();
	useOrientationReplay();
	// Same, for the per-release announcements behind Help ▸ What's New.
	useWhatsNewAutostart();
	useWhatsNewReplay();
	useEffect( () => {
		if ( sessionId && agenticFeaturesReady && ! chatEnabled ) {
			void navigate( { to: '/' } );
		}
	}, [ agenticFeaturesReady, chatEnabled, navigate, sessionId ] );
	const preview = useSessionPreviewUI();
	const onAnnotationsDone = useSessionPreviewAnnotationsHandler();
	const sessionSite = findAiSessionOwnerSite( sites, sessionData?.summary );
	const effectiveEnvironment = useSessionEffectiveEnvironment(
		sessionData?.summary,
		sessionSite?.id
	);
	const overviewSite = overviewSiteId
		? sites?.find( ( site ) => site.id === overviewSiteId )
		: undefined;
	const newSessionSite = newSessionSiteId
		? sites?.find( ( site ) => site.id === newSessionSiteId )
		: undefined;
	const routeSite =
		overviewSite ??
		newSessionSite ??
		( effectiveEnvironment === 'local' ? sessionSite : undefined );
	// While session or site data is still loading, preview-capable routes stay
	// preview-capable so navigation doesn't close and reopen the panel around
	// the fetch.
	const supportsPreview =
		overviewSiteId !== undefined ||
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
	// Remember the user's site so the `/` index route can return here
	// instead of defaulting to the first site.
	const sessionSiteId = sessionSite?.id;
	useEffect( () => {
		const siteId = sessionSiteId ?? newSessionSiteId;
		if ( siteId ) {
			writeLastVisited( { siteId } );
		}
	}, [ sessionSiteId, newSessionSiteId ] );
	const lastPreviewSite = lastPreviewSiteId
		? sites?.find( ( site ) => site.id === lastPreviewSiteId )
		: undefined;
	const previewSite = routeSite ?? lastPreviewSite;
	const previewSiteId = previewSite?.id;
	const { setSite: setPreviewSite } = preview;
	useEffect( () => {
		if ( previewSiteId ) {
			setPreviewSite( previewSiteId );
		}
	}, [ previewSiteId, setPreviewSite ] );
	// Look up by the route's site so the path is right even before the
	// `setPreviewSite` effect lands.
	const previewPath = pathForSite( preview.pathsBySiteId, previewSiteId );
	const showPreview = preview.open && supportsPreview && !! previewSite;
	const previewFullscreen = preview.fullscreen && showPreview;
	// Leave full preview when the route stops supporting a preview (settings,
	// site settings…) so the user is never left staring at a hidden layout.
	const { setFullscreen: setPreviewFullscreen } = preview;
	useEffect( () => {
		if ( ! supportsPreview ) {
			setPreviewFullscreen( false );
		}
	}, [ supportsPreview, setPreviewFullscreen ] );
	const exitPreviewFullscreen = useCallback(
		() => setPreviewFullscreen( false ),
		[ setPreviewFullscreen ]
	);
	const renderPreview = useCallback(
		( { collapsed }: PreviewSplitFramePreviewProps ) =>
			previewSite ? (
				<SitePreview
					site={ previewSite }
					path={ previewPath }
					reloadNonce={ preview.reloadNonce }
					onAnnotationsDone={ onAnnotationsDone }
					onPathChange={ preview.updatePath }
					collapsed={ collapsed }
					fullscreen={ previewFullscreen }
					onFullscreenChange={ setPreviewFullscreen }
				/>
			) : null,
		[
			onAnnotationsDone,
			previewFullscreen,
			previewPath,
			preview.reloadNonce,
			preview.updatePath,
			previewSite,
			setPreviewFullscreen,
		]
	);
	const activeWorkspaceView = sessionId ? 'chat' : overviewSiteId ? 'overview' : undefined;
	const routeWorkspaceSiteId = overviewSiteId ?? sessionSite?.id;
	const [ retainedWorkspaceSiteId, setRetainedWorkspaceSiteId ] = useState( routeWorkspaceSiteId );
	if ( routeWorkspaceSiteId && routeWorkspaceSiteId !== retainedWorkspaceSiteId ) {
		setRetainedWorkspaceSiteId( routeWorkspaceSiteId );
	}
	const workspaceSiteId =
		routeWorkspaceSiteId ?? ( activeWorkspaceView ? retainedWorkspaceSiteId : undefined );
	const activeOverviewTab =
		overviewTab ??
		( workspaceSiteId ? overviewTabsBySite[ workspaceSiteId ] : undefined ) ??
		'overview';
	const workspace =
		activeWorkspaceView && workspaceSiteId ? (
			<SiteWorkspace
				key={ workspaceSiteId }
				siteId={ workspaceSiteId }
				activeView={ activeWorkspaceView }
				sessionId={ sessionId }
				overviewTab={ activeOverviewTab }
				openPullOnLoad={ openPullOnLoad }
				onOverviewTabChange={ ( next ) => {
					setOverviewTabsBySite( ( current ) => ( {
						...current,
						[ workspaceSiteId ]: next,
					} ) );
					void connector.trackEvent( TRACKS_EVENTS.PANEL_OPENED, {
						panel: siteSettingsTabToPanel( next ),
					} );
					void navigate( {
						to: '/sites/$siteId/overview',
						params: { siteId: workspaceSiteId },
						search: { tab: next },
						replace: true,
					} );
				} }
			/>
		) : (
			<Outlet />
		);

	return (
		<SidebarLayout
			forceCollapsed={ previewFullscreen }
			onForceCollapsedToggle={ exitPreviewFullscreen }
		>
			<PreviewSplitFrame
				previewOpen={ showPreview }
				previewFullscreen={ previewFullscreen }
				preview={ renderPreview }
			>
				{ workspace }
			</PreviewSplitFrame>
		</SidebarLayout>
	);
}

export const dashboardLayoutRoute = createRoute( {
	getParentRoute: () => rootRoute,
	id: 'dashboard-layout',
	component: DashboardLayout,
} );
