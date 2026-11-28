import { DESIGN_SYSTEM_PREVIEW_PATH } from '@studio/agent/protocol/chat-artifacts';
import { getSiteBrowserUrl } from '@studio/common/lib/user-settings/site-browser-url';
import { __, sprintf } from '@wordpress/i18n';
import { XIcon } from '@studio/ds/icons';
import {
	Suspense,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useConnector } from '@/data/core';
import { getPreviewTabSplit } from '@/data/preview-tab-state';
import { previewTabsKey, usePreviewTabs } from '@/data/preview-tabs';
import { useFrontendAdminBar } from '@/data/queries/use-frontend-admin-bar';
import { useSiteDesign } from '@/data/queries/use-site-design';
import {
	useIsSiteStarting,
	useIsSiteStopping,
	useSiteOperation,
	useStartSite,
} from '@/data/queries/use-sites';
import { useResponsivePreview, updateResponsivePreview } from '@/data/responsive-preview';
import { useIsSiteRestarting } from '@/data/site-restarts';
import {
	AnnotationOverlay,
	discardAnnotations,
	isBatchedAnnotation,
	getSiteAnnotations,
	subscribeAnnotationReview,
	editAnnotation,
	type AnnotationAnchor,
	type PreviewAnnotation,
	isAnnotationsBusy,
	setAnnotating,
	useSiteAnnotations,
} from '@/features/annotations';
import { DesignSystemView } from '@/features/sites/design-system-view';
import { EmailView } from '@/features/sites/email-view';
import { getSiteUrl } from '@/features/sites/get-site-url';
import { PreviewParticles } from '@/features/sites/preview-particles';
import { useSiteHeader } from '@/features/sites/site-header-actions';
import { SiteToolLauncher, useSiteToolActions } from '@/features/sites/site-tools';
import { SiteContextMenu } from '@/features/sites/stopped-site-preview';
import { IconButton, ResizeHandle, ResizeOverlay, VisuallyHidden } from '@studio/ds';
import {
	EMAIL_PREVIEW_PATH,
	getPathFromPreviewUrl,
	getPreviewRealm,
	getRealmNavigationPath,
	isWordPressAuthPath,
} from './address-bar';
import { EMPTY_BROWSER_STATE, type BrowserNavigationState } from './browser-state';
import { PreviewHeader } from './preview-header';
import { AnnotateButton } from './preview-header/annotate-button';
import { AnnotationTools } from './preview-header/annotation-tools';
import {
	FrameSurface,
	isElectron,
	PreviewLoadFailed,
	SurfaceLayer,
	WebviewSurface,
} from './preview-surface';
import {
	getWebviewContentsId,
	subscribePreviewOpenLink,
	type WebviewTag,
} from './preview-surface/webview';
import { getFitScale } from './responsive-preview/settings';
import { ResponsiveToolbar } from './responsive-preview/toolbar';
import styles from './style.module.css';
import { getFrameKey, getSafePath, type PreviewSurfaceKey } from './surfaces';
import { useAnnotationTools } from './use-annotation-tools';
import { useBrowserShortcuts } from './use-browser-shortcuts';
import { useLoadingStage } from './use-loading-stage';
import { usePreviewAnnotations } from './use-preview-annotations';
import { usePreviewBrowser } from './use-preview-browser';
import { usePreviewCapture } from './use-preview-capture';
import { usePreviewOpenTracks } from './use-preview-open-tracks';
import { usePreviewScreenshot } from './use-preview-screenshot';
import { useTabThumbnail } from './use-tab-thumbnail';
import { usePreviewSurfaces } from './use-preview-surfaces';
import { useTabSplit } from './use-tab-split';
import type { SiteDetails } from '@/data/core';
import type { InspectorEvent } from '@studio/agent/protocol/inspector/page-script';
import type { AnnotationTool } from '@studio/agent/protocol/inspector/shortcuts';
import type { CSSProperties } from 'react';

interface SitePreviewProps {
	site: SiteDetails;
	// The connected remote to show instead, for a chat switched to Live.
	liveUrl?: string;
	// Path to display within the previewed site, controlled by the parent so
	// it can be updated by chat artifact events even when the panel was
	// previously collapsed.
	path: string;
	// Bumped by the parent to force a webview reload.
	reloadNonce: number;
	// Sends the site's annotations to its chat: every note with the chat draft,
	// or only `noteIds`, straight away.
	onSendAnnotations?: ( siteId: string, noteIds?: string[] ) => void;
	onStartAnnotating?: () => boolean;
	onAttachScreenshot?: ( siteId: string, file: File ) => void;
	// Called when the user navigates within the preview (link clicks,
	// back/forward) so the parent can keep its `path` in sync without
	// forcing a reload.
	onPathChange?: ( path: string ) => void;
	// True while the panel is toggled off but kept mounted (so the webview
	// stays warm). Disables the global browser shortcuts in that state.
	collapsed?: boolean;
	inactive?: boolean;
	blank?: boolean;
	onThumbnail?: ( path: string, image: string ) => void;
	onTitleChange?: ( title: string | null ) => void;
}

interface PaneAnnotationControls {
	pageTools: boolean;
	selectTool: ( tool: AnnotationTool ) => void;
}

interface PreviewPaneProps extends SitePreviewProps {
	tabId: string;
	focused: boolean;
	split: boolean;
	annotationHost: boolean;
	annotationTool: AnnotationTool;
	annotationPaneById: ReadonlyMap< string, string >;
	registerAnnotationControls: ( paneId: string, controls: PaneAnnotationControls ) => () => void;
	onAnnotationToolChange: ( tool: AnnotationTool ) => void;
	paneLabel?: string;
	onActivate: () => void;
	onOpenLinkInTab: ( url: string ) => void;
	onCloseTab?: () => void;
	sharedHeaderTarget?: HTMLElement | null;
}

