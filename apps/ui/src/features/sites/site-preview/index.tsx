import { DESIGN_SYSTEM_PREVIEW_PATH } from '@studio/agent/protocol/chat-artifacts';
import { getSiteBrowserUrl } from '@studio/common/lib/user-settings/site-browser-url';
import { __ } from '@wordpress/i18n';
import { Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useConnector } from '@/data/core';
import { previewTabsKey, usePreviewTabs } from '@/data/preview-tabs';
import { useFrontendAdminBar } from '@/data/queries/use-frontend-admin-bar';
import { useGlobalStyles } from '@/data/queries/use-global-styles';
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
	isBatchedAnnotation,
	getSiteAnnotations,
	subscribeAnnotationReview,
	editAnnotation,
	type AnnotationAnchor,
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
import { VisuallyHidden } from '@/lib/ui';
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
import {
	FrameSurface,
	isElectron,
	PreviewLoadFailed,
	SurfaceLayer,
	WebviewSurface,
} from './preview-surface';
import { getFitScale } from './responsive-preview/settings';
import { ResponsiveToolbar } from './responsive-preview/toolbar';
import styles from './style.module.css';
import { getFrameKey, getSafePath, type PreviewSurfaceKey } from './surfaces';
import { useBrowserShortcuts } from './use-browser-shortcuts';
import { useLoadingStage } from './use-loading-stage';
import { usePreviewAnnotations } from './use-preview-annotations';
import { usePreviewBrowser } from './use-preview-browser';
import { usePreviewCapture } from './use-preview-capture';
import { usePreviewOpenTracks } from './use-preview-open-tracks';
import { usePreviewSurfaces } from './use-preview-surfaces';
import type { SiteDetails } from '@/data/core';
import type { InspectorEvent } from '@studio/agent/protocol/inspector/page-script';

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
	// Called when the user navigates within the preview (link clicks,
	// back/forward) so the parent can keep its `path` in sync without
	// forcing a reload.
	onPathChange?: ( path: string ) => void;
	// True while the panel is toggled off but kept mounted (so the webview
	// stays warm). Disables the global browser shortcuts in that state.
	collapsed?: boolean;
	inactive?: boolean;
	blank?: boolean;
	onTitleChange?: ( title: string | null ) => void;
}

