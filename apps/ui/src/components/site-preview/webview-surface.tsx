/**
 * Renders the site preview as an Electron `<webview>` tag and hosts the
 * guest side of the clip layer.
 *
 * The shared inspector page script (`@studio/common/inspector`) is injected
 * after each load. Guest events arrive over the console bridge; commands go
 * back in as CustomEvents. Clip requests land here as raw captures — this
 * component owns the capture/crop pipeline (hide overlay, screenshot,
 * crop) and hands finished `RawClipCapture`s up to `SitePreview`, which
 * decorates them with preview context before they become composer clips.
 */

import {
	buildInspectorCommandScript,
	buildInspectorPageScript,
	parseInspectorGuestEvent,
	type AgentMarker,
	type ClipMarker,
	type ClipViewportRect,
	type InspectorConfig,
	type InspectorHostCommand,
} from '@studio/common/inspector';
import { __ } from '@wordpress/i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import {
	cropViewportCapture,
	isFiniteNumber,
	localMediaFileToDataUrl,
	localMediaFileToFile,
	padRectWithinViewport,
	sanitizeViewportRect,
} from './capture';
import { getPreviewConsoleLevelFromWebviewLevel } from './console-utils';
import styles from './style.module.css';
import type { PreviewConsoleEntry, RawClipCapture } from './types';
import type { CSSProperties } from 'react';

// The inspector features the app preview runs with. The CLI's annotation
// browser uses the same script with a different config (see apps/cli).
const APP_INSPECTOR_FEATURES: InspectorConfig[ 'features' ] = {
	elementClips: true,
	regionClips: true,
	pageClips: true,
	loupe: true,
	contextMenu: true,
	browserShortcuts: true,
	submitToolbar: false,
};

export interface BrowserNavigationState {
	canGoBack: boolean;
	canGoForward: boolean;
	loading: boolean;
	progress: number;
	title: string | null;
}

export const EMPTY_BROWSER_STATE: BrowserNavigationState = {
	canGoBack: false,
	canGoForward: false,
	loading: false,
	progress: 0,
	title: null,
};

export type BrowserShortcutCommandType = 'back' | 'forward' | 'reload';

export interface BrowserCommand {
	id: number;
	type: BrowserShortcutCommandType;
}

/** Layer status mirrored from the guest for host chrome. */
export interface InspectorState {
	ready: boolean;
	active: boolean;
	pinned: boolean;
	zoom: number;
	clipCount: number;
}

export const EMPTY_INSPECTOR_STATE: InspectorState = {
	ready: false,
	active: false,
	pinned: false,
	zoom: 3,
	clipCount: 0,
};

export interface InspectorCommandRequest {
	id: number;
	command: InspectorHostCommand;
}

/** One-shot page-clip trigger (toolbar menu); bumped id fires the capture. */
export interface PageClipRequest {
	id: number;
}

export type PreviewColorScheme = 'light' | 'dark';

// A simulated guest viewport: the page lays out at `width`×`height` CSS px
// and its rendering is scaled by `scale` to fit the preview pane.
export interface PreviewViewport {
	width: number;
	height: number;
	scale: number;
}

interface PreviewWindow extends Window {
	ipcApi?: {
		setWebviewColorScheme?: (
			webContentsId: number,
			colorScheme: PreviewColorScheme
		) => Promise< void >;
		setWebviewViewport?: (
			webContentsId: number,
			viewport: PreviewViewport | null
		) => Promise< void >;
	};
}

// Electron's `<webview>` is a custom element with non-standard methods. Type
// just the surface we use so this file compiles without an `electron` dep.
export interface WebviewTag extends HTMLElement {
	loadURL( url: string ): Promise< void >;
	executeJavaScript( code: string, userGesture?: boolean ): Promise< unknown >;
	canGoBack?(): boolean;
	canGoForward?(): boolean;
	getWebContentsId?(): number;
	goBack?(): void;
	goForward?(): void;
	reload?(): void;
	isLoading?(): boolean;
}

interface WebviewConsoleEvent extends Event {
	level: number;
	message: string;
	sourceId?: string;
	line?: number;
}

interface WebviewPageTitleUpdatedEvent extends Event {
	title?: string;
}

export function getWebviewContentsId( webview: WebviewTag ): number {
	const webContentsId = webview.getWebContentsId?.();
	if ( ! webContentsId ) {
		throw new Error( 'Preview webview is not ready.' );
	}
	return webContentsId;
}

