import { findAiSessionOwnerSite } from '@studio/common/ai/sessions/owner-site';
import { createRoute, Outlet, useRouterState } from '@tanstack/react-router';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
	PreviewSplitFrame,
	type PreviewSplitFramePreviewProps,
} from '@/components/preview-split-frame';
import { SidebarLayout } from '@/components/sidebar-layout';
import { SitePreview } from '@/components/site-preview';
import { useConnector } from '@/data/core';
import { useOrientationAutostart } from '@/data/onboarding/use-orientation-autostart';
import { useOrientationReplay } from '@/data/onboarding/use-orientation-replay';
import { useWhatsNewAutostart } from '@/data/onboarding/use-whats-new-autostart';
import { useWhatsNewReplay } from '@/data/onboarding/use-whats-new-replay';
import { useSession, useSessionEffectiveEnvironment } from '@/data/queries/use-sessions';
import { useSites } from '@/data/queries/use-sites';
import {
	pathForSite,
	SessionUIProvider,
	useSessionPreviewAnnotationsHandler,
	useSessionPreviewUI,
} from '@/hooks/use-session-ui';
import { writeLastVisited } from '@/lib/last-visited';
import {
	getAvailableWindowWidth,
	ALL_PANELS_MIN_WIDTH,
	getPreviewOpenPlan,
	getSidebarOpenPlan,
	getViewportWidth,
	PREVIEW_SPLIT_MIN_WIDTH,
	SIDEBAR_AUTO_COLLAPSE_BREAKPOINT,
} from '@/lib/resizable-panels';
import { rootRoute } from '../layout-root';

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
	const connector = useConnector();
	const [ sidebarCollapsed, setSidebarCollapsed ] = useState(
		() => getViewportWidth() < SIDEBAR_AUTO_COLLAPSE_BREAKPOINT
	);
	const routePreviewContext = useRouterState( {
		select: ( state ) => ( {
			sessionId: getRouteSessionId( state.location.pathname ),
			overviewSiteId: getRouteOverviewSiteId( state.location.pathname ),
			newSessionSiteId: getNewSessionSiteId( state.location.pathname ),
		} ),
	} );
	const { sessionId, overviewSiteId, newSessionSiteId } = routePreviewContext;
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
	const { setOpen: setPreviewOpen } = preview;
	const previousPreviewStateRef = useRef( { show: false, fullscreen: false } );
	useLayoutEffect( () => {
		const previous = previousPreviewStateRef.current;
		previousPreviewStateRef.current = { show: showPreview, fullscreen: previewFullscreen };
		const enteringSplit =
			showPreview && ( ! previous.show || ( previous.fullscreen && ! previewFullscreen ) );
		if ( ! enteringSplit || previewFullscreen ) {
			return;
		}
		const plan = getPreviewOpenPlan(
			getViewportWidth(),
			sidebarCollapsed,
			getAvailableWindowWidth()
		);
		if ( plan.closeOtherPanel ) {
			setSidebarCollapsed( true );
		}
		void connector.ensureWindowWidth( plan.minimumWindowWidth );
	}, [ connector, previewFullscreen, showPreview, sidebarCollapsed ] );
	useEffect( () => {
		if ( ! showPreview || previewFullscreen ) {
			return;
		}
		let timeoutId: number | undefined;
		const scheduleWidthCheck = () => {
			window.clearTimeout( timeoutId );
			timeoutId = window.setTimeout( () => {
				const minimumWidth = sidebarCollapsed ? PREVIEW_SPLIT_MIN_WIDTH : ALL_PANELS_MIN_WIDTH;
				if ( getViewportWidth() < minimumWidth ) {
					setPreviewOpen( false );
				}
			}, 150 );
		};
		scheduleWidthCheck();
		window.addEventListener( 'resize', scheduleWidthCheck );
		return () => {
			window.removeEventListener( 'resize', scheduleWidthCheck );
			window.clearTimeout( timeoutId );
		};
	}, [ previewFullscreen, setPreviewOpen, showPreview, sidebarCollapsed ] );
	const sidebarOpenPlan = getSidebarOpenPlan( showPreview, getAvailableWindowWidth() );
	const handleSidebarCollapsedChange = useCallback(
		( nextCollapsed: boolean ) => {
			if ( ! nextCollapsed && sidebarOpenPlan.closeOtherPanel ) {
				setPreviewOpen( false );
			}
			setSidebarCollapsed( nextCollapsed );
		},
		[ setPreviewOpen, sidebarOpenPlan.closeOtherPanel ]
	);
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

	return (
		<SidebarLayout
			collapsed={ sidebarCollapsed }
			onCollapsedChange={ handleSidebarCollapsedChange }
			minimumExpandedWidth={ sidebarOpenPlan.minimumWindowWidth }
			forceCollapsed={ previewFullscreen }
			onForceCollapsedToggle={ exitPreviewFullscreen }
		>
			<PreviewSplitFrame
				previewOpen={ showPreview }
				previewFullscreen={ previewFullscreen }
				preview={ renderPreview }
			>
				<Outlet />
			</PreviewSplitFrame>
		</SidebarLayout>
	);
}

export const dashboardLayoutRoute = createRoute( {
	getParentRoute: () => rootRoute,
	id: 'dashboard-layout',
	component: DashboardLayout,
} );
