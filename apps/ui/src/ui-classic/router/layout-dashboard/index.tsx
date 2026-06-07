import { createRoute, Outlet, useRouterState } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { getSiteUrl } from '@/lib/get-site-url';
import { rootRoute } from '../layout-root';
import type { SiteDetails } from '@/data/core';

// Bare preview for hosted/web sites that render via WordPress Playground on a
// foreign origin. Intentionally has no effects, no postMessage listeners, and no
// guest-script injection — unlike SitePreview, whose same-origin machinery would
// thrash a cross-origin iframe and OOM-crash the tab.
function PlaygroundPreviewFrame( { url, collapsed }: { url: string; collapsed?: boolean } ) {
	if ( collapsed ) {
		return null;
	}
	return (
		<iframe
			src={ url }
			title="Site preview"
			style={ { width: '100%', height: '100%', border: 0, background: '#fff' } }
			sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
		/>
	);
}

function getPreviewRouteTarget( pathname: string ): {
	sessionId?: string;
	siteId?: string;
} {
	const sessionMatch = /^\/sessions\/([^/]+)\/?$/.exec( pathname );
	if ( sessionMatch ) {
		return { sessionId: decodeURIComponent( sessionMatch[ 1 ] ) };
	}

	const siteMatch = /^\/sites\/([^/]+)(?:\/new)?\/?$/.exec( pathname );
	if ( siteMatch ) {
		return { siteId: decodeURIComponent( siteMatch[ 1 ] ) };
	}

	return {};
}

function DashboardLayout() {
	return (
		<SessionUIProvider>
			<DashboardLayoutContent />
		</SessionUIProvider>
	);
}

function DashboardLayoutContent() {
	const pathname = useRouterState( { select: ( state ) => state.location.pathname } );
	const routeTarget = useMemo( () => getPreviewRouteTarget( pathname ), [ pathname ] );
	const { data: sites } = useSites();
	const { data: sessionData } = useSession( routeTarget.sessionId );
	const preview = useSessionPreviewUI();
	const onAnnotationsDone = useSessionPreviewAnnotationsHandler();
	const sessionOwnerSitePath = sessionData?.summary.ownerSitePath;
	const sessionSite = sessionOwnerSitePath
		? sites?.find( ( site ) => site.path === sessionOwnerSitePath )
		: undefined;
	const siteRouteSite = routeTarget.siteId
		? sites?.find( ( site ) => site.id === routeTarget.siteId )
		: undefined;
	const effectiveEnvironment = useSessionEffectiveEnvironment(
		sessionData?.summary,
		sessionSite?.id
	);
	const siteRouteSupportsPreview =
		routeTarget.siteId !== undefined && ( sites === undefined || !! siteRouteSite );
	const sessionRouteSupportsPreview =
		routeTarget.sessionId !== undefined &&
		( sessionData === undefined || ( effectiveEnvironment === 'local' && !! sessionSite ) );
	const supportsPreview = siteRouteSupportsPreview || sessionRouteSupportsPreview;
	const routeSite =
		routeTarget.siteId !== undefined
			? siteRouteSite
			: effectiveEnvironment === 'local'
			? sessionSite
			: undefined;
	const [ lastPreviewSite, setLastPreviewSite ] = useState< SiteDetails | undefined >();

	useEffect( () => {
		if ( routeSite ) {
			setLastPreviewSite( routeSite );
		}
	}, [ routeSite ] );

	const previewSite = supportsPreview ? routeSite ?? lastPreviewSite : lastPreviewSite;
	const showPreview = preview.open && supportsPreview && !! previewSite;

	const renderPreview = useCallback(
		( { collapsed, hideResizeHandle }: PreviewSplitFramePreviewProps ) => {
			if ( ! previewSite ) {
				return null;
			}
			// Hosted/web preview (Studio Web): the site renders via WordPress
			// Playground on a foreign origin. SitePreview's same-origin guest-script
			// + postMessage machinery thrashes that iframe (OOM-crashes the tab), so
			// render a bare iframe instead. Desktop/local sites keep full SitePreview.
			const previewUrl = getSiteUrl( previewSite );
			if ( previewUrl.startsWith( 'https://playground.wordpress.net' ) ) {
				return <PlaygroundPreviewFrame url={ previewUrl } collapsed={ collapsed } />;
			}
			return (
				<SitePreview
					site={ previewSite }
					path={ preview.path }
					reloadNonce={ preview.reloadNonce }
					onAnnotationsDone={ onAnnotationsDone }
					collapsed={ collapsed }
					hideResizeHandle={ hideResizeHandle }
					onPathChange={ preview.updatePath }
				/>
			);
		},
		[ onAnnotationsDone, preview.path, preview.reloadNonce, preview.updatePath, previewSite ]
	);

	return (
		<SidebarLayout>
			<PreviewSplitFrame contentMode="raw" previewOpen={ showPreview } preview={ renderPreview }>
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
