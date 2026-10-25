import {
	INSPECTOR_COMMAND_EVENT,
	INSPECTOR_PAGE_SCRIPT,
	parseInspectorMessage,
	type InspectorEvent,
} from '@studio/common/ai/inspector/page-script';
import { __ } from '@wordpress/i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useColorScheme } from '@/data/host/use-color-scheme';
import {
	areBrowserStatesEqual,
	EMPTY_BROWSER_STATE,
	normalizeDocumentTitle,
	type BrowserCommand,
	type BrowserNavigationState,
} from '@/features/sites/site-preview/browser-state';
import styles from './style.module.css';
import {
	ERR_ABORTED,
	getPreviewIpc,
	getWebviewContentsId,
	isOffOriginRedirect,
	reloadPreview,
	safeWebviewBoolean,
	safeWebviewIsLoading,
	type WebviewConsoleEvent,
	type WebviewFailLoadEvent,
	type WebviewPageTitleUpdatedEvent,
	type WebviewTag,
} from './webview';
import type { SiteAnnotations } from '@/features/annotations';

interface WebviewSurfaceProps {
	url: string;
	reloadNonce: number;
	// The site's annotations, mirrored into the page as markers.
	annotations?: SiteAnnotations;
	onInspectorReady?: ( ready: boolean ) => void;
	onInspectorEvent?: ( event: InspectorEvent ) => void;
	browserCommand?: BrowserCommand | null;
	onBrowserStateChange?: ( state: BrowserNavigationState ) => void;
	onNavigate?: ( url: string ) => void;
	// A page finished loading, with the webview's guest id for capturing it.
	onLoad?: ( url: string, guestId: number ) => void;
	// Whether to inject the annotation inspector into the guest page. Off for
	// phpMyAdmin, which can't be annotated.
	inspector?: boolean;
}

/**
 * Renders the site preview as an Electron `<webview>` tag.
 *
 * The annotation inspector is injected into the guest page via
 * `executeJavaScript()` after each load (see `@studio/common/ai/inspector/page-script`).
 */
