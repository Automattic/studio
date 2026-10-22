import { findAiSessionOwnerSite } from '@studio/common/ai/sessions/owner-site';
import { createRoute, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { useCallback, useEffect, useState } from 'react';
import { requestAnnotationSend } from '@/components/annotations/store';
import { CommandPalette } from '@/components/command-palette';
import {
	PreviewSplitFrame,
	type PreviewSplitFramePreviewProps,
} from '@/components/preview-split-frame';
import { SidebarLayout } from '@/components/sidebar-layout';
import { HeaderSidebarToggle } from '@/components/sidebar-toggle';
import { SiteActionsMenu } from '@/components/site-actions-menu';
import { SitePreview } from '@/components/site-preview';
import { SiteWorkspace } from '@/components/site-workspace';
import { IconButton } from '@/components/ui/button';
import { useOrientationAutostart } from '@/data/onboarding/use-orientation-autostart';
import { useOrientationReplay } from '@/data/onboarding/use-orientation-replay';
import { useWhatsNewAutostart } from '@/data/onboarding/use-whats-new-autostart';
import { useWhatsNewReplay } from '@/data/onboarding/use-whats-new-replay';
import { useAgenticFeatures } from '@/data/queries/use-agentic-features';
import { useSession, useSessionEffectiveEnvironment } from '@/data/queries/use-sessions';
import { useSites } from '@/data/queries/use-sites';
import { pathForSite, SessionUIProvider, useSessionPreviewUI } from '@/hooks/use-session-ui';
import { chatIcon } from '@/lib/icons';
import { writeLastVisited } from '@/lib/last-visited';
import { PREVIEW_SPLIT_MIN_WIDTH } from '@/lib/resizable-panels';
import { rootRoute } from '../layout-root';

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
	const routePreviewContext = useRouterState( {
		select: ( state ) => ( {
			sessionId: getRouteSessionId( state.location.pathname ),
			homeSiteId: getRouteHomeSiteId( state.location.pathname ),
			newSessionSiteId: getNewSessionSiteId( state.location.pathname ),
		} ),
	} );
	const { sessionId, homeSiteId, newSessionSiteId } = routePreviewContext;
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
	const sessionSite = findAiSessionOwnerSite( sites, sessionData?.summary );
	const effectiveEnvironment = useSessionEffectiveEnvironment(
		sessionData?.summary,
		sessionSite?.id
	);
	const homeSite = homeSiteId ? sites?.find( ( site ) => site.id === homeSiteId ) : undefined;
	const newSessionSite = newSessionSiteId
		? sites?.find( ( site ) => site.id === newSessionSiteId )
		: undefined;
	const routeSite =
		homeSite ?? newSessionSite ?? ( effectiveEnvironment === 'local' ? sessionSite : undefined );
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
	// A site's own page is its preview, so it shows whether or not the panel is
	// open. Beside a chat, a stopped site has nothing to preview: the chat takes
	// the room and shows the site's last screenshot instead.
	const showPreview =
		( preview.open || !! homeSiteId ) &&
		supportsPreview &&
		!! previewSite &&
		( previewSite.running || !! homeSiteId );
	const chatHidden = ( preview.chatHidden || !! homeSiteId ) && showPreview;
	// Opening a chat shows it.
	const { setChatHidden } = preview;
	useEffect( () => {
		setChatHidden( false );
	}, [ sessionId, setChatHidden ] );
	const { setOpen: setPreviewOpen } = preview;
	// The window never grows to fit; a workspace too narrow for the split
	// (a narrow browser tab) gives up the preview.
	const onPreviewContainerWidthChange = useCallback(
		( width: number | null ) => {
			if ( width !== null && width < PREVIEW_SPLIT_MIN_WIDTH ) {
				setPreviewOpen( false );
			}
		},
		[ setPreviewOpen ]
	);
	// The notes go to the chat beside the preview, or to a new one for the site.
	const sendAnnotations = useCallback(
		( siteId: string, noteIds?: string[] ) => {
			requestAnnotationSend( { siteId, noteIds } );
			setChatHidden( false );
			if ( ! sessionId || sessionSite?.id !== siteId ) {
				void navigate( { to: '/sites/$siteId/new', params: { siteId } } );
			}
		},
		[ navigate, sessionId, sessionSite?.id, setChatHidden ]
	);
	const renderPreview = useCallback(
		( { collapsed }: PreviewSplitFramePreviewProps ) =>
			previewSite ? (
				<SitePreview
					site={ previewSite }
					path={ previewPath }
					reloadNonce={ preview.reloadNonce }
					onSendAnnotations={ sendAnnotations }
					onPathChange={ preview.updatePath }
					collapsed={ collapsed }
					atWindowStart={ chatHidden }
					toolbarStart={
						chatHidden ? (
							<>
								<HeaderSidebarToggle />
								<SiteActionsMenu site={ previewSite } />
								{ homeSite ? null : (
									<IconButton
										icon={ chatIcon }
										label={ __( 'Show chat' ) }
										onClick={ () => setChatHidden( false ) }
									/>
								) }
							</>
						) : undefined
					}
				/>
			) : null,
		[
			chatHidden,
			homeSite,
			sendAnnotations,
			previewPath,
			preview.reloadNonce,
			preview.updatePath,
			previewSite,
			setChatHidden,
		]
	);
	const workspaceSiteId = newSessionSiteId ?? sessionSite?.id;
	const workspace =
		( sessionId || newSessionSiteId ) && workspaceSiteId ? (
			<SiteWorkspace key={ workspaceSiteId } sessionId={ sessionId } />
		) : (
			<Outlet />
		);

	return (
		<SidebarLayout>
			<PreviewSplitFrame
				previewOpen={ showPreview }
				chatHidden={ chatHidden }
				preview={ renderPreview }
				onContainerWidthChange={ onPreviewContainerWidthChange }
			>
				{ workspace }
			</PreviewSplitFrame>
			<CommandPalette
				site={ homeSite ?? newSessionSite ?? sessionSite }
				session={ sessionData?.summary }
				chatHidden={ showPreview && ! homeSite ? chatHidden : undefined }
			/>
		</SidebarLayout>
	);
}

export const dashboardLayoutRoute = createRoute( {
	getParentRoute: () => rootRoute,
	id: 'dashboard-layout',
	component: DashboardLayout,
} );