function SitePreviewContent( {
	site,
	liveUrl,
	path,
	reloadNonce,
	onSendAnnotations,
	onStartAnnotating,
	onPathChange,
	collapsed = false,
	inactive = false,
	blank = false,
	onTitleChange,
}: SitePreviewProps ) {
	const connector = useConnector();
	const trackOpen = usePreviewOpenTracks();
	const { annotationSpace } = useSiteHeader();
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
	const globalStyles = useGlobalStyles( site );
	const annotations = useSiteAnnotations( site.id );
	// Surfaces Studio draws itself, with no page to load.
	const rendered = activeSurfaceKey === 'design' || activeSurfaceKey === 'email';
	const { loadingStage, reveal } = useLoadingStage( {
		siteId: site.id,
		live,
		canPreview,
		isStarting,
		rendered: rendered || blank,
		publish: ! inactive && ! blank,
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
			? !! globalStyles.data
			: activeSurfaceKey === 'email' || !! activeSurface?.inspectorReady );
	const viewportRef = useRef< HTMLDivElement | null >( null );
	const previewBrowser = usePreviewBrowser( viewportRef );
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
	const responsiveSettings = useResponsivePreview( site.id );
	const responsiveEnabled = responsiveSettings.enabled && canPreview && activeSurfaceKey === 'site';
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
			updateResponsivePreview( site.id, {
				fitScale: getFitScale(
					viewport.clientWidth,
					viewport.clientHeight,
					responsiveSettings.width,
					responsiveSettings.height
				),
			} );
		}
	}, [
		responsiveEnabled,
		responsiveSettings,
		availableSize.width,
		availableSize.height,
		site.id,
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
		surfaceKey: activeSurfaceKey,
		canAnnotateSurface,
		viewportRef,
		onSendAnnotations,
		enabled: ! inactive,
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
	const capturePage = usePreviewCapture( site.id, siteUrl, viewportRef );
	const handleSurfaceLoad = useCallback(
		( key: PreviewSurfaceKey, url: string, guestId?: number ) => {
			reveal();
			if ( key === 'site' && ! live && ! inactive ) {
				capturePage( url, guestId );
			}
		},
		[ capturePage, live, reveal, inactive ]
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
			if ( inactive ) return;
			if ( event.type === 'browser-command' ) {
				sendBrowserCommand( event.command );
			} else {
				handleAnnotationEvent( event );
			}
		},
		[ handleAnnotationEvent, sendBrowserCommand, inactive ]
	);

	const browserShortcuts = useBrowserShortcuts(
		canPreview && ! isStarting && ! isStopping && ! collapsed,
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
			updateResponsivePreview( site.id, { enabled: ! responsiveSettings.enabled } );
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
	const batchNotes = annotations.notes.filter( isBatchedAnnotation );
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
				annotationCount: batchNotes.length,
				active: annotations.active,
				disabled:
					! canAnnotateSurface ||
					isStarting ||
					isStopping ||
					( site.running && ( blank || ! canAnnotate ) ) ||
					isAnnotationsBusy( annotations ),
				disabledReason: blank
					? __( 'Open a project page to annotate.' )
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

	const header = (
		<PreviewHeader
			inactive={ inactive }
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
		/>
	);

	return (
		<aside
			className={ styles.root }
			data-browser-bar={ showBrowserBar || undefined }
			aria-label={ __( 'Panel' ) }
		>
			{ ! inactive && annotate && annotationSpace
				? createPortal(
						<AnnotateButton { ...annotate } annotationCount={ batchNotes.length } />,
						annotationSpace
				  )
				: null }
			{ showBrowserBar && activeSurfaceKey !== 'email' ? header : null }
			{ showBrowserBar && responsiveEnabled ? (
				<ResponsiveToolbar
					siteId={ site.id }
					settings={ responsiveSettings }
					fitScale={ fitScale }
				/>
			) : null }
			<div className={ styles.body }>
				<div
					ref={ viewportRef }
					className={ styles.previewViewport }
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
											{ globalStyles.isPending ||
											( globalStyles.isFetching && ! globalStyles.data ) ? null : (
												<DesignSystemView
													siteId={ site.id }
													globalStyles={ globalStyles.data ?? null }
													error={ globalStyles.error }
													onRetry={ () => void globalStyles.refetch() }
													retrying={ globalStyles.isFetching }
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
							return (
								<SurfaceLayer
									key={ key }
									active={ active }
									responsive={
										key === 'site'
											? { siteId: site.id, settings: responsiveSettings, scale: responsiveScale }
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
											inspector={ key === 'site' && ! inactive }
											annotations={ key === 'site' && ! inactive ? annotations : undefined }
											onInspectorReady={ ( inspectorReady ) => {
												patchSurface( key, { inspectorReady } );
												if ( ! inspectorReady ) setAnnotationAnchor( null );
											} }
											onInspectorEvent={ handleInspectorEvent }
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
					{ ! inactive && ! blank && canAnnotateSurface ? (
						<AnnotationOverlay
							siteId={ site.id }
							anchor={ annotationAnchor }
							onSend={ sendAnnotations }
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
	const { workspace, selected, patch, select, update } = usePreviewTabs(
		previewTabsKey( props.site.id, props.liveUrl ),
		hostPath
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
	const root = useRef< HTMLDivElement >( null );
	const lastFocusRequest = useRef( workspace.focusRequest );
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
	}, [ workspace.focusRequest, props.collapsed ] );

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
			const path = note.email
				? EMAIL_PREVIEW_PATH
				: note.targetKey
				? DESIGN_SYSTEM_PREVIEW_PATH
				: note.path ?? '/';
			const match = workspace.tabs.find( ( tab ) => tab.path === path );
			if ( match ) select( match.id );
			else navigate( workspace.selectedId, path );
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
		workspace.tabs,
		workspace.selectedId,
		select,
		navigate,
		reviewStarting,
		startReviewSite,
	] );
	return (
		<div ref={ root } className={ styles.tabWorkspace }>
			{ workspace.tabs.map( ( tab ) => {
				const active = tab.id === workspace.selectedId;
				return (
					<div
						key={ tab.id }
						className={ styles.tabPane }
						data-active-tab={ active || undefined }
						aria-hidden={ ! active || undefined }
						inert={ ! active }
					>
						<SitePreviewContent
							{ ...props }
							path={ active && externalNavigation ? hostPath : tab.path ?? '/' }
							inactive={ ! active }
							blank={ tab.path === null }
							collapsed={ props.collapsed || ! active }
							onPathChange={ ( path ) => navigate( tab.id, path ) }
							onTitleChange={ ( title ) => patch( tab.id, { title } ) }
						/>
					</div>
				);
			} ) }
		</div>
	);
}
