import { __ } from '@wordpress/i18n';
import { Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useConnector } from '@/data/core';
import { useSiteDesign } from '@/data/queries/use-site-design';
import {
	useIsSiteStarting,
	useIsSiteStopping,
	useSiteOperation,
	useStartSite,
} from '@/data/queries/use-sites';
import { useResponsivePreview, updateResponsivePreview } from '@/data/responsive-preview';
import {
	AnnotationOverlay,
	type AnnotationAnchor,
	isAnnotationsBusy,
	setAnnotating,
	useSiteAnnotations,
} from '@/features/annotations';
import { DesignSystemView } from '@/features/sites/design-system-view';
import { getSiteUrl } from '@/features/sites/get-site-url';
import { PreviewParticles } from '@/features/sites/preview-particles';
import { useSiteHeaderNavigation } from '@/features/sites/site-header-actions';
import { SiteContextMenu, StoppedSitePreview } from '@/features/sites/stopped-site-preview';
import { VisuallyHidden } from '@/lib/ui';
import { getRealmOpenEvent } from './address-bar';
import { EMPTY_BROWSER_STATE, type BrowserNavigationState } from './browser-state';
import { PreviewHeader } from './preview-header';
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
import { usePreviewCapture } from './use-preview-capture';
import { usePreviewSurfaces } from './use-preview-surfaces';
import type { SiteDetails } from '@/data/core';
import type { InspectorEvent } from '@studio/agent/protocol/inspector/page-script';

interface SitePreviewProps {
	site: SiteDetails;
	fullscreen?: { active: boolean; onClick: () => void };
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
}

