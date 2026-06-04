import { createRoute, Outlet, useRouterState } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { useEffect, useMemo, useState } from 'react';
import { PreviewSplitFrame } from '@/components/preview-split-frame';
import { SidebarLayout } from '@/components/sidebar-layout';
import { useSession, useSessionEffectiveEnvironment } from '@/data/queries/use-sessions';
import { useSites } from '@/data/queries/use-sites';
import {
	SessionUIProvider,
	useSessionPreviewAnnotationsHandler,
	useSessionPreviewUI,
} from '@/hooks/use-session-ui';
import { SiteExplorer } from '@/surfaces/explorer/site-explorer';
import { rootRoute } from '@/surfaces/shell/layout-root';
import styles from './style.module.css';
import type { SiteDetails } from '@/data/core';

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
	const showExplorer = preview.open && supportsPreview && !! previewSite;

	return (
		<SidebarLayout>
			<PreviewSplitFrame
				contentMode="raw"
				previewOpen={ showExplorer }
				previewResizeLabel={ __( 'Resize Explorer' ) }
				preview={ ( { collapsed, layoutWidth } ) =>
					previewSite ? (
						<SiteExplorer
							site={ previewSite }
							preview={ preview }
							collapsed={ collapsed }
							layoutWidth={ layoutWidth }
							onAnnotationsDone={ onAnnotationsDone }
						/>
					) : null
				}
			>
				<div className={ styles.routeStage }>
					<Outlet />
				</div>
			</PreviewSplitFrame>
		</SidebarLayout>
	);
}

export const dashboardLayoutRoute = createRoute( {
	getParentRoute: () => rootRoute,
	id: 'dashboard-layout',
	component: DashboardLayout,
} );
