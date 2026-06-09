import { createRoute, Outlet, useRouterState } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { LivePlaygroundPreview } from '@/components/live-playground-preview';
import {
	PreviewSplitFrame,
	type PreviewSplitFramePreviewProps,
} from '@/components/preview-split-frame';
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
import { getSiteUrl } from '@/lib/get-site-url';
import { rootRoute } from '../layout-root';
import type { SiteDetails, SitePreviewFile } from '@/data/core';

// A cheap content signature of the preview files, used as a React `key` on the
// live preview. Playground caches its SQLite connection, so overlaying a changed
// DB in place + reloading does NOT reflect it — only a fresh boot reads the new
// DB. Keying the preview on this signature re-mounts it (and re-boots Playground)
// exactly when the files actually change, so each agent turn's edits show up.
function previewSignature( files: SitePreviewFile[] ): string {
	let hash = 5381;
	for ( const file of files ) {
		const str = `${ file.path }:${ file.contentBase64 }`;
		for ( let i = 0; i < str.length; i++ ) {
			hash = ( ( hash << 5 ) + hash + str.charCodeAt( i ) ) | 0;
		}
	}
	return `${ files.length }-${ hash }`;
}

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
	// Studio Web: the agent's workspace files, previewed via a client-side
	// Playground. Non-empty only for the web connector; desktop/SecEx return [].
	const { data: siteFiles } = useSiteFiles( routeTarget.sessionId );
	const hasLivePreview = ( siteFiles?.length ?? 0 ) > 0;
	const previewKey = useMemo( () => previewSignature( siteFiles ?? [] ), [ siteFiles ] );
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
	const showPreview = preview.open && ( hasLivePreview || ( supportsPreview && !! previewSite ) );

	const renderPreview = useCallback(
		( { collapsed, hideResizeHandle }: PreviewSplitFramePreviewProps ) => {
			// Studio Web: render the agent's workspace live in a client-side
			// Playground. Takes precedence over the SiteDetails-based previews,
			// which are for local/hosted sites with a server URL.
			if ( hasLivePreview ) {
				if ( collapsed ) {
					return null;
				}
				return <LivePlaygroundPreview key={ previewKey } files={ siteFiles ?? [] } />;
			}
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
		[
			hasLivePreview,
			onAnnotationsDone,
			preview.path,
			preview.reloadNonce,
			preview.updatePath,
			previewKey,
			previewSite,
			siteFiles,
		]
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