function SitePreviewContent( {
	site,
	liveUrl,
	path,
	reloadNonce,
	onSendAnnotations,
	onStartAnnotating,
	onAttachScreenshot,
	onPathChange,
	collapsed = false,
	inactive = false,
	blank = false,
	onThumbnail,
	onTitleChange,
	tabId,
	focused,
	split,
	annotationHost,
	annotationTool,
	annotationPaneById,
	registerAnnotationControls,
	onAnnotationToolChange,
	paneLabel,
	onActivate,
	onOpenLinkInTab,
	onCloseTab,
	sharedHeaderTarget,
}: PreviewPaneProps ) {
	const { annotationTarget } = useSiteHeader();
	const connector = useConnector();
	const trackOpen = usePreviewOpenTracks();
	const startSite = useStartSite();
	const operation = useSiteOperation( site );
	const startPending = useIsSiteStarting( site.id );
	const stopPending = useIsSiteStopping( site.id );
	const live = !! liveUrl;
	// This window's own start or stop lands before the CLI records it.
	const isRestarting = useIsSiteRestarting( site.id ) && ! live;
	const isStarting = ! live && ( isRestarting || startPending || operation === 'start' );
	const isStopping = ! live && ! isRestarting && ( stopPending || operation === 'stop' );
	const siteUrl = liveUrl ?? getSiteUrl( site );
	const canPreview = live || site.running || isRestarting;
	const showStoppedPreview = ! blank && ! canPreview && ! isStarting;
	const tools = useSiteToolActions( site, { liveUrl, onNavigate: onPathChange } );
	const canUseWebview = isElectron();
	const safePath = getSafePath( path );
	const {
		surfaces,
		activeRealm,
		activeSurfaceKey,
		activeSurface,
		browserState,
		patchSurface,
		handleSurfaceNavigation,
		sendSurfaceCommand,
		sendBrowserCommand,
		goToHistoryIndex,
	} = usePreviewSurfaces( {
		siteId: site.id,
		siteUrl,
		path: safePath,
		reloadNonce,
		onPathChange,
		active: ! inactive,
	} );
	const siteDesign = useSiteDesign( site );
	const annotations = useSiteAnnotations( site.id );
	const pageAnnotationsActive = ! inactive && ! collapsed && activeSurfaceKey === 'site';
	const ownsNote =
		annotations.editingId !== null && annotationPaneById.get( annotations.editingId ) === tabId;
	const paneAnnotations = useMemo(
		() => ( {
			...annotations,
			active: ! inactive && ! collapsed && annotations.active,
			notes: annotations.notes.filter( ( note ) => annotationPaneById.get( note.id ) === tabId ),
			editingId: ownsNote ? annotations.editingId : null,
		} ),
		[ annotationPaneById, annotations, collapsed, inactive, ownsNote, tabId ]
	);
	const pageAnnotations = useMemo(
		() => ( { ...paneAnnotations, active: pageAnnotationsActive && paneAnnotations.active } ),
		[ paneAnnotations, pageAnnotationsActive ]
	);
	// Surfaces Studio draws itself, with no page to load.
	const rendered = activeSurfaceKey === 'design' || activeSurfaceKey === 'email';
	const { loadingStage, reveal } = useLoadingStage( {
		siteId: site.id,
		live,
		canPreview,
		isStarting,
		rendered: rendered || blank,
		publish: focused && ! inactive && ! blank,
	} );
	const [ restartReveal, setRestartReveal ] = useState( false );
	useEffect( () => {
		if ( isRestarting ) setRestartReveal( true );
		else if ( ! loadingStage ) setRestartReveal( false );
	}, [ isRestarting, loadingStage ] );
	const wasRestarting = useRef( isRestarting );
	useEffect( () => {
		const finished = wasRestarting.current && ! isRestarting;
		wasRestarting.current = isRestarting;
		if ( ! finished ) return;
		if ( site.running && ! inactive && activeRealm !== 'admin' ) sendBrowserCommand( 'reload' );
		else reveal();
	}, [ isRestarting, site.running, inactive, activeRealm, sendBrowserCommand, reveal ] );
	// Track the first load too, before a frame can report in-page navigation.
	const [ loadedFrames, setLoadedFrames ] = useState<
		Partial< Record< PreviewSurfaceKey, string > >
	>( {} );
	const activeFrameLoading =
		! canUseWebview &&
		!! activeSurface &&
		loadedFrames[ activeSurfaceKey ] !== getFrameKey( siteUrl, activeSurface );
	const navigating = canPreview && ! rendered && ( browserState.loading || activeFrameLoading );
	// Studio renders the design system and the email itself, so they need no
	// page injection.
	const showAnnotate = ! live;
	const canAnnotateSurface =
		showAnnotate &&
		! blank &&
		activeSurfaceKey !== 'database' &&
		( connector.capabilities.annotatePreview || rendered );
	const canAnnotate =
		canAnnotateSurface &&
		( activeSurfaceKey === 'design'
			? !! siteDesign.data?.design
			: activeSurfaceKey === 'email' || !! activeSurface?.inspectorReady );
	const viewportRef = useRef< HTMLDivElement | null >( null );
	useTabThumbnail(
		viewportRef,
		safePath,
		!! onThumbnail &&
			canPreview &&
			! blank &&
			! inactive &&
			! collapsed &&
			! loadingStage &&
			! navigating &&
			! browserState.failed,
		onThumbnail,
		rendered
	);
	const previewBrowser = usePreviewBrowser( viewportRef );
	const screenshot = usePreviewScreenshot(
		viewportRef,
		onAttachScreenshot ? ( file ) => onAttachScreenshot( site.id, file ) : undefined
	);
	const browserActions = canUseWebview && ! rendered && ! blank ? previewBrowser : undefined;
	const reloadFrontend = useCallback(
		() => sendSurfaceCommand( 'site', 'reload' ),
		[ sendSurfaceCommand ]
	);
	const adminBarActive =
		! live &&
		! blank &&
		canPreview &&
		activeRealm === 'frontend' &&
		! collapsed &&
		! inactive &&
		getPreviewRealm( activeSurface?.path ?? safePath ) === 'frontend' &&
		! isWordPressAuthPath( activeSurface?.path ?? safePath ) &&
		! ( activeSurface?.path ?? safePath ).startsWith( '/studio-auto-login' );
	const showFrontendAdminBar = useCallback( () => {
		if ( ! canUseWebview ) {
			sendSurfaceCommand( 'site', 'login' );
			return;
		}
		const currentPath = activeSurface?.path ?? safePath;
		const loginPath = currentPath.startsWith( '/studio-auto-login' )
			? currentPath
			: getPathFromPreviewUrl( getSiteBrowserUrl( { url: siteUrl }, currentPath ), siteUrl );
		if ( ! loginPath ) return;
		if ( currentPath === loginPath ) sendSurfaceCommand( 'site', 'reload' );
		else patchSurface( 'site', { path: loginPath, requestedPath: loginPath } );
		onPathChange?.( loginPath );
	}, [
		activeSurface?.path,
		canUseWebview,
		onPathChange,
		patchSurface,
		safePath,
		sendSurfaceCommand,
		siteUrl,
	] );
	const adminBarActions = useFrontendAdminBar( {
		site,
		active: adminBarActive,
		available: ! navigating && ! browserState.failed && ! isStarting && ! isStopping,
		path: activeSurface?.path ?? safePath,
		visible: activeSurface?.adminBarVisible ?? null,
		onReload: reloadFrontend,
		onShow: showFrontendAdminBar,
		onRead: () => {
			if ( adminBarActive ) sendSurfaceCommand( 'site', 'read-admin-bar' );
		},
	} );
	const responsiveSettings = useResponsivePreview( site.id, tabId );
	const responsiveEnabled = responsiveSettings.enabled && canPreview && activeSurfaceKey === 'site';
	const responsiveActive = ! inactive && ! collapsed && ! isStarting && ! isStopping;
	const [ availableSize, setAvailableSize ] = useState( { width: 0, height: 0 } );
	useLayoutEffect( () => {
		const viewport = viewportRef.current;
		if ( ! viewport ) return;
		const measure = () =>
			setAvailableSize( { width: viewport.clientWidth, height: viewport.clientHeight } );
		measure();
		const observer = new ResizeObserver( measure );
		observer.observe( viewport );
		return () => observer.disconnect();
	}, [] );
	const fitScale = getFitScale(
		availableSize.width,
		availableSize.height,
		responsiveSettings.width,
		responsiveSettings.height
	);
	useLayoutEffect( () => {
		const viewport = viewportRef.current;
		if (
			responsiveEnabled &&
			responsiveSettings.zoom === 'fit' &&
			responsiveSettings.fitScale === undefined &&
			viewport &&
			viewport.clientWidth > 0 &&
			viewport.clientHeight > 0
		) {
			updateResponsivePreview(
				site.id,
				{
					fitScale: getFitScale(
						viewport.clientWidth,
						viewport.clientHeight,
						responsiveSettings.width,
						responsiveSettings.height
					),
				},
				tabId
			);
		}
	}, [
		responsiveEnabled,
		responsiveSettings,
		availableSize.width,
		availableSize.height,
		site.id,
		tabId,
	] );
	const responsiveScale =
		responsiveSettings.zoom === 'fit'
			? responsiveSettings.fitScale ?? fitScale
			: responsiveSettings.zoom;
	const {
		annotationAnchor,
		setAnnotationAnchor,
		toViewportAnchor,
		handleAnnotationPick,
		handleAnnotationEvent,
		sendAnnotations,
	} = usePreviewAnnotations( {
		siteId: site.id,
		paneId: tabId,
		surfaceKey: activeSurfaceKey,
		canAnnotateSurface,
		viewportRef,
		onSendAnnotations,
		enabled: focused && ! inactive && ! split,
	} );
	useEffect( () => {
		if ( activeSurfaceKey !== 'design' ) setAnnotationAnchor( null );
	}, [
		activeSurfaceKey,
		responsiveSettings.width,
		responsiveSettings.height,
		responsiveEnabled,
		responsiveScale,
		availableSize.width,
		availableSize.height,
		setAnnotationAnchor,
	] );
	const handleDesignAnchor = useCallback(
		( anchor: AnnotationAnchor ) => {
			const next = toViewportAnchor( anchor );
			setAnnotationAnchor( ( current ) =>
				current?.left === next?.left && current?.top === next?.top ? current : next
			);
		},
		[ setAnnotationAnchor, toViewportAnchor ]
	);
	const annotationTools = useAnnotationTools( {
		siteId: site.id,
		enabled: pageAnnotationsActive && canAnnotate,
		shortcuts: focused,
		tool: annotationTool,
		onToolChange: onAnnotationToolChange,
		viewportRef,
		onPick: handleAnnotationPick,
	} );
	const handleAnnotationToolEvent = annotationTools.handleEvent;
	const { escapeDraft, selectTool } = annotationTools;
	useLayoutEffect( () => {
		if ( inactive || collapsed || ! annotations.active || ! canAnnotate ) return;
		return registerAnnotationControls( tabId, {
			pageTools: activeSurfaceKey === 'site',
			selectTool,
		} );
	}, [
		activeSurfaceKey,
		annotations.active,
		canAnnotate,
		collapsed,
		inactive,
		tabId,
		registerAnnotationControls,
		selectTool,
	] );
	const capturePage = usePreviewCapture( site.id, siteUrl, viewportRef );
	const handleSurfaceLoad = useCallback(
		( key: PreviewSurfaceKey, url: string, guestId?: number ) => {
			reveal();
			if ( key === 'site' && ! live && ! inactive && focused ) {
				capturePage( url, guestId );
			}
		},
		[ capturePage, live, reveal, inactive, focused ]
	);
	const handleSurfaceBrowserState = useCallback(
		( key: PreviewSurfaceKey, browser: BrowserNavigationState ) => {
			patchSurface( key, { browser } );
			if ( key === activeSurfaceKey ) onTitleChange?.( browser.title );
			if ( browser.failed ) {
				reveal();
			}
		},
		[ patchSurface, reveal, activeSurfaceKey, onTitleChange ]
	);

	// Shortcuts the guest page swallowed and forwarded back over the console
	// bridge, for the webview.
	const handleInspectorEvent = useCallback(
		( event: InspectorEvent ) => {
			if ( inactive || collapsed ) return;
			if ( event.type === 'browser-command' ) {
				if ( focused ) sendBrowserCommand( event.command );
			} else if ( event.type === 'selection' || event.type === 'annotation-tool' ) {
				if ( event.type === 'annotation-tool' || event.selection ) onActivate();
				handleAnnotationToolEvent( event );
			} else if ( event.type === 'pick' || event.type === 'edit' ) {
				if ( event.type === 'edit' && annotationPaneById.get( event.id ) !== tabId ) return;
				onActivate();
				handleAnnotationEvent( event );
			} else if ( event.type === 'anchor' ) {
				if ( ownsNote ) handleAnnotationEvent( event );
			} else if ( focused ) {
				if ( ! escapeDraft() ) handleAnnotationEvent( event );
			}
		},
		[
			annotationPaneById,
			collapsed,
			escapeDraft,
			focused,
			handleAnnotationEvent,
			handleAnnotationToolEvent,
			sendBrowserCommand,
			inactive,
			onActivate,
			tabId,
			ownsNote,
		]
	);

	const browserShortcuts = useBrowserShortcuts(
		canPreview && ! isStarting && ! isStopping && ! collapsed && ! inactive && focused,
		sendBrowserCommand
	);

	// Matches the realm on screen (front end / WP Admin / phpMyAdmin) rather
	// than always the front end. Admin screens go through /studio-auto-login so
	// they don't land on the login form; the front end opens logged out.
	const openExternal = live
		? () => {
				trackOpen( safePath, 'external' );
				void connector.openExternalUrl( `${ siteUrl }${ safePath }` );
		  }
		: rendered
		? undefined
		: () => {
				trackOpen( safePath, 'external' );
				void connector
					.openSiteUrl( site.id, safePath, { autoLogin: activeRealm !== 'frontend' } )
					.catch( ( error ) => {
						console.error( 'Failed to open site in browser:', error );
					} );
		  };
	const responsive = {
		active: responsiveEnabled,
		disabled: blank || ! canPreview || isStarting || isStopping || activeSurfaceKey !== 'site',
		onClick: () => {
			if ( ! responsiveSettings.enabled && adminBarActions.value === 'show' ) {
				adminBarActions.onChange( 'hide' );
			}
			updateResponsivePreview( site.id, { enabled: ! responsiveSettings.enabled }, tabId );
		},
	};
	const beginAnnotating = () => {
		if ( onStartAnnotating?.() === false ) return false;
		setAnnotating( site.id, true );
		if ( ! site.running && ! isStarting )
			startSite.mutate( site.id, {
				onError: () => setAnnotating( site.id, false ),
			} );
		return true;
	};
	const showBrowserBar =
		canPreview && ! blank && ( ! loadingStage || isRestarting || restartReveal );

	// A link in an email to the site opens in the preview, like a password reset
	// link; any other opens in the browser.
	const openEmailLink = ( url: string ) => {
		const sitePath = getPathFromPreviewUrl( url, siteUrl );
		if ( sitePath ) {
			onPathChange?.( getRealmNavigationPath( sitePath, siteUrl ) );
		} else if ( /^(?:https?|mailto):/i.test( url ) ) {
			void connector.openExternalUrl( url );
		}
	};

	const annotate = showAnnotate
		? {
				annotationCount: annotations.notes.filter( isBatchedAnnotation ).length,
				active: annotations.active,
				disabled:
					! canAnnotateSurface ||
					isStarting ||
					isStopping ||
					( site.running && ( blank || ( activeSurfaceKey !== 'site' && ! canAnnotate ) ) ) ||
					isAnnotationsBusy( annotations ),
				disabledReason: blank
					? __( 'Open a project page to annotate.' )
					: activeSurfaceKey === 'design' && ! siteDesign.data?.design
					? __( 'Annotation is available for design systems created by Studio Code.' )
					: activeSurfaceKey === 'database'
					? __( 'Not available for Database' )
					: ! canAnnotateSurface
					? __( 'Site annotation is not available in the browser yet' )
					: undefined,
				onClick: () => {
					if ( annotations.active ) setAnnotating( site.id, false );
					else beginAnnotating();
				},
		  }
		: undefined;

	const closeTab = onCloseTab && (
		<IconButton
			variant="ghost"
			size="icon-sm"
			icon={ <XIcon width={ 16 } height={ 16 } /> }
			label={ __( 'Close tab' ) }
			tooltipSide="bottom"
			onClick={ onCloseTab }
		/>
	);
	const annotationButton = ! inactive && ! collapsed && annotate && (
		<AnnotateButton
			{ ...annotate }
			pageTools={ activeSurfaceKey === 'site' && canAnnotate }
			shortcuts={ split ? annotationHost : focused }
		/>
	);
	const hasBrowserHeader = showBrowserBar && activeSurfaceKey !== 'email';
	const emailActions =
		! split && showBrowserBar && activeSurfaceKey === 'email' && annotationButton;
	const header = (
		<PreviewHeader
			site={ site }
			siteUrl={ siteUrl }
			path={ safePath }
			live={ live }
			canPreview={ canPreview }
			isStarting={ isStarting }
			isRestarting={ isRestarting }
			isStopping={ isStopping }
			browserState={ browserState }
			shortcuts={ browserShortcuts }
			onBrowserCommand={ sendBrowserCommand }
			onJump={ goToHistoryIndex }
			onPathChange={ onPathChange }
			browserActions={ browserActions }
			adminBarActions={ ! live && ! rendered && ! blank ? adminBarActions : undefined }
			onOpenExternal={ blank ? undefined : openExternal }
			onExternalNavigate={ ( url ) => void connector.openExternalUrl( url ) }
			responsive={ responsive }
			closeTab={ closeTab }
			annotation={ ! split && annotationButton }
			screenshot={
				! rendered && ! blank && onAttachScreenshot
					? {
							disabled: ! canUseWebview || navigating || browserState.failed,
							disabledReason: ! canUseWebview
								? __( 'Screenshots are available in the desktop app.' )
								: undefined,
							capturing: screenshot.capturing,
							onClick: () => void screenshot.capture(),
					  }
					: undefined
			}
		/>
	);

	return (
		<aside
			className={ styles.root }
			data-browser-bar={ showBrowserBar || !! closeTab || undefined }
			aria-label={ paneLabel ?? __( 'Panel' ) }
		>
			{ split &&
				annotationHost &&
				annotationTarget &&
				createPortal( annotationButton, annotationTarget ) }
			{ hasBrowserHeader
				? sharedHeaderTarget === undefined
					? header
					: focused && sharedHeaderTarget && createPortal( header, sharedHeaderTarget )
				: ( closeTab || emailActions ) && (
						<div className={ styles.closeTabBar }>
							{ emailActions }
							{ closeTab }
						</div>
				  ) }
			{ showBrowserBar && responsiveEnabled ? (
				<ResponsiveToolbar
					siteId={ site.id }
					tabId={ tabId }
					settings={ responsiveSettings }
					fitScale={ fitScale }
					active={ responsiveActive }
				/>
			) : null }
			<div className={ styles.body }>
				<div
					ref={ viewportRef }
					className={ styles.previewViewport }
					data-preview-viewport
					onScrollCapture={ () => setAnnotationAnchor( null ) }
				>
					{ ! blank &&
						canPreview &&
						( Object.keys( surfaces ) as PreviewSurfaceKey[] ).map( ( key ) => {
							const surface = surfaces[ key ];
							if ( ! surface ) {
								return null;
							}
							const active = key === activeSurfaceKey;
							const surfaceUrl = `${ siteUrl }${ surface.path }`;
							if ( key === 'design' ) {
								return (
									<SurfaceLayer key={ key } active={ active } design>
										{ /* The view waits for the site's font stylesheet; only this pane should. */ }
										<Suspense fallback={ null }>
											{ siteDesign.isPending ||
											( siteDesign.isFetching && ! siteDesign.data ) ? null : (
												<DesignSystemView
													annotations={ paneAnnotations }
													siteId={ site.id }
													siteDesign={ siteDesign.data ?? null }
													error={ siteDesign.error }
													onRetry={ () => void siteDesign.refetch() }
													retrying={ siteDesign.isFetching }
													onAnnotationPick={ handleAnnotationPick }
													onAnnotationAnchor={ handleDesignAnchor }
												/>
											) }
										</Suspense>
									</SurfaceLayer>
								);
							}
							if ( key === 'email' ) {
								return (
									<SurfaceLayer key={ key } active={ active }>
										<EmailView
											annotations={ paneAnnotations }
											key={ site.id }
											siteId={ site.id }
											active={ active && ! collapsed }
											onOpenLink={ openEmailLink }
											onAnnotationPick={ handleAnnotationPick }
											onAnnotationAnchor={ ( anchor: AnnotationAnchor | null ) =>
												setAnnotationAnchor( toViewportAnchor( anchor ) )
											}
										/>
									</SurfaceLayer>
								);
							}
							const frameKey = getFrameKey( siteUrl, surface );
							const inspectorProps = {
								annotations: key === 'site' ? pageAnnotations : undefined,
								onInspectorReady: ( inspectorReady: boolean ) => {
									patchSurface( key, { inspectorReady } );
									if ( ! inspectorReady ) setAnnotationAnchor( null );
								},
								onInspectorEvent: active ? handleInspectorEvent : undefined,
							};
							return (
								<SurfaceLayer
									key={ key }
									active={ active }
									responsive={
										key === 'site'
											? {
													siteId: site.id,
													tabId,
													settings: responsiveSettings,
													scale: responsiveScale,
													active: responsiveActive,
											  }
											: undefined
									}
									loading={ loadingStage }
									failed={ surface.browser.failed }
								>
									{ canUseWebview ? (
										<WebviewSurface
											key={ `${ site.id }-${ key }` }
											url={ surfaceUrl }
											colorScheme={ previewBrowser.colorScheme }
											reloadNonce={ surface.reloadNonce }
											// phpMyAdmin isn't an annotation target, so the
											// inspector never goes near it.
											inspector={ key === 'site' }
											{ ...inspectorProps }
											annotationTool={ annotationTool }
											clearSelection={ annotationTools.clearSelection }
											onActivate={ onActivate }
											browserCommand={ surface.browserCommand }
											onBrowserStateChange={ ( state ) => handleSurfaceBrowserState( key, state ) }
											onNavigate={ ( url ) => handleSurfaceNavigation( key, url ) }
											onAdminBarVisibilityChange={
												key === 'site' && ! live
													? ( adminBarVisible ) => patchSurface( key, { adminBarVisible } )
													: undefined
											}
											onLoad={ ( url, guestId ) => handleSurfaceLoad( key, url, guestId ) }
										/>
									) : (
										<FrameSurface
											onActivate={ onActivate }
											onOpenLinkInTab={
												! inactive && ! collapsed && active ? onOpenLinkInTab : undefined
											}
											key={ frameKey }
											src={ `${ siteUrl }${ surface.requestedPath }` }
											title={ site.name }
											browserCommand={ surface.browserCommand }
											onCommandHandled={ () => patchSurface( key, { browserCommand: null } ) }
											onAdminBarVisibilityChange={
												key === 'site' && ! live
													? ( adminBarVisible ) => patchSurface( key, { adminBarVisible } )
													: undefined
											}
											onNavigate={ ( url ) => handleSurfaceNavigation( key, url ) }
											onLoadingChange={ ( loading ) => {
												patchSurface( key, { browser: { ...surface.browser, loading } } );
											} }
											onLoad={ () => {
												setLoadedFrames( ( frames ) => ( { ...frames, [ key ]: frameKey } ) );
											} }
											onSettle={ ( src, title, failed ) => {
												if ( ! failed ) {
													handleSurfaceLoad( key, src );
												}
												handleSurfaceBrowserState( key, {
													...EMPTY_BROWSER_STATE,
													title,
													failed,
												} );
											} }
										/>
									) }
									{ surface.browser.failed ? (
										<PreviewLoadFailed onRetry={ () => sendSurfaceCommand( key, 'reload' ) } />
									) : null }
								</SurfaceLayer>
							);
						} ) }
					<SiteContextMenu site={ site } disabled={ canPreview }>
						<div className={ styles.empty }>
							<PreviewParticles
								showDots={
									blank || showStoppedPreview || ( ! blank && loadingStage && ! collapsed )
								}
								active={ ! blank && loadingStage && ! collapsed }
								showLogo={ ! blank && loadingStage && ! collapsed }
							/>
							{ ! blank && ( loadingStage || navigating ) ? (
								<VisuallyHidden role="status">{ __( 'Loading site preview' ) }</VisuallyHidden>
							) : null }
							{ ( blank || ! canPreview ) && ! isStarting && ! loadingStage ? (
								<div className={ styles.emptyContent }>
									<SiteToolLauncher
										site={ site }
										actions={ tools }
										live={ live }
										active={ ! collapsed && ! inactive }
									/>
								</div>
							) : null }
						</div>
					</SiteContextMenu>
					{ ( focused || ownsNote ) && ! inactive && ! blank && canAnnotateSurface ? (
						<AnnotationOverlay
							siteId={ site.id }
							anchor={ ownsNote ? annotationAnchor : null }
							onSend={ sendAnnotations }
							onEscape={ escapeDraft }
							listenForEscape={ focused }
						/>
					) : null }
				</div>
			</div>
		</aside>
	);
}

