import { findAiSessionOwnerSite } from '@studio/common/ai/sessions/owner-site';
import { createRoute, Outlet, useRouterState } from '@tanstack/react-router';
import { useCallback, useEffect, useState } from 'react';
import {
	PreviewSplitFrame,
	type PreviewSplitFramePreviewProps,
} from '@/components/preview-split-frame';
import { SidebarLayout } from '@/components/sidebar-layout';
import { SitePreview } from '@/components/site-preview';
import { useSession, useSessionEffectiveEnvironment } from '@/data/queries/use-sessions';
import { useSites } from '@/data/queries/use-sites';
import {
	SessionUIProvider,
	useSessionPreviewAnnotationsHandler,
	useSessionPreviewUI,
} from '@/hooks/use-session-ui';
import { writeLastVisited } from '@/lib/last-visited';
import { rootRoute } from '../layout-root';

// Only session detail routes host the preview; on every other route
// (settings, site settings…) the last previewed site stays mounted but
// hidden.
function getRouteSessionId( pathname: string ): string | undefined {
	const match = /^\/sessions\/([^/]+)\/?$/.exec( pathname );
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
			newSessionSiteId: getNewSessionSiteId( state.location.pathname ),
		} ),
	} );
	const { sessionId, newSessionSiteId } = routePreviewContext;
	const { data: sites } = useSites();
	const { data: sessionData } = useSession( sessionId );
	const preview = useSessionPreviewUI();
	const onAnnotationsDone = useSessionPreviewAnnotationsHandler();
	const sessionSite = findAiSessionOwnerSite( sites, sessionData?.summary );
	const effectiveEnvironment = useSessionEffectiveEnvironment(
		sessionData?.summary,
		sessionSite?.id
	);
	const newSessionSite = newSessionSiteId
		? sites?.find( ( site ) => site.id === newSessionSiteId )
		: undefined;
	const routeSite =
		newSessionSite ?? ( effectiveEnvironment === 'local' ? sessionSite : undefined );
	// While session or site data is still loading, preview-capable routes stay
	// preview-capable so navigation doesn't close and reopen the panel around
	// the fetch.
	const supportsPreview =
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
		if ( newSessionSiteId ) {
			writeLastVisited( { siteId: newSessionSiteId } );
		}
	}, [ sessionId, sessionSiteId, newSessionSiteId ] );
	const lastPreviewSite = lastPreviewSiteId
		? sites?.find( ( site ) => site.id === lastPreviewSiteId )
		: undefined;
	const previewSite = routeSite ?? lastPreviewSite;
	const showPreview = preview.open && supportsPreview && !! previewSite;
	const renderPreview = useCallback(
		( { collapsed }: PreviewSplitFramePreviewProps ) =>
			previewSite ? (
				<SitePreview
					site={ previewSite }
					path={ preview.path }
					reloadNonce={ preview.reloadNonce }
					onAnnotationsDone={ onAnnotationsDone }
					onPathChange={ preview.updatePath }
					collapsed={ collapsed }
				/>
			) : null,
		[ onAnnotationsDone, preview.path, preview.reloadNonce, preview.updatePath, previewSite ]
	);

	return (
		<SidebarLayout>
			<PreviewSplitFrame previewOpen={ showPreview } preview={ renderPreview }>
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