export async function applyWebviewColorScheme(
	webview: WebviewTag,
	colorScheme: PreviewColorScheme
): Promise< void > {
	const { ipcApi } = window as PreviewWindow;
	await ipcApi?.setWebviewColorScheme?.( getWebviewContentsId( webview ), colorScheme );
}

export async function applyWebviewViewport(
	webview: WebviewTag,
	viewport: PreviewViewport | null
): Promise< void > {
	const { ipcApi } = window as PreviewWindow;
	await ipcApi?.setWebviewViewport?.( getWebviewContentsId( webview ), viewport );
}

function safeWebviewBoolean( webview: WebviewTag | null, method: 'canGoBack' | 'canGoForward' ) {
	try {
		return typeof webview?.[ method ] === 'function' ? Boolean( webview[ method ]!() ) : false;
	} catch {
		return false;
	}
}

function safeWebviewIsLoading( webview: WebviewTag | null, fallback: boolean ) {
	try {
		return typeof webview?.isLoading === 'function' ? webview.isLoading!() : fallback;
	} catch {
		return fallback;
	}
}

function normalizeDocumentTitle( value: unknown ) {
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function areBrowserStatesEqual( a: BrowserNavigationState, b: BrowserNavigationState ) {
	return (
		a.canGoBack === b.canGoBack &&
		a.canGoForward === b.canGoForward &&
		a.loading === b.loading &&
		a.progress === b.progress &&
		a.title === b.title
	);
}

function isBrowserShortcutCommand( command: unknown ): command is BrowserShortcutCommandType {
	return command === 'back' || command === 'forward' || command === 'reload';
}

// Document-coordinate anchor of a loupe backdrop capture (the guest's
// scroll position and viewport size when it asked for the capture).
interface LoupeCaptureAnchor {
	docX: number;
	docY: number;
	width: number;
	height: number;
}

function getLoupeCaptureAnchor( parsed: Record< string, unknown > ): LoupeCaptureAnchor | null {
	const { docX, docY, width, height } = parsed;
	if ( ! [ docX, docY, width, height ].every( isFiniteNumber ) ) {
		return null;
	}
	if ( ( width as number ) <= 0 || ( height as number ) <= 0 ) {
		return null;
	}
	return {
		docX: docX as number,
		docY: docY as number,
		width: width as number,
		height: height as number,
	};
}

const ELEMENT_CLIP_PADDING = 8;

export interface WebviewSurfaceProps {
	url: string;
	reloadNonce: number;
	onInspectorState?: ( state: InspectorState ) => void;
	onConsoleEntry?: ( entry: PreviewConsoleEntry ) => void;
	inspectorCommand?: InspectorCommandRequest | null;
	browserCommand?: BrowserCommand | null;
	onBrowserStateChange?: ( state: BrowserNavigationState ) => void;
	onBrowserCommand?: ( type: BrowserShortcutCommandType ) => void;
	onNavigate?: ( url: string ) => void;
	colorScheme: PreviewColorScheme;
	// Simulated guest viewport, or null for the webview's natural size.
	viewport?: PreviewViewport | null;
	// Letterbox sizing for a simulated viewport narrower than the pane.
	surfaceStyle?: CSSProperties;
	// Existing clips, mirrored into the guest as numbered markers.
	clipMarkers?: ClipMarker[];
	// Agent-placed highlights, mirrored into the guest overlay.
	agentMarkers?: AgentMarker[];
	// Bump to capture a page clip from host chrome (overflow menu).
	pageClipRequest?: PageClipRequest | null;
	// Finished captures and guest-initiated clip edits.
	onClipCapture?: ( capture: RawClipCapture ) => void | Promise< void >;
	onClipUpdate?: ( id: string, comment: string ) => void;
	onClipRemove?: ( id: string ) => void;
	onTextSelection?: ( text: string, pathname: string ) => void;
}

export function WebviewSurface( {
	url,
	reloadNonce,
	onInspectorState,
	onConsoleEntry,
	inspectorCommand,
	browserCommand,
	onBrowserStateChange,
	onBrowserCommand,
	onNavigate,
	colorScheme,
	viewport = null,
	surfaceStyle,
	clipMarkers,
	agentMarkers,
	pageClipRequest,
	onClipCapture,
	onClipUpdate,
	onClipRemove,
	onTextSelection,
}: WebviewSurfaceProps ) {
	const connector = useConnector();
	const ref = useRef< HTMLElement | null >( null );
	const [ ready, setReady ] = useState( false );
	const onInspectorStateRef = useRef( onInspectorState );
	const onConsoleEntryRef = useRef( onConsoleEntry );
	const onBrowserStateChangeRef = useRef( onBrowserStateChange );
	const onBrowserCommandRef = useRef( onBrowserCommand );
	const onNavigateRef = useRef( onNavigate );
	const onClipCaptureRef = useRef( onClipCapture );
	const onClipUpdateRef = useRef( onClipUpdate );
	const onClipRemoveRef = useRef( onClipRemove );
	const onTextSelectionRef = useRef( onTextSelection );
	const browserStateRef = useRef< BrowserNavigationState >( EMPTY_BROWSER_STATE );
	const domReadyRef = useRef( false );
	const currentUrlRef = useRef( url );
	const lastReloadNonceRef = useRef( reloadNonce );
	const consoleEntryIdRef = useRef( 0 );
	const progressTimerRef = useRef< ReturnType< typeof setInterval > | null >( null );
	const progressResetTimerRef = useRef< ReturnType< typeof setTimeout > | null >( null );
	useEffect( () => {
		onInspectorStateRef.current = onInspectorState;
	}, [ onInspectorState ] );
	useEffect( () => {
		onConsoleEntryRef.current = onConsoleEntry;
	}, [ onConsoleEntry ] );
	useEffect( () => {
		onBrowserStateChangeRef.current = onBrowserStateChange;
	}, [ onBrowserStateChange ] );
	useEffect( () => {
		onBrowserCommandRef.current = onBrowserCommand;
	}, [ onBrowserCommand ] );
	useEffect( () => {
		onNavigateRef.current = onNavigate;
	}, [ onNavigate ] );
	useEffect( () => {
		onClipCaptureRef.current = onClipCapture;
	}, [ onClipCapture ] );
	useEffect( () => {
		onClipUpdateRef.current = onClipUpdate;
	}, [ onClipUpdate ] );
	useEffect( () => {
		onClipRemoveRef.current = onClipRemove;
	}, [ onClipRemove ] );
	useEffect( () => {
		onTextSelectionRef.current = onTextSelection;
	}, [ onTextSelection ] );
	const colorSchemeRef = useRef( colorScheme );
	useEffect( () => {
		colorSchemeRef.current = colorScheme;
	}, [ colorScheme ] );
	const viewportRef = useRef( viewport );
	useEffect( () => {
		viewportRef.current = viewport;
	}, [ viewport ] );
	const clipMarkersRef = useRef( clipMarkers );
	useEffect( () => {
		clipMarkersRef.current = clipMarkers;
	}, [ clipMarkers ] );
	const agentMarkersRef = useRef( agentMarkers );
	useEffect( () => {
		agentMarkersRef.current = agentMarkers;
	}, [ agentMarkers ] );

	const runInGuest = useCallback( ( webview: WebviewTag, script: string ) => {
		// Normalize sync throws (e.g. a webview that isn't attached yet, or a
		// non-Electron environment) into rejections so callers' `.catch`es
		// actually catch them.
		try {
			return Promise.resolve( webview.executeJavaScript( script, false ) );
		} catch ( error ) {
			return Promise.reject( error );
		}
	}, [] );

	const syncClipMarkers = useCallback(
		( webview: WebviewTag ) => {
			runInGuest(
				webview,
				buildInspectorCommandScript( {
					type: 'sync-clips',
					clips: clipMarkersRef.current ?? [],
				} )
			).catch( () => undefined );
		},
		[ runInGuest ]
	);
	const syncAgentMarkers = useCallback(
		( webview: WebviewTag ) => {
			runInGuest(
				webview,
				buildInspectorCommandScript( {
					type: 'agent-markers',
					markers: agentMarkersRef.current ?? [],
				} )
			).catch( () => undefined );
		},
		[ runInGuest ]
	);

	// Push marker updates whenever either set changes.
	useEffect( () => {
		if ( ! ready ) return;
		const webview = ref.current as WebviewTag | null;
		if ( ! webview ) return;
		syncClipMarkers( webview );
	}, [ clipMarkers, ready, syncClipMarkers ] );
	useEffect( () => {
		if ( ! ready ) return;
		const webview = ref.current as WebviewTag | null;
		if ( ! webview ) return;
		syncAgentMarkers( webview );
	}, [ agentMarkers, ready, syncAgentMarkers ] );

	// The CDP metrics override persists across navigations, so it only needs
	// applying when the simulated viewport changes (or on the first dom-ready
	// after one was requested). The `applied` ref skips the initial clear so
	// plain previews don't pay for an emulation round-trip.
	const appliedViewportRef = useRef( false );
	useEffect( () => {
		if ( ! ready ) return;
		if ( ! viewport && ! appliedViewportRef.current ) return;
		const webview = ref.current as WebviewTag | null;
		if ( ! webview ) return;
		appliedViewportRef.current = Boolean( viewport );
		void applyWebviewViewport( webview, viewport ).catch( () => undefined );
	}, [ viewport, ready ] );

	useEffect( () => {
		if ( ! ready ) return;
		const webview = ref.current as WebviewTag | null;
		if ( ! webview ) return;
		void applyWebviewColorScheme( webview, colorScheme )
			// An engaged loupe holds a capture of the old scheme; nudge it to
			// request a fresh one (no-op while the loupe is idle).
			.then( () =>
				runInGuest( webview, buildInspectorCommandScript( { type: 'refresh-backdrop' } ) )
			)
			.catch( () => undefined );
	}, [ colorScheme, ready, runInGuest ] );

	/* ------------------------------------------------------------------
	 * Captures. All go through the same discipline: ask the guest to hide
	 * its overlay (so captures never photograph the inspector itself),
	 * screenshot, then un-hide. `captureChainRef` serializes them so two
	 * quick clips can't interleave their hide/unhide phases.
	 * ---------------------------------------------------------------- */
	const captureChainRef = useRef< Promise< unknown > >( Promise.resolve() );
	const enqueueCapture = useCallback( ( task: () => Promise< void > ) => {
		const next = captureChainRef.current.then( task, task );
		captureChainRef.current = next;
		return next;
	}, [] );

	const withHiddenOverlay = useCallback(
		async ( webview: WebviewTag, task: () => Promise< void > ) => {
			await runInGuest(
				webview,
				'window.__studioInspectorPrepareCapture && window.__studioInspectorPrepareCapture();'
			).catch( () => undefined );
			try {
				await task();
			} finally {
				runInGuest(
					webview,
					'window.__studioInspectorFinishCapture && window.__studioInspectorFinishCapture();'
				).catch( () => undefined );
			}
		},
		[ runInGuest ]
	);

	const captureViewportCrop = useCallback(
		async ( webview: WebviewTag, rect: ClipViewportRect, fileName: string ) => {
			const capture = await connector.captureSiteScreenshot( getWebviewContentsId( webview ), {
				colorScheme: colorSchemeRef.current,
				area: 'viewport',
			} );
			// Under viewport simulation the guest's CSS width is the emulated
			// width, not the webview element's.
			return cropViewportCapture(
				capture,
				rect,
				viewportRef.current?.width ?? webview.offsetWidth,
				fileName
			);
		},
		[ connector ]
	);

	const captureElementClip = useCallback(
		( webview: WebviewTag, clip: Record< string, unknown > ) =>
			enqueueCapture( () =>
				withHiddenOverlay( webview, async () => {
					try {
						const boundingBox = sanitizeViewportRect( clip.boundingBox );
						if ( ! boundingBox ) return;
						const padded = padRectWithinViewport( boundingBox, ELEMENT_CLIP_PADDING, {
							width: viewportRef.current?.width ?? webview.offsetWidth,
							height: viewportRef.current?.height ?? webview.offsetHeight,
						} );
						const file = padded
							? await captureViewportCrop( webview, padded, 'clip-element.jpg' )
							: null;
						await onClipCaptureRef.current?.( {
							grain: 'element',
							image: file ?? undefined,
							comment: typeof clip.comment === 'string' ? clip.comment : '',
							target: clip.target as RawClipCapture[ 'target' ],
							documentRect: clip.documentRect as RawClipCapture[ 'documentRect' ],
							url: typeof clip.url === 'string' ? clip.url : undefined,
							pathname: typeof clip.pathname === 'string' ? clip.pathname : undefined,
						} );
					} catch ( error ) {
						console.error( 'Failed to add element clip:', error );
						toast.error( __( 'Clip could not be added.' ) );
					}
				} )
			),
		[ captureViewportCrop, enqueueCapture, withHiddenOverlay ]
	);

	const captureRegionClip = useCallback(
		( webview: WebviewTag, clip: Record< string, unknown > ) =>
			enqueueCapture( () =>
				withHiddenOverlay( webview, async () => {
					try {
						const rect = sanitizeViewportRect( clip.rect );
						if ( ! rect ) return;
						const file = await captureViewportCrop( webview, rect, 'clip-region.jpg' );
						if ( ! file ) {
							throw new Error( 'Region crop produced no image.' );
						}
						await onClipCaptureRef.current?.( {
							grain: 'region',
							image: file,
							documentRect: clip.documentRect as RawClipCapture[ 'documentRect' ],
							zoom: isFiniteNumber( clip.zoom ) ? clip.zoom : 1,
							coveredTag: typeof clip.coveredTag === 'string' ? clip.coveredTag : undefined,
							coveredSelector:
								typeof clip.coveredSelector === 'string' ? clip.coveredSelector : undefined,
							url: typeof clip.url === 'string' ? clip.url : undefined,
							pathname: typeof clip.pathname === 'string' ? clip.pathname : undefined,
						} );
					} catch ( error ) {
						console.error( 'Failed to add region clip:', error );
						toast.error( __( 'Clip could not be added.' ) );
					}
				} )
			),
		[ captureViewportCrop, enqueueCapture, withHiddenOverlay ]
	);

	const capturePageClip = useCallback(
		( webview: WebviewTag ) =>
			enqueueCapture( () =>
				withHiddenOverlay( webview, async () => {
					try {
						const capture = await connector.captureSiteScreenshot(
							getWebviewContentsId( webview ),
							{ colorScheme: colorSchemeRef.current }
						);
						await onClipCaptureRef.current?.( {
							grain: 'page',
							image: localMediaFileToFile( capture ),
							url: currentUrlRef.current,
						} );
					} catch ( error ) {
						console.error( 'Failed to add page clip:', error );
						toast.error( __( 'Clip could not be added.' ) );
					}
				} )
			),
		[ connector, enqueueCapture, withHiddenOverlay ]
	);

	// Loupe backdrop captures: serialized so rapid zoom/scroll requests
	// never overlap; only the newest request queued while busy survives.
	// The visible viewport is captured whole (DevTools clips silently fail
	// for webview guests) and pushed into the guest as a data URL anchored
	// at the guest's request-time scroll position.
	const loupeCaptureBusyRef = useRef( false );
	const loupeCapturePendingRef = useRef< LoupeCaptureAnchor | null >( null );
	// Last zoom the guest reported; reseeded into fresh documents on dom-ready.
	const lastLoupeZoomRef = useRef< number | null >( null );
	const pushLoupeBackdrop = useCallback(
		async ( webview: WebviewTag, firstAnchor: LoupeCaptureAnchor ) => {
			if ( loupeCaptureBusyRef.current ) {
				loupeCapturePendingRef.current = firstAnchor;
				return;
			}
			loupeCaptureBusyRef.current = true;
			let anchor: LoupeCaptureAnchor | null = firstAnchor;
			try {
				while ( anchor ) {
					loupeCapturePendingRef.current = null;
					// The lens must not photograph itself into its own backdrop:
					// the guest hides it and resolves once the hidden frame paints.
					await runInGuest(
						webview,
						'window.__studioInspectorPrepareCapture && window.__studioInspectorPrepareCapture();'
					);
					const capture = await connector.captureSiteScreenshot( getWebviewContentsId( webview ), {
						colorScheme: colorSchemeRef.current,
						area: 'viewport',
					} );
					const payload = JSON.stringify( {
						url: localMediaFileToDataUrl( capture ),
						x: anchor.docX,
						y: anchor.docY,
						width: anchor.width,
						height: anchor.height,
					} );
					// Pushing the backdrop also un-hides the overlay in the guest.
					await runInGuest(
						webview,
						`window.__studioInspectorBackdrop && window.__studioInspectorBackdrop(${ payload });`
					);
					anchor = loupeCapturePendingRef.current;
				}
			} catch {
				// Backdrop captures are cosmetic: a failure leaves the previous
				// image in place and the next scroll/zoom retries. Un-hide the
				// overlay, since no backdrop push will do it.
				runInGuest(
					webview,
					'window.__studioInspectorFinishCapture && window.__studioInspectorFinishCapture();'
				).catch( () => undefined );
			} finally {
				loupeCaptureBusyRef.current = false;
			}
		},
		[ connector, runInGuest ]
	);

	const publishBrowserState = useCallback( ( patch: Partial< BrowserNavigationState > = {} ) => {
		const webview = ref.current as WebviewTag | null;
		const canReadWebviewState = domReadyRef.current;
		const next = {
			...browserStateRef.current,
			canGoBack: canReadWebviewState
				? safeWebviewBoolean( webview, 'canGoBack' )
				: browserStateRef.current.canGoBack,
			canGoForward: canReadWebviewState
				? safeWebviewBoolean( webview, 'canGoForward' )
				: browserStateRef.current.canGoForward,
			loading: canReadWebviewState
				? safeWebviewIsLoading( webview, browserStateRef.current.loading )
				: browserStateRef.current.loading,
			...patch,
		};
		if ( areBrowserStatesEqual( browserStateRef.current, next ) ) {
			return;
		}
		browserStateRef.current = next;
		onBrowserStateChangeRef.current?.( next );
	}, [] );

	const clearProgressTimers = useCallback( () => {
		if ( progressTimerRef.current ) {
			clearInterval( progressTimerRef.current );
			progressTimerRef.current = null;
		}
		if ( progressResetTimerRef.current ) {
			clearTimeout( progressResetTimerRef.current );
			progressResetTimerRef.current = null;
		}
	}, [] );

	// The webview emits no incremental load progress, so the bar is
	// simulated: it eases toward 88% while loading and snaps to 100% on
	// completion before resetting.
	const startProgress = useCallback( () => {
		clearProgressTimers();
		publishBrowserState( {
			loading: true,
			progress: Math.max( browserStateRef.current.progress, 0.12 ),
		} );
		progressTimerRef.current = setInterval( () => {
			const current = browserStateRef.current.progress;
			const next = Math.min( 0.88, current + Math.max( 0.02, ( 0.88 - current ) * 0.18 ) );
			publishBrowserState( { loading: true, progress: next } );
		}, 250 );
	}, [ clearProgressTimers, publishBrowserState ] );

	const finishProgress = useCallback( () => {
		clearProgressTimers();
		publishBrowserState( { loading: false, progress: 1 } );
		progressResetTimerRef.current = setTimeout( () => {
			publishBrowserState( { loading: false, progress: 0 } );
		}, 180 );
	}, [ clearProgressTimers, publishBrowserState ] );

	// The mount-time url is loaded via the `src` attribute (calling `loadURL`
	// before `dom-ready` throws); it must stay stable so later navigation
	// goes through `loadURL` instead of remounting the webview.
	const [ initialSrc ] = useState( () => url );

	// Wire DOM events on the underlying custom element. We use refs + native
	// event listeners because React doesn't recognise `<webview>`'s
	// non-standard events (`dom-ready`, `console-message`).
	useEffect( () => {
		const webview = ref.current as WebviewTag | null;
		if ( ! webview ) return;

		const publishDocumentTitle = ( title?: unknown ) => {
			if ( typeof title === 'string' ) {
				publishBrowserState( { title: normalizeDocumentTitle( title ) } );
				return;
			}

			webview
				.executeJavaScript( 'document.title', false )
				.then( ( nextTitle ) => {
					publishBrowserState( { title: normalizeDocumentTitle( nextTitle ) } );
				} )
				.catch( () => undefined );
		};

		const handleDomReady = () => {
			domReadyRef.current = true;
			setReady( true );
			publishDocumentTitle();
			const script = buildInspectorPageScript( {
				features: APP_INSPECTOR_FEATURES,
				// A fresh document resets the injected script's loupe zoom;
				// reseed the level the user last dialed in.
				initialZoom: lastLoupeZoomRef.current ?? undefined,
			} );
			webview
				.executeJavaScript( script, false )
				.then( () => {
					// The injected script reports the real layer state through
					// the console bridge; this just flips `ready` so the host
					// controls enable without waiting for that round-trip.
					onInspectorStateRef.current?.( { ...EMPTY_INSPECTOR_STATE, ready: true } );
					// Existing clips need their markers back on the new document.
					syncClipMarkers( webview );
					syncAgentMarkers( webview );
				} )
				.catch( () => {
					// Transient injection failures (e.g. frame swapped mid-eval)
					// are recoverable on the next dom-ready.
				} );
		};

		const handleConsoleMessage = ( event: Event ) => {
			const consoleEvent = event as WebviewConsoleEvent;
			if ( typeof consoleEvent.message !== 'string' ) return;
			const parsed = parseInspectorGuestEvent( consoleEvent.message );
			if ( ! parsed ) {
				if ( consoleEvent.message.startsWith( '__studio-inspector__' ) ) return;
				consoleEntryIdRef.current += 1;
				onConsoleEntryRef.current?.( {
					id: `${ Date.now().toString( 36 ) }-${ consoleEntryIdRef.current }`,
					level: getPreviewConsoleLevelFromWebviewLevel( consoleEvent.level ),
					message: consoleEvent.message,
					timestamp: Date.now(),
					sourceId:
						typeof consoleEvent.sourceId === 'string' && consoleEvent.sourceId.trim()
							? consoleEvent.sourceId
							: undefined,
					lineNumber:
						typeof consoleEvent.line === 'number' && Number.isFinite( consoleEvent.line )
							? consoleEvent.line
							: undefined,
				} );
				return;
			}
			switch ( parsed.type ) {
				case 'browser-command':
					if ( isBrowserShortcutCommand( parsed.command ) ) {
						onBrowserCommandRef.current?.( parsed.command );
					}
					return;
				case 'loupe-capture': {
					const anchor = getLoupeCaptureAnchor( parsed as Record< string, unknown > );
					if ( anchor ) {
						void pushLoupeBackdrop( webview, anchor );
					}
					return;
				}
				case 'clip-element':
					void captureElementClip( webview, parsed.clip as unknown as Record< string, unknown > );
					return;
				case 'clip-region':
					void captureRegionClip( webview, parsed.clip as unknown as Record< string, unknown > );
					return;
				case 'clip-page':
					void capturePageClip( webview );
					return;
				case 'clip-update':
					if ( typeof parsed.id === 'string' && typeof parsed.comment === 'string' ) {
						onClipUpdateRef.current?.( parsed.id, parsed.comment );
					}
					return;
				case 'clip-remove':
					if ( typeof parsed.id === 'string' ) {
						onClipRemoveRef.current?.( parsed.id );
					}
					return;
				case 'text-selection':
					if ( typeof parsed.text === 'string' && parsed.text.trim() ) {
						onTextSelectionRef.current?.(
							parsed.text,
							typeof parsed.pathname === 'string' ? parsed.pathname : ''
						);
					}
					return;
				case 'state':
					// Remember the last loupe zoom so it survives navigations (the
					// injected script starts fresh on every document).
					if ( isFiniteNumber( parsed.zoom ) ) {
						lastLoupeZoomRef.current = parsed.zoom;
					}
					onInspectorStateRef.current?.( {
						ready: true,
						active: Boolean( parsed.active ),
						pinned: Boolean( parsed.pinned ),
						zoom: isFiniteNumber( parsed.zoom ) ? parsed.zoom : 3,
						clipCount: typeof parsed.clipCount === 'number' ? parsed.clipCount : 0,
					} );
					return;
			}
		};
		const handlePageTitleUpdated = ( event: Event ) => {
			publishDocumentTitle( ( event as WebviewPageTitleUpdatedEvent ).title );
		};
		// `did-finish-load` and `did-stop-loading` both fire at the end of a
		// successful load; without a per-load guard the title query would run
		// once per event instead of once per navigation.
		let didReadTitleAfterLoad = false;
		const handleNavigate = ( event: Event ) => {
			const navigateEvent = event as { url?: unknown };
			if ( typeof navigateEvent.url === 'string' ) {
				currentUrlRef.current = navigateEvent.url;
				onNavigateRef.current?.( navigateEvent.url );
			}
			didReadTitleAfterLoad = false;
			publishBrowserState();
		};
		const handleStartLoading = () => {
			didReadTitleAfterLoad = false;
			onInspectorStateRef.current?.( EMPTY_INSPECTOR_STATE );
			publishBrowserState( { title: null } );
			startProgress();
		};
		const handleStopLoading = () => {
			finishProgress();
			if ( domReadyRef.current && ! didReadTitleAfterLoad ) {
				didReadTitleAfterLoad = true;
				publishDocumentTitle();
			}
		};

		webview.addEventListener( 'dom-ready', handleDomReady );
		webview.addEventListener( 'console-message', handleConsoleMessage );
		webview.addEventListener( 'page-title-updated', handlePageTitleUpdated );
		webview.addEventListener( 'did-navigate', handleNavigate );
		webview.addEventListener( 'did-navigate-in-page', handleNavigate );
		webview.addEventListener( 'did-start-loading', handleStartLoading );
		webview.addEventListener( 'did-stop-loading', handleStopLoading );
		webview.addEventListener( 'did-fail-load', handleStopLoading );
		webview.addEventListener( 'did-finish-load', handleStopLoading );
		publishBrowserState();
		return () => {
			domReadyRef.current = false;
			clearProgressTimers();
			webview.removeEventListener( 'dom-ready', handleDomReady );
			webview.removeEventListener( 'console-message', handleConsoleMessage );
			webview.removeEventListener( 'page-title-updated', handlePageTitleUpdated );
			webview.removeEventListener( 'did-navigate', handleNavigate );
			webview.removeEventListener( 'did-navigate-in-page', handleNavigate );
			webview.removeEventListener( 'did-start-loading', handleStartLoading );
			webview.removeEventListener( 'did-stop-loading', handleStopLoading );
			webview.removeEventListener( 'did-fail-load', handleStopLoading );
			webview.removeEventListener( 'did-finish-load', handleStopLoading );
		};
	}, [
		captureElementClip,
		capturePageClip,
		captureRegionClip,
		clearProgressTimers,
		finishProgress,
		publishBrowserState,
		pushLoupeBackdrop,
		startProgress,
		syncAgentMarkers,
		syncClipMarkers,
	] );

	// Navigation effect — gated on `ready` so the first call happens after
	// `dom-ready` (the initial url is loaded by the `src` attribute on the
	// `<webview>`, tracked by `currentUrlRef`'s initial value; calling
	// `loadURL` before `dom-ready` throws). In-preview navigation reported
	// via `onNavigate` round-trips through the parent's `path` state, so skip
	// the reload when the webview is already showing the requested url —
	// this also covers the initial render, and unlike a mount-time snapshot
	// it doesn't block navigating *back* to the starting url later.
	useEffect( () => {
		if ( ! ready ) return;
		if ( url === currentUrlRef.current && reloadNonce === lastReloadNonceRef.current ) return;
		const webview = ref.current as WebviewTag | null;
		if ( ! webview ) return;
		currentUrlRef.current = url;
		lastReloadNonceRef.current = reloadNonce;
		webview.loadURL( url ).catch( () => undefined );
	}, [ url, reloadNonce, ready ] );

	useEffect( () => {
		if ( ! ready || ! inspectorCommand ) return;
		const webview = ref.current as WebviewTag | null;
		if ( ! webview ) return;
		runInGuest( webview, buildInspectorCommandScript( inspectorCommand.command ) ).catch(
			() => undefined
		);
	}, [ inspectorCommand, ready, runInGuest ] );

	// One-shot page-clip trigger from host chrome. Not gated on the inspector
	// being ready: the capture goes through the debugger, not the guest
	// script (overlay hiding degrades gracefully when the script is absent).
	const lastPageClipIdRef = useRef< number | null >( null );
	useEffect( () => {
		if ( ! pageClipRequest ) return;
		if ( lastPageClipIdRef.current === pageClipRequest.id ) return;
		lastPageClipIdRef.current = pageClipRequest.id;
		const webview = ref.current as WebviewTag | null;
		if ( ! webview ) return;
		void capturePageClip( webview );
	}, [ pageClipRequest, capturePageClip ] );

	useEffect( () => {
		if ( ! ready || ! browserCommand ) return;
		const webview = ref.current as WebviewTag | null;
		if ( ! webview ) return;
		try {
			if ( browserCommand.type === 'back' && webview.canGoBack?.() ) {
				webview.goBack?.();
			} else if ( browserCommand.type === 'forward' && webview.canGoForward?.() ) {
				webview.goForward?.();
			} else if ( browserCommand.type === 'reload' ) {
				webview.reload?.();
			}
		} finally {
			publishBrowserState();
		}
	}, [ browserCommand, publishBrowserState, ready ] );

	return (
		<>
			<webview
				ref={ ref }
				src={ initialSrc }
				className={ styles.iframe }
				style={ surfaceStyle }
				allowpopups={ true }
				partition="persist:site-preview"
			/>
			{ ! ready ? (
				<div className={ styles.spinnerOverlay } aria-hidden="true">
					<span className={ styles.spinner } />
				</div>
			) : null }
		</>
	);
}