export function WebviewSurface( {
	url,
	reloadNonce,
	annotations,
	onInspectorReady,
	onInspectorEvent,
	browserCommand,
	onBrowserStateChange,
	onNavigate,
	onLoad,
	inspector = true,
}: WebviewSurfaceProps ) {
	const ref = useRef< HTMLElement | null >( null );
	const [ ready, setReady ] = useState( false );
	const [ inspectorReady, setInspectorReady ] = useState( false );
	const onInspectorReadyRef = useRef( onInspectorReady );
	const onInspectorEventRef = useRef( onInspectorEvent );
	const onBrowserStateChangeRef = useRef( onBrowserStateChange );
	const onNavigateRef = useRef( onNavigate );
	const onLoadRef = useRef( onLoad );
	const browserStateRef = useRef< BrowserNavigationState >( EMPTY_BROWSER_STATE );
	const domReadyRef = useRef( false );
	const inspectorEnabledRef = useRef( inspector );
	const currentUrlRef = useRef( url );
	const lastReloadNonceRef = useRef( reloadNonce );
	const progressTimerRef = useRef< ReturnType< typeof setInterval > | null >( null );
	const progressResetTimerRef = useRef< ReturnType< typeof setTimeout > | null >( null );
	useEffect( () => {
		onInspectorReadyRef.current = onInspectorReady;
	}, [ onInspectorReady ] );
	useEffect( () => {
		onInspectorEventRef.current = onInspectorEvent;
	}, [ onInspectorEvent ] );
	useEffect( () => {
		onBrowserStateChangeRef.current = onBrowserStateChange;
	}, [ onBrowserStateChange ] );
	useEffect( () => {
		onNavigateRef.current = onNavigate;
	}, [ onNavigate ] );
	useEffect( () => {
		onLoadRef.current = onLoad;
	}, [ onLoad ] );
	useEffect( () => {
		inspectorEnabledRef.current = inspector;
	}, [ inspector ] );
	// The url we want shown; `currentUrlRef` is where the webview actually landed.
	const urlRef = useRef( url );
	useEffect( () => {
		urlRef.current = url;
	}, [ url ] );
	// The last url the host asked for, which is what separates a navigation
	// from a refresh: `currentUrlRef` follows the guest wherever it lands, so
	// it can't tell "the parent wants another page" from "the parent wants this
	// page again".
	const lastRequestedUrlRef = useRef( url );
	// Only loads we started (the mount-time `src` counts) are judged for redirects.
	const pendingLoadRef = useRef( true );
	// Identifies the most recent load we started, so a rejection from a load
	// that a newer one superseded can't roll the address bar backwards.
	const loadGenerationRef = useRef( 0 );

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

		const publishNavigationHistory = () => {
			const ipcApi = getPreviewIpc();
			let webContentsId: number;
			try {
				webContentsId = getWebviewContentsId( webview );
			} catch {
				return;
			}
			void ipcApi
				?.getWebviewNavigationHistory?.( webContentsId )
				.then( ( history ) => {
					publishBrowserState( {
						historyEntries: history.entries,
						activeHistoryIndex: history.activeIndex,
					} );
				} )
				.catch( () => undefined );
		};

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
			publishNavigationHistory();
			if ( ! inspectorEnabledRef.current ) {
				return;
			}
			webview
				.executeJavaScript( INSPECTOR_PAGE_SCRIPT, false )
				.then( () => {
					setInspectorReady( true );
					onInspectorReadyRef.current?.( true );
				} )
				.catch( () => {
					// Transient injection failures (e.g. frame swapped mid-eval)
					// are recoverable on the next dom-ready.
				} );
		};

		const handleConsoleMessage = ( event: Event ) => {
			const parsed = parseInspectorMessage(
				( event as WebviewConsoleEvent ).message,
				webview.getBoundingClientRect()
			);
			if ( parsed ) onInspectorEventRef.current?.( parsed );
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
				// Once per load, so a site that legitimately redirects can't loop.
				if ( pendingLoadRef.current ) {
					pendingLoadRef.current = false;
					if ( isOffOriginRedirect( navigateEvent.url, urlRef.current ) ) {
						void reloadPreview( webview, urlRef.current, navigateEvent.url );
					}
				}
			}
			didReadTitleAfterLoad = false;
			publishBrowserState();
			publishNavigationHistory();
		};
		const handleStartLoading = () => {
			didReadTitleAfterLoad = false;
			if ( inspectorEnabledRef.current ) {
				setInspectorReady( false );
				onInspectorReadyRef.current?.( false );
			}
			publishBrowserState( { title: null, failed: false } );
			startProgress();
		};
		const handleStopLoading = () => {
			finishProgress();
			publishNavigationHistory();
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
		const handleFailLoad = ( event: Event ) => {
			const { errorCode, isMainFrame } = event as WebviewFailLoadEvent;
			if ( isMainFrame && errorCode !== ERR_ABORTED ) {
				publishBrowserState( { failed: true } );
			}
			handleStopLoading();
		};
		webview.addEventListener( 'did-fail-load', handleFailLoad );
		webview.addEventListener( 'did-finish-load', handleStopLoading );
		const handleFinishLoad = () => {
			if ( ! browserStateRef.current.failed ) {
				onLoadRef.current?.( currentUrlRef.current, getWebviewContentsId( webview ) );
			}
		};
		webview.addEventListener( 'did-finish-load', handleFinishLoad );
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
			webview.removeEventListener( 'did-finish-load', handleFinishLoad );
			webview.removeEventListener( 'did-fail-load', handleFailLoad );
			webview.removeEventListener( 'did-finish-load', handleStopLoading );
		};
	}, [ clearProgressTimers, finishProgress, publishBrowserState, startProgress ] );

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
		const reloadRequested = reloadNonce !== lastReloadNonceRef.current;
		const requestedUrlChanged = url !== lastRequestedUrlRef.current;
		// Tracked even when we go on to skip the load, so an in-preview
		// navigation that round-trips through `path` doesn't leave the next
		// nonce bump looking like a page change.
		lastRequestedUrlRef.current = url;
		if ( url === currentUrlRef.current && ! reloadRequested ) return;
		const webview = ref.current as WebviewTag | null;
		if ( ! webview ) return;
		const previousUrl = currentUrlRef.current;
		const generation = ++loadGenerationRef.current;
		lastReloadNonceRef.current = reloadNonce;
		pendingLoadRef.current = true;
		// A nonce bump that asks for the same url is a refresh, not a
		// navigation, so it goes through the same cache-dropping path as the
		// toolbar's ⟳ — otherwise the reload the agent asks for uses a warm
		// cache and serves the CSS/JS the agent just edited back stale.
		if ( reloadRequested && ! requestedUrlChanged ) {
			void reloadPreview( webview, url, previousUrl );
			return;
		}
		// `currentUrlRef` is advanced by `did-navigate`, never optimistically:
		// a load the guest refuses — an unsaved-changes guard, a dead url —
		// must leave the host showing the page that's actually on screen.
		webview.loadURL( url ).catch( () => {
			// A newer load we started, or one the guest committed on its own
			// (a link click, a back navigation), owns the address bar now —
			// both can abort this load, and neither should be rolled back.
			if ( loadGenerationRef.current !== generation ) {
				return;
			}
			if ( currentUrlRef.current !== previousUrl ) {
				return;
			}
			pendingLoadRef.current = false;
			onNavigateRef.current?.( previousUrl );
		} );
	}, [ url, reloadNonce, ready ] );

	// Mirrors the notes into the page, in the theme's accent.
	const colorScheme = useColorScheme();
	useEffect( () => {
		const webview = ref.current as WebviewTag | null;
		if ( ! inspectorReady || ! webview || ! annotations ) return;
		const theme = getComputedStyle( webview );
		const detail = {
			active: annotations.active,
			editingId: annotations.editingId,
			notes: annotations.notes.map( ( { id, number, selector, url, documentRect, point } ) => ( {
				id,
				number,
				selector,
				url,
				documentRect,
				point,
			} ) ),
			annotationLabel: __( 'Annotation' ),
			accent: theme.getPropertyValue( '--accent' ).trim(),
			onAccent: theme.getPropertyValue( '--accent-foreground' ).trim(),
		};
		webview
			.executeJavaScript(
				`window.dispatchEvent(new CustomEvent(${ JSON.stringify(
					INSPECTOR_COMMAND_EVENT
				) }, { detail: ${ JSON.stringify( detail ) } }));`,
				false
			)
			.catch( () => undefined );
	}, [ annotations, colorScheme, inspectorReady ] );

	useEffect( () => {
		if ( ! ready || ! browserCommand ) return;
		const webview = ref.current as WebviewTag | null;
		if ( ! webview ) return;
		try {
			if ( browserCommand.type === 'back' && webview.canGoBack?.() ) {
				webview.goBack?.();
			} else if ( browserCommand.type === 'forward' && webview.canGoForward?.() ) {
				webview.goForward?.();
			} else if (
				browserCommand.type === 'go-to-history' &&
				typeof browserCommand.historyIndex === 'number'
			) {
				const ipcApi = getPreviewIpc();
				const webContentsId = getWebviewContentsId( webview );
				void ipcApi?.goToWebviewNavigationHistoryEntry?.(
					webContentsId,
					browserCommand.historyIndex
				);
			} else if ( browserCommand.type === 'reload' ) {
				void reloadPreview( webview, urlRef.current, currentUrlRef.current );
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
				// @types/react types this as boolean, but React 19 drops `true` on
				// unknown attributes, which leaves Electron blocking every popup.
				allowpopups={ 'true' as unknown as boolean }
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