export function SitePreview( {
	site,
	fullscreen,
	liveUrl,
	path,
	reloadNonce,
	onSendAnnotations,
	onStartAnnotating,
	onPathChange,
	collapsed = false,
}: SitePreviewProps ) {
	const connector = useConnector();
	const startSite = useStartSite();
	const operation = useSiteOperation( site );
	const startPending = useIsSiteStarting( site.id );
	const stopPending = useIsSiteStopping( site.id );
	const live = !! liveUrl;
	// This window's own start or stop lands before the CLI records it.
	const isStarting = ! live && ( startPending || operation === 'start' );
	const isStopping = ! live && ( stopPending || operation === 'stop' );
	const siteUrl = liveUrl ?? getSiteUrl( site );
	const canPreview = live || site.running;
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
		switchRealm,
	} = usePreviewSurfaces( { siteId: site.id, siteUrl, path: safePath, reloadNonce, onPathChange } );
	const siteDesign = useSiteDesign( site );
	const annotations = useSiteAnnotations( site.id );
	const { loadingStage, reveal } = useLoadingStage( {
		siteId: site.id,
		live,
		canPreview,
		isStarting,
		design: activeSurfaceKey === 'design',
	} );
	// Frames report no loading state, so track which load each one finished.
	const [ loadedFrames, setLoadedFrames ] = useState<
		Partial< Record< PreviewSurfaceKey, string > >
	>( {} );
	const activeFrameLoading =
		! canUseWebview &&
		!! activeSurface &&
		loadedFrames[ activeSurfaceKey ] !== getFrameKey( siteUrl, activeSurface );
	const navigating =
		canPreview && activeSurfaceKey !== 'design' && ( browserState.loading || activeFrameLoading );
	// Studio renders the design system itself, so it needs no page injection.
	const showAnnotate = ! live;
	const canAnnotateSurface =
		showAnnotate &&
		activeSurfaceKey !== 'database' &&
		( connector.capabilities.annotatePreview || activeSurfaceKey === 'design' );
	const canAnnotate =
		canAnnotateSurface &&
		( activeSurfaceKey === 'design' ? !! siteDesign.data : !! activeSurface?.inspectorReady );
	const viewportRef = useRef< HTMLDivElement | null >( null );
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
	const responsiveScale = responsiveSettings.zoom === 'fit' ? fitScale : responsiveSettings.zoom;
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
	} );
	useEffect( () => {
		setAnnotationAnchor( null );
	}, [
		responsiveSettings.width,
		responsiveSettings.height,
		responsiveEnabled,
		responsiveScale,
		availableSize.width,
		availableSize.height,
		setAnnotationAnchor,
	] );
	const capturePage = usePreviewCapture( site.id, siteUrl, viewportRef );
	const handleSurfaceLoad = useCallback(
		( key: PreviewSurfaceKey, url: string, guestId?: number ) => {
			reveal();
			if ( key === 'site' && ! live ) {
				capturePage( url, guestId );
			}
		},
		[ capturePage, live, reveal ]
	);
	const handleSurfaceBrowserState = useCallback(
		( key: PreviewSurfaceKey, browser: BrowserNavigationState ) => {
			patchSurface( key, { browser } );
			if ( browser.failed ) {
				reveal();
			}
		},
		[ patchSurface, reveal ]
	);

	// Shortcuts the guest page swallowed and forwarded back over the console
	// bridge, for the webview.
	const handleInspectorEvent = useCallback(
		( event: InspectorEvent ) => {
			if ( event.type === 'browser-command' ) {
				sendBrowserCommand( event.command );
			} else {
				handleAnnotationEvent( event );
			}
		},
		[ handleAnnotationEvent, sendBrowserCommand ]
	);

	const browserShortcuts = useBrowserShortcuts(
		canPreview && ! isStarting && ! isStopping && ! collapsed,
		sendBrowserCommand
	);

	// Matches the realm on screen (front end / WP Admin / phpMyAdmin) rather
	// than always the front end. Admin screens go through /studio-auto-login so
	// they don't land on the login form; the front end opens logged out.
	const openExternal = live
		? () => void connector.openExternalUrl( `${ siteUrl }${ safePath }` )
		: activeRealm === 'design'
		? undefined
		: () => {
				void connector.trackEvent( getRealmOpenEvent( activeRealm ), { browser: 'external' } );
				void connector
					.openSiteUrl( site.id, safePath, { autoLogin: activeRealm !== 'frontend' } )
					.catch( ( error ) => {
						console.error( 'Failed to open site in browser:', error );
					} );
		  };
	const responsive = {
		active: responsiveEnabled,
		disabled: ! canPreview || isStarting || isStopping || activeSurfaceKey !== 'site',
		onClick: () => updateResponsivePreview( site.id, { enabled: ! responsiveSettings.enabled } ),
	};
	const annotate = showAnnotate
		? {
				active: annotations.active,
				disabled:
					! canAnnotateSurface ||
					isStarting ||
					isStopping ||
					( site.running && ! canAnnotate ) ||
					isAnnotationsBusy( annotations ),
				disabledReason:
					activeSurfaceKey === 'database'
						? __( 'Not available for Database' )
						: ! canAnnotateSurface
						? __( 'Site annotation is not available in the browser yet' )
						: undefined,
				onClick: () => {
					if ( ! annotations.active && onStartAnnotating?.() === false ) return;
					setAnnotating( site.id, ! annotations.active );
					if ( ! site.running ) {
						startSite.mutate( site.id, {
							onError: () => setAnnotating( site.id, false ),
						} );
					}
				},
		  }
		: undefined;
	useSiteHeaderNavigation( ! collapsed ? { annotate } : null );

	const header = (
		<PreviewHeader
			site={ site }
			siteUrl={ siteUrl }
			path={ safePath }
			live={ live }
			canPreview={ canPreview }
			isStarting={ isStarting }
			isStopping={ isStopping }
			browserState={ browserState }
			shortcuts={ browserShortcuts }
			onBrowserCommand={ sendBrowserCommand }
			onJump={ goToHistoryIndex }
			onPathChange={ onPathChange }
			onSwitchRealm={ switchRealm }
			hasDesignSystem={ !! siteDesign.data }
			onOpenExternal={ openExternal }
			responsive={ responsive }
			fullscreen={ fullscreen }
		/>
	);

	return (
		<aside className={ styles.root } aria-label={ __( 'Site preview' ) }>
			{ canPreview || isStarting || isStopping || fullscreen ? header : null }
			{ responsiveEnabled ? (
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
					{ canPreview &&
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
													siteId={ site.id }
													siteDesign={ siteDesign.data ?? null }
													onAnnotationPick={ handleAnnotationPick }
													onAnnotationAnchor={ ( anchor: AnnotationAnchor ) =>
														setAnnotationAnchor( toViewportAnchor( anchor ) )
													}
												/>
											) }
										</Suspense>
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
								>
									{ canUseWebview ? (
										<WebviewSurface
											key={ `${ site.id }-${ key }` }
											url={ surfaceUrl }
											reloadNonce={ surface.reloadNonce }
											// phpMyAdmin isn't an annotation target, so the
											// inspector never goes near it.
											inspector={ key === 'site' }
											annotations={ key === 'site' ? annotations : undefined }
											onInspectorReady={ ( inspectorReady ) => {
												patchSurface( key, { inspectorReady } );
												if ( ! inspectorReady ) setAnnotationAnchor( null );
											} }
											onInspectorEvent={ handleInspectorEvent }
											browserCommand={ surface.browserCommand }
											onBrowserStateChange={ ( state ) => handleSurfaceBrowserState( key, state ) }
											onNavigate={ ( url ) => handleSurfaceNavigation( key, url ) }
											onLoad={ ( url, guestId ) => handleSurfaceLoad( key, url, guestId ) }
										/>
									) : (
										<FrameSurface
											key={ frameKey }
											src={ surfaceUrl }
											title={ site.name }
											onLoad={ ( src ) => {
												setLoadedFrames( ( frames ) => ( { ...frames, [ key ]: frameKey } ) );
												handleSurfaceNavigation( key, src );
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
							<PreviewParticles active={ loadingStage } showLogo={ loadingStage } />
							{ loadingStage || navigating ? (
								<VisuallyHidden role="status">{ __( 'Loading site preview' ) }</VisuallyHidden>
							) : null }
							{ canPreview ? null : (
								<div className={ styles.emptyContent }>
									{ isStarting ? null : <StoppedSitePreview site={ site } showStartButton /> }
								</div>
							) }
						</div>
					</SiteContextMenu>
					{ canAnnotateSurface ? (
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