export function SitePreview( props: SitePreviewProps ) {
	const { mutate: startReviewSite } = useStartSite();
	const reviewStarting = useIsSiteStarting( props.site.id );
	const {
		path: hostPath,
		onPathChange: onHostPathChange,
		site: reviewSite,
		liveUrl: reviewLiveUrl,
		onStartAnnotating: onReviewStart,
	} = props;
	const { workspace, selected, add, patch, select, update, closeMany } = usePreviewTabs(
		previewTabsKey( props.site.id, props.liveUrl ),
		hostPath,
		props.site.id
	);
	const tabSplit = getPreviewTabSplit( workspace );
	const [ annotationTool, setAnnotationTool ] = useState< AnnotationTool >( 'select' );
	const [ browserHeaderTarget, setBrowserHeaderTarget ] = useState< HTMLDivElement | null >( null );
	const firstId = tabSplit?.tabIds[ 0 ];
	const annotationHostId =
		tabSplit?.tabIds.find( ( id ) => {
			const tab = workspace.tabs.find( ( tab ) => tab.id === id );
			return tab?.path != null && getPreviewRealm( tab.path ) !== 'database';
		} ) ?? firstId;
	const resizeSplit = ( weights: number[] ) => {
		update( ( current ) => ( {
			...current,
			splits: current.splits.map( ( item ) =>
				item.tabIds[ 0 ] === firstId && item.tabIds.length === weights.length
					? { ...item, weights }
					: item
			),
		} ) );
	};
	const {
		rootRef: root,
		panesRef,
		splitVisible,
		isResizing,
		sizes,
		style,
		handleProps,
	} = useTabSplit( {
		split: tabSplit,
		selectedId: selected.id,
		onResize: resizeSplit,
		collapsed: props.collapsed,
	} );
	const siteUrl = reviewLiveUrl ?? getSiteUrl( reviewSite );
	const annotations = useSiteAnnotations( reviewSite.id );
	const [ annotationControls, setAnnotationControls ] = useState(
		() => new Map< string, PaneAnnotationControls >()
	);
	const registerAnnotationControls = useCallback(
		( paneId: string, controls: PaneAnnotationControls ) => {
			setAnnotationControls( ( current ) => new Map( current ).set( paneId, controls ) );
			return () =>
				setAnnotationControls( ( current ) => {
					const next = new Map( current );
					next.delete( paneId );
					return next;
				} );
		},
		[]
	);
	const activeControls = annotationControls.get( workspace.selectedId );
	const pageControls = activeControls?.pageTools
		? activeControls
		: Array.from( annotationControls.values() ).find( ( controls ) => controls.pageTools );

	const annotationPaneById = useMemo( () => {
		const visibleIds = tabSplit?.tabIds ?? [ selected.id ];
		const visibleTabs = workspace.tabs.filter( ( tab ) => visibleIds.includes( tab.id ) );
		const owners = new Map< string, string >();
		for ( const note of annotations.notes ) {
			const owner = workspace.tabs.find( ( tab ) => tab.id === note.previewPaneId );
			if ( owner ) {
				owners.set( note.id, owner.id );
				continue;
			}
			const path = getAnnotationPreviewPath( note, siteUrl ).split( /[?#]/ )[ 0 ];
			const fallback = visibleTabs.find( ( tab ) => tab.path?.split( /[?#]/ )[ 0 ] === path );
			owners.set( note.id, fallback?.id ?? visibleTabs[ 0 ]?.id ?? selected.id );
		}
		return owners;
	}, [ annotations.notes, selected.id, siteUrl, tabSplit?.tabIds, workspace.tabs ] );
	const openLinkInTab = useCallback(
		( url: string ) => {
			const path = getPathFromPreviewUrl( url, siteUrl );
			if ( path ) add( path, { background: true } );
		},
		[ add, siteUrl ]
	);
	useEffect(
		() =>
			subscribePreviewOpenLink( ( _event, { guestId, url, split } ) => {
				if ( props.collapsed ) return;
				const views = root.current?.querySelectorAll< WebviewTag >(
					'[data-visible-tab]:not([inert]) webview'
				);
				const guest = Array.from( views ?? [] ).find( ( view ) => {
					try {
						return getWebviewContentsId( view ) === guestId;
					} catch {
						return false;
					}
				} );
				const paneId =
					guest?.closest< HTMLElement >( '[data-preview-pane-id]' )?.dataset.previewPaneId;
				if ( ! paneId ) return;
				if ( ! split ) {
					openLinkInTab( url );
					return;
				}
				const path = getPathFromPreviewUrl( url, siteUrl );
				if ( path ) add( path, { splitBeside: paneId } );
			} ),
		[ add, openLinkInTab, props.collapsed, root, siteUrl ]
	);

	const stopping = useIsSiteStopping( props.site.id );
	const operation = useSiteOperation( props.site );
	useLayoutEffect( () => {
		if ( ! props.liveUrl && ! stopping && operation !== 'stop' && selected.path === null ) {
			patch( selected.id, { path: '/', title: null } );
		}
	}, [ props.liveUrl, stopping, operation, selected.id, selected.path, patch ] );

	const [ observed, setObserved ] = useState< {
		host: string;
		selectedId: string;
		forwarded: string | null;
	} >( { host: hostPath, selectedId: workspace.selectedId, forwarded: null } );
	const lastFocusRequest = useRef( workspace.focusRequest );
	useEffect( () => {
		if ( props.collapsed || ! splitVisible ) return;
		let timer: ReturnType< typeof setTimeout >;
		const activate = () => {
			const element = document.activeElement;
			const pane =
				element instanceof HTMLElement
					? element.closest< HTMLElement >( '[data-visible-tab]' )
					: null;
			if ( pane?.dataset.previewPaneId && root.current?.contains( pane ) && ! props.collapsed ) {
				const paneId = pane.dataset.previewPaneId;
				if ( paneId !== workspace.selectedId ) select( paneId );
				return element?.matches( 'iframe, webview' ) ?? false;
			}
			return false;
		};
		// Focus inside an iframe or webview leaves the host document. Its active
		// element identifies the pane; moving between guests need not blur again.
		const followEmbeddedFocus = () => {
			if ( ! document.hidden && activate() ) timer = setTimeout( followEmbeddedFocus, 100 );
		};
		const onBlur = () => {
			clearTimeout( timer );
			timer = setTimeout( followEmbeddedFocus, 0 );
		};
		window.addEventListener( 'blur', onBlur );
		document.addEventListener( 'focusin', activate );
		document.addEventListener( 'visibilitychange', onBlur );
		onBlur();
		return () => {
			clearTimeout( timer );
			window.removeEventListener( 'blur', onBlur );
			document.removeEventListener( 'focusin', activate );
			document.removeEventListener( 'visibilitychange', onBlur );
		};
	}, [ select, root, props.collapsed, workspace.selectedId, splitVisible ] );
	const externalNavigation =
		observed.host !== hostPath &&
		observed.forwarded !== hostPath &&
		observed.selectedId === workspace.selectedId;
	useEffect( () => {
		update( ( current ) => current );
	}, [ update ] );
	useLayoutEffect( () => {
		if ( observed.selectedId !== workspace.selectedId ) {
			const path = selected.path ?? '/';
			setObserved( { host: hostPath, selectedId: workspace.selectedId, forwarded: path } );
			onHostPathChange?.( path );
		} else if ( observed.host !== hostPath ) {
			setObserved( { host: hostPath, selectedId: workspace.selectedId, forwarded: null } );
			if ( observed.forwarded !== hostPath ) {
				patch( workspace.selectedId, { path: hostPath, title: null } );
			}
		}
	}, [ hostPath, onHostPathChange, workspace.selectedId, selected.path, patch, observed ] );

	useEffect( () => {
		if ( lastFocusRequest.current === workspace.focusRequest ) return;
		lastFocusRequest.current = workspace.focusRequest;
		if ( props.collapsed ) return;
		const frame = requestAnimationFrame( () => {
			root.current
				?.closest( 'main' )
				?.querySelector< HTMLElement >( '[data-preview-tabs] [role="tab"][aria-selected="true"]' )
				?.focus();
		} );
		return () => cancelAnimationFrame( frame );
	}, [ workspace.focusRequest, props.collapsed, root ] );

	const navigate = useCallback(
		( id: string, path: string ) => {
			patch( id, { path, title: null } );
			if ( id === workspace.selectedId ) {
				setObserved( ( current ) => ( { ...current, forwarded: path } ) );
				onHostPathChange?.( path );
			}
		},
		[ patch, workspace.selectedId, onHostPathChange ]
	);
	useEffect( () => {
		if ( reviewLiveUrl ) return;
		return subscribeAnnotationReview( reviewSite.id, ( id ) => {
			const requested = getSiteAnnotations( reviewSite.id ).notes.find(
				( note ) => note.id === id
			);
			if ( ! requested || onReviewStart?.() === false ) return;
			const accepted = editAnnotation( reviewSite.id, id );
			const current = getSiteAnnotations( reviewSite.id );
			const note = accepted
				? requested
				: current.notes.find( ( note ) => note.id === current.editingId );
			if ( ! note ) return;
			const path = getAnnotationPreviewPath( note, siteUrl );
			const owner = workspace.tabs.find( ( tab ) => tab.id === note.previewPaneId );
			const match = owner ?? workspace.tabs.find( ( tab ) => tab.path === path );
			const tabId = match?.id ?? workspace.selectedId;
			if ( match ) select( tabId );
			if ( match?.path !== path ) navigate( tabId, path );
			setAnnotating( reviewSite.id, true );
			if ( ! reviewSite.running && ! reviewStarting )
				startReviewSite( reviewSite.id, {
					onError: () => setAnnotating( reviewSite.id, false ),
				} );
		} );
	}, [
		reviewSite,
		reviewLiveUrl,
		onReviewStart,
		workspace,
		siteUrl,
		select,
		navigate,
		reviewStarting,
		startReviewSite,
	] );
	// Moving an iframe or webview can reload or disconnect it, so keep panes in a stable order.
	const previewPanes = [ ...workspace.tabs ].sort( ( a, b ) => a.id.localeCompare( b.id ) );
	return (
		<div
			ref={ root }
			className={ styles.tabWorkspace }
			style={ style }
			data-preview-workspace={ previewTabsKey( props.site.id, props.liveUrl ) }
			data-split-view={ splitVisible || undefined }
			data-resizing={ isResizing || undefined }
			role={ splitVisible ? 'group' : undefined }
			aria-label={ splitVisible ? __( 'Split view' ) : undefined }
		>
			<div
				ref={ setBrowserHeaderTarget }
				className={ styles.sharedBrowserHeader }
				data-preview-shared-header
			/>
			<div ref={ panesRef } className={ styles.tabPanes }>
				<AnnotationTools
					visible={ ! props.collapsed && annotations.active && annotationControls.size > 0 }
					drawing={ annotationTool === 'draw' }
					pageTools={ !! pageControls }
					disabled={ isAnnotationsBusy( annotations ) }
					onToggle={ () =>
						pageControls?.selectTool( annotationTool === 'draw' ? 'select' : 'draw' )
					}
					onDiscard={ () => discardAnnotations( reviewSite.id ) }
				/>
				{ previewPanes.map( ( tab ) => {
					const paneId = tab.id;
					const focused = paneId === workspace.selectedId;
					const inTabSplit = !! getPreviewTabSplit( workspace, tab.id );
					const paneIndex = tabSplit?.tabIds.indexOf( paneId ) ?? -1;
					const inSplit = paneIndex >= 0;
					const visible = paneId === workspace.selectedId || inSplit;
					const hidden = ! visible || sizes?.[ paneIndex ] === 0;
					const activate = ( event?: { currentTarget: HTMLElement; target: EventTarget } ) => {
						if ( hidden || props.collapsed ) return;
						// Shared controls are portaled outside the pane and should not change focus.
						if ( event && ! event.currentTarget.contains( event.target as Node ) ) return;
						select( tab.id );
					};
					return (
						<div
							key={ paneId }
							className={ styles.tabPane }
							data-active-tab={ focused || undefined }
							data-preview-pane-id={ paneId }
							data-visible-tab={ visible || undefined }
							data-split-pane={ inSplit || undefined }
							data-split-start={ paneId === tabSplit?.tabIds[ 0 ] || undefined }
							data-split-end={ paneId === tabSplit?.tabIds.at( -1 ) || undefined }
							style={ inSplit ? { gridColumn: paneIndex + 1 } : undefined }
							onPointerDownCapture={ activate }
							onFocusCapture={ activate }
							aria-hidden={ hidden || undefined }
							inert={ hidden }
						>
							<SitePreviewContent
								{ ...props }
								tabId={ tab.id }
								focused={ focused }
								split={ inSplit }
								annotationHost={ paneId === annotationHostId }
								annotationTool={ annotationTool }
								annotationPaneById={ annotationPaneById }
								registerAnnotationControls={ registerAnnotationControls }
								onAnnotationToolChange={ setAnnotationTool }
								sharedHeaderTarget={ inTabSplit ? undefined : browserHeaderTarget }
								onCloseTab={
									tabSplit?.tabIds.includes( tab.id )
										? () => closeMany( [ tab.id ], { focus: true } )
										: undefined
								}
								paneLabel={
									inSplit
										? paneIndex === 0
											? __( 'First panel' )
											: paneIndex === 1
											? __( 'Second panel' )
											: sprintf(
													/* translators: %d: pane position in the split view. */
													__( 'Panel %d' ),
													paneIndex + 1
											  )
										: undefined
								}
								onActivate={ activate }
								onOpenLinkInTab={ openLinkInTab }
								path={
									tab.id === workspace.selectedId && externalNavigation ? hostPath : tab.path ?? '/'
								}
								inactive={ hidden }
								blank={ tab.path === null }
								collapsed={ props.collapsed || hidden }
								onPathChange={ ( path ) => navigate( tab.id, path ) }
								onThumbnail={ ( path, image ) =>
									update( ( current ) => {
										const target = current.tabs.find( ( t ) => t.id === tab.id );
										if (
											target?.path !== path ||
											( target.thumbnail?.path === path && target.thumbnail.image === image )
										)
											return current;
										return {
											...current,
											tabs: current.tabs.map( ( t ) =>
												t.id === tab.id ? { ...t, thumbnail: { path, image } } : t
											),
										};
									} )
								}
								onTitleChange={ ( title ) => patch( tab.id, { title } ) }
							/>
						</div>
					);
				} ) }
				{ splitVisible &&
					handleProps.map( ( { index, offset, resizing, ...handle } ) => (
						<div
							key={ index }
							className={ styles.splitResize }
							data-split-divider={ index }
							data-resizing={ resizing || undefined }
							style={ { '--tab-split-offset': `${ offset }px` } as CSSProperties }
						>
							<ResizeHandle
								className={ styles.splitGrip }
								label={
									handleProps.length === 1
										? __( 'Resize split view' )
										: sprintf(
												/* translators: %d: position of the divider in the split view. */
												__( 'Resize split divider %d' ),
												index + 1
										  )
								}
								{ ...handle }
							/>
						</div>
					) ) }
			</div>
			{ isResizing ? <ResizeOverlay /> : null }
		</div>
	);
}

function getAnnotationPreviewPath( note: PreviewAnnotation, siteUrl: string ) {
	return note.email
		? EMAIL_PREVIEW_PATH
		: note.targetKey && note.path === 'DESIGN.md'
		? DESIGN_SYSTEM_PREVIEW_PATH
		: ( note.url && getPathFromPreviewUrl( note.url, siteUrl ) ) || note.path || '/';
}
