import { findAiSessionOwnerSite } from '@studio/common/ai/sessions/owner-site';
import { createRoute, Outlet, useRouterState } from '@tanstack/react-router';
import { useCallback, useEffect, useState } from 'react';
import {
	PreviewSplitFrame,
	type PreviewSplitFramePreviewProps,
} from '@/components/preview-split-frame';
import { SidebarLayout } from '@/components/sidebar-layout';
import { SitePreview } from '@/components/site-preview';
import { useOnboardingRouteEvents } from '@/data/onboarding/use-onboarding-events';
import { useOrientationAutostart } from '@/data/onboarding/use-orientation-autostart';
import { useSession, useSessionEffectiveEnvironment } from '@/data/queries/use-sessions';
import { useSites } from '@/data/queries/use-sites';
import {
	pathForSite,
	SessionUIProvider,
	useSessionPreviewClipActions,
	useSessionPreviewClipMarkers,
	useSessionPreviewConsoleUI,
	useSessionPreviewUI,
} from '@/hooks/use-session-ui';
import { getSiteUrl } from '@/lib/get-site-url';
import { writeLastVisited } from '@/lib/last-visited';
import { usePluginSiteTag } from '@/lib/plugin-prototype';
import { rootRoute } from '../layout-root';

// Session detail routes and the site overview host the preview; on every
// other route (settings, site settings…) the last previewed site stays mounted
// but hidden.
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
	const preview = useSessionPreviewUI();
	const previewConsole = useSessionPreviewConsoleUI();
	const setPreviewOpen = preview.setOpen;
	// Open the preview when the orientation tour starts so its final step's
	// anchor lays out (the overview route already opens it on its own).
	useOrientationAutostart();
	useOnboardingRouteEvents();
	const setPreviewFullscreen = preview.setFullscreen;
	const setPreviewSite = preview.setSite;
	const updatePreviewPath = preview.updatePath;
	const clipActions = useSessionPreviewClipActions();
	const clipMarkers = useSessionPreviewClipMarkers();
	const sessionSite = findAiSessionOwnerSite( sites, sessionData?.summary );
	const effectiveEnvironment = useSessionEffectiveEnvironment(
		sessionData?.summary,
		sessionSite?.id
	);
	const overviewSite = overviewSiteId
		? sites?.find( ( site ) => site.id === overviewSiteId )
		: undefined;
	const overviewRouteSiteId = overviewSite?.id;
	const newSessionSite = newSessionSiteId
		? sites?.find( ( site ) => site.id === newSessionSiteId )
		: undefined;
	const routeSite =
		overviewSite ??
		newSessionSite ??
		( effectiveEnvironment === 'local' ? sessionSite : undefined );
	const canClipToSession =
		sessionId !== undefined && effectiveEnvironment === 'local' && !! sessionSite;
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
	// Remember where the user is so the `/` index route can return here
	// instead of defaulting to the first site.
	const sessionSiteId = sessionSite?.id;
	useEffect( () => {
		if ( sessionId ) {
			writeLastVisited( { sessionId, siteId: sessionSiteId } );
			return;
		}
		const visitedSiteId = overviewSiteId ?? newSessionSiteId;
		if ( visitedSiteId ) {
			writeLastVisited( { siteId: visitedSiteId } );
		}
	}, [ sessionId, sessionSiteId, overviewSiteId, newSessionSiteId ] );
	useEffect( () => {
		if ( overviewRouteSiteId ) {
			setPreviewOpen( true );
		}
	}, [ overviewRouteSiteId, setPreviewOpen ] );
	// Prototype: a plugin site's new-session route lands the preview on the
	// Plugins screen (via auto-login) instead of the site's front end.
	const newSessionPluginTag = usePluginSiteTag( newSessionSite?.id );
	const newSessionPluginSiteId = newSessionPluginTag ? newSessionSite?.id : undefined;
	let newSessionPluginPreviewPath: string | undefined;
	if ( newSessionPluginSiteId && newSessionSite ) {
		try {
			const redirectTo = new URL(
				'/wp-admin/plugins.php',
				getSiteUrl( newSessionSite )
			).toString();
			newSessionPluginPreviewPath = `/studio-auto-login?redirect_to=${ encodeURIComponent(
				redirectTo
			) }`;
		} catch {
			newSessionPluginPreviewPath = '/wp-admin/plugins.php';
		}
	}
	useEffect( () => {
		if ( ! newSessionPluginSiteId || ! newSessionPluginPreviewPath ) {
			return;
		}
		setPreviewSite( newSessionPluginSiteId );
		setPreviewOpen( true );
		updatePreviewPath( newSessionPluginPreviewPath );
		// Keyed on the site id — the path only changes with the site's URL, and
		// re-running then (fresh port) is the desired refresh.
	}, [
		newSessionPluginSiteId,
		newSessionPluginPreviewPath,
		setPreviewOpen,
		setPreviewSite,
		updatePreviewPath,
	] );
	const lastPreviewSite = lastPreviewSiteId
		? sites?.find( ( site ) => site.id === lastPreviewSiteId )
		: undefined;
	const previewSite = routeSite ?? lastPreviewSite;
	const previewSiteId = previewSite?.id;
	useEffect( () => {
		if ( previewSiteId ) {
			setPreviewSite( previewSiteId );
		}
	}, [ previewSiteId, setPreviewSite ] );
	const previewPath = pathForSite( preview.pathsBySiteId, previewSiteId );
	const showPreview = preview.open && supportsPreview && !! previewSite;
	const previewFullscreen = preview.fullscreen && showPreview;
	// Leave full preview when the route stops supporting a preview (settings,
	// site settings…) so the user is never left staring at a hidden layout.
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
					onClip={ canClipToSession ? clipActions.addClip : undefined }
					onClipUpdate={ canClipToSession ? clipActions.updateClipComment : undefined }
					onClipRemove={ canClipToSession ? clipActions.removeClip : undefined }
					onComposerText={ canClipToSession ? clipActions.appendComposerText : undefined }
					clipMarkers={ clipMarkers }
					onPathChange={ preview.updatePath }
					collapsed={ collapsed }
					fullscreen={ previewFullscreen }
					onToggleFullscreen={ preview.toggleFullscreen }
					onConsoleEntriesChange={ previewConsole.setEntries }
				/>
			) : null,
		[
			clipActions,
			clipMarkers,
			canClipToSession,
			previewPath,
			preview.reloadNonce,
			preview.updatePath,
			preview.toggleFullscreen,
			previewConsole.setEntries,
			previewFullscreen,
			previewSite,
		]
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
