import { createRoute, Outlet, useRouterState } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { LivePlaygroundPreview, livePreviewSignature } from '@/components/live-playground-preview';
import { PreviewSplitFrame } from '@/components/preview-split-frame';
import { SidebarLayout } from '@/components/sidebar-layout';
import { SitePreview } from '@/components/site-preview';
import { useSession, useSessionEffectiveEnvironment } from '@/data/queries/use-sessions';
import { useSiteFiles } from '@/data/queries/use-site-files';
import { useSites } from '@/data/queries/use-sites';
import {
	SessionUIProvider,
	useSessionPreviewAnnotationsHandler,
	useSessionPreviewUI,
} from '@/hooks/use-session-ui';
import { rootRoute } from '../layout-root';

// Only session detail routes host the preview; on every other route
// (settings, site settings…) the last previewed site stays mounted but
// hidden.
function getRouteSessionId( pathname: string ): string | undefined {
	const match = /^\/sessions\/([^/]+)\/?$/.exec( pathname );
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
	const sessionId = useRouterState( {
		select: ( state ) => getRouteSessionId( state.location.pathname ),
	} );
	const { data: sites } = useSites();
	const { data: sessionData } = useSession( sessionId );
	const preview = useSessionPreviewUI();
	const onAnnotationsDone = useSessionPreviewAnnotationsHandler();
	const sessionOwnerSitePath = sessionData?.summary.ownerSitePath;
	const sessionSite = sessionOwnerSitePath
		? sites?.find( ( site ) => site.path === sessionOwnerSitePath )
		: undefined;
	const effectiveEnvironment = useSessionEffectiveEnvironment(
		sessionData?.summary,
		sessionSite?.id
	);
	const routeSite = effectiveEnvironment === 'local' ? sessionSite : undefined;
	// While the session is still loading (`sessionData` undefined) the route
	// counts as preview-capable, so switching between sessions doesn't close
	// and reopen the panel around the fetch.
	const supportsPreview = sessionId !== undefined && ( sessionData === undefined || !! routeSite );
	// Remember the last previewed site by id (looked up fresh each render so
	// `running` and friends don't go stale) to keep its webview warm across
	// routes and to bridge the gap while the next route's site resolves.
	const [ lastPreviewSiteId, setLastPreviewSiteId ] = useState< string | undefined >();
	useEffect( () => {
		if ( routeSite ) {
			setLastPreviewSiteId( routeSite.id );
		}
	}, [ routeSite ] );
	const lastPreviewSite = lastPreviewSiteId
		? sites?.find( ( site ) => site.id === lastPreviewSiteId )
		: undefined;
	const previewSite = routeSite ?? lastPreviewSite;

	// Studio Web: the agent builds into a per-session workspace that isn't a
	// registered Studio site, so there's no `previewSite` to drive a SitePreview.
	// Instead the workspace's files render in a client-side WordPress Playground.
	// Empty on desktop, where SitePreview handles the running site.
	const { data: siteFiles } = useSiteFiles( sessionId );
	const hasLivePreview = ( siteFiles?.length ?? 0 ) > 0;
	// Re-key on a content signature so each agent turn re-boots Playground with
	// the new files (it caches its SQLite connection across in-place overlays).
	const livePreviewKey = useMemo( () => livePreviewSignature( siteFiles ?? [] ), [ siteFiles ] );

	const showPreview = preview.open && ( hasLivePreview || ( supportsPreview && !! previewSite ) );

	return (
		<SidebarLayout>
			<PreviewSplitFrame
				previewOpen={ showPreview }
				preview={
					hasLivePreview ? (
						<LivePlaygroundPreview key={ livePreviewKey } files={ siteFiles ?? [] } />
					) : previewSite ? (
						<SitePreview
							site={ previewSite }
							path={ preview.path }
							reloadNonce={ preview.reloadNonce }
							onAnnotationsDone={ onAnnotationsDone }
							onPathChange={ preview.updatePath }
							collapsed={ ! showPreview }
						/>
					) : undefined
				}
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
