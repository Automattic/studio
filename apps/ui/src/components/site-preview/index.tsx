import { useQuery } from '@tanstack/react-query';
import { __, sprintf } from '@wordpress/i18n';
import { chevronLeft, chevronRight, external, pencil } from '@wordpress/icons';
import { ariaKeyShortcut, displayShortcut, isAppleOS, isKeyboardEvent } from '@wordpress/keycodes';
import { Button, IconButton } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DotGrid } from '@/components/dot-grid';
import { useConnector } from '@/data/core';
import { useIsSiteStarting, useStartSite } from '@/data/queries/use-sites';
import { useTrafficLightSpace } from '@/hooks/use-traffic-light-space';
import { useWindowControlsOverlay } from '@/hooks/use-window-controls-overlay';
import { getSiteUrl } from '@/lib/get-site-url';
import { playIcon, refreshIcon } from '@/lib/icons';
import {
	DATABASE_HOME_PATH,
	getPathFromPreviewUrl,
	getPreviewRealm,
	getRealmNavigationPath,
	PreviewAddressBar,
	REALM_SHORTCUT_KEYS,
	type PreviewRealm,
} from './address-bar';
import {
	INSPECTOR_BRIDGE_PREFIX,
	INSPECTOR_COMMAND_EVENT,
	INSPECTOR_PAGE_SCRIPT,
} from './inspector-script';
import styles from './style.module.css';
import type { Annotation } from './types';
import type { SiteDetails } from '@/data/core';

export type { Annotation } from './types';
export { getPathFromPreviewUrl } from './address-bar';

interface SitePreviewProps {
	site: SiteDetails;
	// Path to display within the previewed site, controlled by the parent so
	// it can be updated by chat artifact events even when the panel was
	// previously collapsed.
	path: string;
	// Bumped by the parent to force a webview reload.
	reloadNonce: number;
	// Called when the user clicks "Submit" in the annotation controls. Receives
	// the full annotation payload assembled inside the webview's guest page.
	onAnnotationsDone?: ( annotations: Annotation[] ) => void;
	// Called when the user navigates within the preview (link clicks,
	// back/forward) so the parent can keep its `path` in sync without
	// forcing a reload.
	onPathChange?: ( path: string ) => void;
	// True while the panel is toggled off but kept mounted (so the webview
	// stays warm). Disables the global browser shortcuts in that state.
	collapsed?: boolean;
}

interface InspectorEvent {
	type: 'browser-command' | 'done' | 'state';
	annotations?: Annotation[];
	isPicking?: boolean;
	annotationCount?: number;
	command?: BrowserShortcutCommandType;
}

interface InspectorState {
	ready: boolean;
	isPicking: boolean;
	annotationCount: number;
}

interface InspectorCommand {
	id: number;
	type: 'toggle-picking' | 'submit';
}

interface BrowserNavigationState {
	canGoBack: boolean;
	canGoForward: boolean;
	loading: boolean;
	progress: number;
	title: string | null;
}

type BrowserShortcutCommandType = 'back' | 'forward' | 'reload';

interface BrowserCommand {
	id: number;
	type: BrowserShortcutCommandType;
}

// Electron's `<webview>` is a custom element with non-standard methods. Type
// just the surface we use so this file compiles without an `electron` dep.
interface WebviewTag extends HTMLElement {
	loadURL( url: string ): Promise< void >;
	executeJavaScript( code: string, userGesture?: boolean ): Promise< unknown >;
	canGoBack?(): boolean;
	canGoForward?(): boolean;
	goBack?(): void;
	goForward?(): void;
	reload?(): void;
	isLoading?(): boolean;
}

interface WebviewConsoleEvent extends Event {
	level: number;
	message: string;
}

interface WebviewPageTitleUpdatedEvent extends Event {
	title?: string;
}

// Best-effort UA sniff: webview is only meaningful inside Electron. Outside
// (e.g. running apps/ui standalone in a regular browser) the tag is inert, so
// we render a plain iframe instead and skip the inspector.
const isElectron = (): boolean => {
	if ( typeof navigator === 'undefined' ) return false;
	return /\bElectron\//.test( navigator.userAgent );
};

const EMPTY_BROWSER_STATE: BrowserNavigationState = {
	canGoBack: false,
	canGoForward: false,
	loading: false,
	progress: 0,
	title: null,
};

const EMPTY_INSPECTOR_STATE: InspectorState = {
	ready: false,
	isPicking: false,
	annotationCount: 0,
};

const SITE_THUMBNAIL_QUERY_KEY = [ 'site-preview-thumbnail' ] as const;

// Where each realm segment lands before its per-realm memory has anything
// better: site root, WP Admin dashboard, and phpMyAdmin's WordPress database.
const DEFAULT_REALM_PATHS: Record< PreviewRealm, string > = {
	frontend: '/',
	admin: '/wp-admin/',
	database: DATABASE_HOME_PATH,
};

// Whether the address bar shows the Database segment. Off unless explicitly
// enabled — the phpMyAdmin companion isn't available for every site.
const PREVIEW_SHOW_DATABASE_TAB_STORAGE_KEY = 'studio:preview-show-database-tab';

function getStoredShowDatabaseTab(): boolean {
	try {
		// Only an explicit "true" shows the tab; anything else hides it.
		return window.localStorage.getItem( PREVIEW_SHOW_DATABASE_TAB_STORAGE_KEY ) === 'true';
	} catch {
		return false;
	}
}

function safeWebviewBoolean( webview: WebviewTag | null, method: 'canGoBack' | 'canGoForward' ) {
	try {
		return typeof webview?.[ method ] === 'function' ? Boolean( webview[ method ]() ) : false;
	} catch {
		return false;
	}
}

function safeWebviewIsLoading( webview: WebviewTag | null, fallback: boolean ) {
	try {
		return typeof webview?.isLoading === 'function' ? webview.isLoading() : fallback;
	} catch {
		return fallback;
	}
}

function normalizeDocumentTitle( value: unknown ) {
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function getIframeTitle( iframe: HTMLIFrameElement ) {
	try {
		return normalizeDocumentTitle( iframe.contentDocument?.title );
	} catch {
		return null;
	}
}

function getBrowserShortcutDescriptor( key: string ) {
	return {
		displayShortcut: displayShortcut.primary( key ),
		ariaKeyShortcut: ariaKeyShortcut.primary( key ),
	};
}

function getNavigationShortcutDescriptor( direction: 'back' | 'forward' ) {
	const isApple = isAppleOS();
	const arrow = direction === 'back' ? '←' : '→';
	const arrowKey = direction === 'back' ? 'ArrowLeft' : 'ArrowRight';
	const bracket = direction === 'back' ? '[' : ']';
	return {
		displayShortcut: isApple ? `⌘${ arrow }` : `Alt+${ arrow }`,
		ariaKeyShortcut: `${ isApple ? 'Meta' : 'Alt' }+${ arrowKey } ${ ariaKeyShortcut.primary(
			bracket
		) }`,
	};
}

function isTextEntryTarget( target: EventTarget | null ) {
	return (
		target instanceof HTMLElement &&
		( target.isContentEditable ||
			target instanceof HTMLInputElement ||
			target instanceof HTMLTextAreaElement ||
			target instanceof HTMLSelectElement )
	);
}

export function getBrowserShortcutCommand(
	event: globalThis.KeyboardEvent
): BrowserShortcutCommandType | null {
	if ( event.defaultPrevented || event.repeat ) {
		return null;
	}
	if ( isKeyboardEvent.primary( event, 'r' ) ) {
		return 'reload';
	}
	if ( isKeyboardEvent.primary( event, '[' ) ) {
		return 'back';
	}
	if ( isKeyboardEvent.primary( event, ']' ) ) {
		return 'forward';
	}
	// Layout-independent back/forward aliases (⌘←/⌘→ on macOS, Alt+←/→
	// elsewhere): the bracket chords need Option/AltGr on many European
	// layouts. Skipped while editing text to keep native caret movement.
	if ( isTextEntryTarget( event.target ) ) {
		return null;
	}
	const isNavigationChord = isAppleOS() ? isKeyboardEvent.primary : isKeyboardEvent.alt;
	if ( isNavigationChord( event, 'ArrowLeft' ) ) {
		return 'back';
	}
	if ( isNavigationChord( event, 'ArrowRight' ) ) {
		return 'forward';
	}
	return null;
}

// ⌘1/⌘2/⌘3 (Ctrl elsewhere) select the address bar's realm segments.
function getRealmShortcut( event: globalThis.KeyboardEvent ): PreviewRealm | null {
	if ( event.defaultPrevented || event.repeat ) {
		return null;
	}
	for ( const realm of Object.keys( REALM_SHORTCUT_KEYS ) as PreviewRealm[] ) {
		if ( isKeyboardEvent.primary( event, REALM_SHORTCUT_KEYS[ realm ] ) ) {
			return realm;
		}
	}
	return null;
}

function isBrowserShortcutCommand( command: unknown ): command is BrowserShortcutCommandType {
	return command === 'back' || command === 'forward' || command === 'reload';
}

function areBrowserStatesEqual( a: BrowserNavigationState, b: BrowserNavigationState ) {
	return (
		a.canGoBack === b.canGoBack &&
		a.canGoForward === b.canGoForward &&
		a.loading === b.loading &&
		a.progress === b.progress &&
		a.title === b.title
	);
}

export function SitePreview( {
	site,
	path,
	reloadNonce,
	onAnnotationsDone,
	onPathChange,
	collapsed = false,
}: SitePreviewProps ) {
	const connector = useConnector();
	const startSite = useStartSite();
	const isStarting = useIsSiteStarting( site.id );
	const siteUrl = getSiteUrl( site );
	const canPreview = site.running;
	const canUseWebview = isElectron();
	const windowControls = useWindowControlsOverlay();
	const trafficLightSpace = useTrafficLightSpace();
	const previewUrl = `${ siteUrl }${ getSafePath( path ) }`;
	const siteThumbnail = useQuery( {
		queryKey: [ ...SITE_THUMBNAIL_QUERY_KEY, site.id ],
		queryFn: () => connector.getSiteThumbnail( site.id ),
		enabled: ! canPreview,
		meta: { persist: false },
	} );
	const [ browserState, setBrowserState ] =
		useState< BrowserNavigationState >( EMPTY_BROWSER_STATE );
	const [ browserCommand, setBrowserCommand ] = useState< BrowserCommand | null >( null );
	const [ inspectorState, setInspectorState ] = useState< InspectorState >( EMPTY_INSPECTOR_STATE );
	const [ inspectorCommand, setInspectorCommand ] = useState< InspectorCommand | null >( null );
	// Whether the address bar shows the Database segment (global preference;
	// the setting UI ships with the preview's view-settings menu).
	const [ showDatabaseTab ] = useState( getStoredShowDatabaseTab );
	const rootRef = useRef< HTMLElement | null >( null );
	const commandIdRef = useRef( 0 );
	const canAnnotate = canPreview && inspectorState.ready;
	const progress = browserState.loading
		? Math.max( browserState.progress, 0.12 )
		: browserState.progress;
	const showLoadingProgress = canPreview && progress > 0;

	const handlePreviewNavigation = useCallback(
		( url: string ) => {
			const nextPath = getPathFromPreviewUrl( url, siteUrl );
			if ( ! nextPath || nextPath === path ) {
				return;
			}
			onPathChange?.( nextPath );
		},
		[ onPathChange, path, siteUrl ]
	);
	const handleBrowserStateChange = useCallback( ( state: BrowserNavigationState ) => {
		setBrowserState( ( current ) => ( areBrowserStatesEqual( current, state ) ? current : state ) );
	}, [] );
	const handleInspectorState = useCallback( ( state: InspectorState ) => {
		setInspectorState( state );
	}, [] );
	const sendBrowserCommand = useCallback( ( type: BrowserCommand[ 'type' ] ) => {
		commandIdRef.current += 1;
		setBrowserCommand( { id: commandIdRef.current, type } );
	}, [] );
	const sendInspectorCommand = useCallback( ( type: InspectorCommand[ 'type' ] ) => {
		commandIdRef.current += 1;
		setInspectorCommand( { id: commandIdRef.current, type } );
	}, [] );

	// Realm segments (front end / WP Admin / database). Each realm remembers
	// where you last were: flipping to WP Admin and back returns to the exact
	// front-end page, and vice versa. Admin targets go through the site's
	// /studio-auto-login endpoint so they never land on the login form.
	const lastRealmPathsRef = useRef< Record< PreviewRealm, string > >( {
		...DEFAULT_REALM_PATHS,
	} );
	useEffect( () => {
		// Reset the per-realm memory when the preview moves to another site.
		lastRealmPathsRef.current = { ...DEFAULT_REALM_PATHS };
	}, [ site.id ] );
	useEffect( () => {
		const safePath = getSafePath( path );
		// Auto-login is a transient hop, not a place to return to.
		if ( safePath.startsWith( '/studio-auto-login' ) ) {
			return;
		}
		lastRealmPathsRef.current[ getPreviewRealm( safePath ) ] = safePath;
	}, [ path ] );
	const handleSwitchRealm = useCallback(
		( realm: PreviewRealm ) => {
			// The database realm is unreachable while its tab is hidden — ignore
			// clicks (there is none) and the ⌘3 shortcut.
			if ( realm === 'database' && ! showDatabaseTab ) {
				return;
			}
			// Re-selecting the active realm (e.g. via its shortcut) is a no-op —
			// don't bounce the current page through another auto-login hop.
			if ( getPreviewRealm( getSafePath( path ) ) === realm ) {
				return;
			}
			const target = lastRealmPathsRef.current[ realm ];
			onPathChange?.( getRealmNavigationPath( target, siteUrl ) );
		},
		[ onPathChange, path, showDatabaseTab, siteUrl ]
	);

	const browserShortcuts = useMemo(
		() => ( {
			back: getNavigationShortcutDescriptor( 'back' ),
			forward: getNavigationShortcutDescriptor( 'forward' ),
			reload: getBrowserShortcutDescriptor( 'r' ),
		} ),
		[]
	);

	useEffect( () => {
		setBrowserState( EMPTY_BROWSER_STATE );
		setInspectorState( EMPTY_INSPECTOR_STATE );
	}, [ site.id ] );

	// Browser shortcuts (⌘R / ⌘[ / ⌘] / ⌘←/⌘→) and the ⌘1/⌘2/⌘3 realm switches
	// pressed while focus is in the host document. Shortcuts pressed inside the
	// guest page are forwarded by the inspector script through the console
	// bridge instead.
	useEffect( () => {
		if ( ! canPreview || collapsed ) {
			return;
		}
		const handleKeyDown = ( event: globalThis.KeyboardEvent ) => {
			const command = getBrowserShortcutCommand( event );
			const realm = command ? null : getRealmShortcut( event );
			if ( ! command && ! realm ) {
				return;
			}
			const activeElement = document.activeElement;
			if (
				activeElement &&
				activeElement !== document.body &&
				! rootRef.current?.contains( activeElement )
			) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			if ( command ) {
				sendBrowserCommand( command );
			} else if ( realm ) {
				handleSwitchRealm( realm );
			}
		};

		document.addEventListener( 'keydown', handleKeyDown, { capture: true } );
		return () => document.removeEventListener( 'keydown', handleKeyDown, { capture: true } );
	}, [ canPreview, collapsed, handleSwitchRealm, sendBrowserCommand ] );

	return (
		<aside ref={ rootRef } className={ styles.root } aria-label={ __( 'Site preview' ) }>
			<div
				className={ styles.header }
				style={
					windowControls
						? {
								minHeight: windowControls.height,
								paddingInlineEnd: windowControls.controlsWidth + 12,
						  }
						: // In RTL the preview pane sits at the physical left, so the
						// header's end-side controls land under the macOS traffic
						// lights — pad past them.
						trafficLightSpace.end
						? { paddingInlineEnd: 96 }
						: undefined
				}
			>
				{ /* Equal-flex side tracks keep the address control truly centered
					in the toolbar regardless of what each side holds. */ }
				<div className={ styles.headerSide }>
					{ canPreview ? (
						<IconButton
							variant="minimal"
							tone="neutral"
							size="small"
							icon={ refreshIcon }
							label={ __( 'Refresh' ) }
							shortcut={ browserShortcuts.reload }
							onClick={ () => sendBrowserCommand( 'reload' ) }
						/>
					) : null }
				</div>
				{ /* Back/forward flank the address segments so history controls sit
					with the place they navigate; symmetric widths keep the segments
					centered. */ }
				<div className={ styles.browserLocation }>
					{ canPreview ? (
						<>
							<IconButton
								variant="minimal"
								tone="neutral"
								size="small"
								icon={ chevronLeft }
								label={ __( 'Back' ) }
								shortcut={ browserShortcuts.back }
								disabled={ ! browserState.canGoBack }
								onClick={ () => sendBrowserCommand( 'back' ) }
							/>
							<PreviewAddressBar
								site={ site }
								siteUrl={ siteUrl }
								path={ getSafePath( path ) }
								showDatabaseTab={ showDatabaseTab }
								onNavigate={ ( nextPath ) => onPathChange?.( nextPath ) }
								onSwitchRealm={ handleSwitchRealm }
							/>
							<IconButton
								variant="minimal"
								tone="neutral"
								size="small"
								icon={ chevronRight }
								label={ __( 'Forward' ) }
								shortcut={ browserShortcuts.forward }
								disabled={ ! browserState.canGoForward }
								onClick={ () => sendBrowserCommand( 'forward' ) }
							/>
						</>
					) : null }
				</div>
				<div className={ clsx( styles.headerSide, styles.headerSideEnd ) }>
					{ canPreview ? (
						<>
							{ connector.capabilities.annotatePreview ? (
								<div className={ styles.annotationControls }>
									<IconButton
										variant="minimal"
										tone="neutral"
										size="small"
										icon={ pencil }
										label={ inspectorState.isPicking ? __( 'Stop annotating' ) : __( 'Annotate' ) }
										disabled={ ! canAnnotate }
										aria-pressed={ inspectorState.isPicking }
										onClick={ () => sendInspectorCommand( 'toggle-picking' ) }
									/>
									{ inspectorState.annotationCount > 0 ? (
										<Button
											variant="solid"
											tone="brand"
											size="small"
											disabled={ ! canAnnotate }
											aria-label={ __( 'Submit annotations' ) }
											onClick={ () => sendInspectorCommand( 'submit' ) }
										>
											{ __( 'Submit' ) }
										</Button>
									) : null }
								</div>
							) : null }
							<IconButton
								variant="minimal"
								tone="neutral"
								size="small"
								icon={ external }
								label={ __( 'Open site in browser' ) }
								onClick={ () => void connector.openExternalUrl( previewUrl ) }
							/>
						</>
					) : null }
				</div>
				{ showLoadingProgress ? (
					<div className={ styles.loadingProgress } aria-hidden="true">
						<span style={ { transform: `scaleX(${ Math.min( progress, 1 ) })` } } />
					</div>
				) : null }
			</div>
			<div className={ styles.body }>
				{ canPreview ? (
					canUseWebview ? (
						<WebviewSurface
							key={ site.id }
							url={ previewUrl }
							reloadNonce={ reloadNonce }
							onAnnotationsDone={ onAnnotationsDone }
							onInspectorState={ handleInspectorState }
							inspectorCommand={ inspectorCommand }
							browserCommand={ browserCommand }
							onBrowserStateChange={ handleBrowserStateChange }
							onBrowserCommand={ sendBrowserCommand }
							onNavigate={ handlePreviewNavigation }
						/>
					) : (
						// Non-Electron fallback: plain iframe, no inspector. Reloads
						// by remounting; back/forward aren't reachable from the host.
						<iframe
							key={ `${ previewUrl }#${ reloadNonce }#${
								browserCommand?.type === 'reload' ? browserCommand.id : 0
							}` }
							className={ styles.iframe }
							src={ previewUrl }
							title={ site.name }
							onLoad={ ( event ) => {
								handlePreviewNavigation( event.currentTarget.src );
								setBrowserState( ( current ) => {
									const next = {
										...current,
										loading: false,
										progress: 0,
										title: getIframeTitle( event.currentTarget ),
									};
									return areBrowserStatesEqual( current, next ) ? current : next;
								} );
							} }
						/>
					)
				) : (
					<div className={ styles.empty }>
						<div className={ styles.emptyGrid } aria-hidden="true">
							<DotGrid
								spacing={ 32 }
								crossSize={ 5 }
								crossThickness={ 0.75 }
								opacity={ 0.16 }
								intro={ false }
							/>
						</div>
						<div className={ styles.emptyContent }>
							{ siteThumbnail.data ? (
								<div className={ styles.emptyThumbnail }>
									<img
										src={ siteThumbnail.data }
										alt={ sprintf(
											/* translators: %s: site name */
											__( 'Screenshot of %s' ),
											site.name
										) }
									/>
								</div>
							) : null }
							<p className={ styles.emptyText }>
								{ __( 'Start the site to see a live preview.' ) }
							</p>
							<Button
								variant="solid"
								tone="brand"
								loading={ isStarting }
								loadingAnnouncement={ __( 'Starting site' ) }
								onClick={ () => startSite.mutate( site.id ) }
							>
								<span className={ styles.startIcon } aria-hidden="true">
									{ playIcon }
								</span>
								{ __( 'Start site' ) }
							</Button>
						</div>
					</div>
				) }
			</div>
		</aside>
	);
}

function getSafePath( path: unknown ) {
	return typeof path === 'string' && path.trim() ? path : '/';
}

interface WebviewSurfaceProps {
	url: string;
	reloadNonce: number;
	onAnnotationsDone?: ( annotations: Annotation[] ) => void;
	onInspectorState?: ( state: InspectorState ) => void;
	inspectorCommand?: InspectorCommand | null;
	browserCommand?: BrowserCommand | null;
	onBrowserStateChange?: ( state: BrowserNavigationState ) => void;
	onBrowserCommand?: ( type: BrowserShortcutCommandType ) => void;
	onNavigate?: ( url: string ) => void;
}

/**
 * Renders the site preview as an Electron `<webview>` tag.
 *
 * The annotation inspector is injected into the guest page via
 * `executeJavaScript()` after each load. It reports completed annotation
 * batches by calling `console.log(BRIDGE_PREFIX + JSON.stringify(...))`,
 * which we receive through the webview's `console-message` event.
 */
function WebviewSurface( {
	url,
	reloadNonce,
	onAnnotationsDone,
	onInspectorState,
	inspectorCommand,
	browserCommand,
	onBrowserStateChange,
	onBrowserCommand,
	onNavigate,
}: WebviewSurfaceProps ) {
	const ref = useRef< HTMLElement | null >( null );
	const [ ready, setReady ] = useState( false );
	const onAnnotationsDoneRef = useRef( onAnnotationsDone );
	const onInspectorStateRef = useRef( onInspectorState );
	const onBrowserStateChangeRef = useRef( onBrowserStateChange );
	const onBrowserCommandRef = useRef( onBrowserCommand );
	const onNavigateRef = useRef( onNavigate );
	const browserStateRef = useRef< BrowserNavigationState >( EMPTY_BROWSER_STATE );
	const domReadyRef = useRef( false );
	const currentUrlRef = useRef( url );
	const lastReloadNonceRef = useRef( reloadNonce );
	const progressTimerRef = useRef< ReturnType< typeof setInterval > | null >( null );
	const progressResetTimerRef = useRef< ReturnType< typeof setTimeout > | null >( null );
	useEffect( () => {
		onAnnotationsDoneRef.current = onAnnotationsDone;
	}, [ onAnnotationsDone ] );
	useEffect( () => {
		onInspectorStateRef.current = onInspectorState;
	}, [ onInspectorState ] );
	useEffect( () => {
		onBrowserStateChangeRef.current = onBrowserStateChange;
	}, [ onBrowserStateChange ] );
	useEffect( () => {
		onBrowserCommandRef.current = onBrowserCommand;
	}, [ onBrowserCommand ] );
	useEffect( () => {
		onNavigateRef.current = onNavigate;
	}, [ onNavigate ] );

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
			webview
				.executeJavaScript( INSPECTOR_PAGE_SCRIPT, false )
				.then( () => {
					// The injected script reports the real picking/count state
					// through the console bridge; this just flips `ready` so the
					// host controls enable without waiting for that round-trip.
					onInspectorStateRef.current?.( {
						ready: true,
						isPicking: false,
						annotationCount: 0,
					} );
				} )
				.catch( () => {
					// Transient injection failures (e.g. frame swapped mid-eval)
					// are recoverable on the next dom-ready.
				} );
		};

		const handleConsoleMessage = ( event: Event ) => {
			const consoleEvent = event as WebviewConsoleEvent;
			if ( typeof consoleEvent.message !== 'string' ) return;
			if ( ! consoleEvent.message.startsWith( INSPECTOR_BRIDGE_PREFIX ) ) return;
			let parsed: InspectorEvent | null = null;
			try {
				parsed = JSON.parse( consoleEvent.message.slice( INSPECTOR_BRIDGE_PREFIX.length ) );
			} catch {
				return;
			}
			if ( ! parsed ) return;
			if ( parsed.type === 'browser-command' ) {
				if ( isBrowserShortcutCommand( parsed.command ) ) {
					onBrowserCommandRef.current?.( parsed.command );
				}
				return;
			}
			if ( parsed.type === 'state' ) {
				onInspectorStateRef.current?.( {
					ready: true,
					isPicking: Boolean( parsed.isPicking ),
					annotationCount: typeof parsed.annotationCount === 'number' ? parsed.annotationCount : 0,
				} );
				return;
			}
			if ( parsed.type !== 'done' || ! parsed.annotations ) return;
			onAnnotationsDoneRef.current?.( parsed.annotations );
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
		const detail = JSON.stringify( { type: inspectorCommand.type } );
		webview
			.executeJavaScript(
				`window.dispatchEvent(new CustomEvent(${ JSON.stringify(
					INSPECTOR_COMMAND_EVENT
				) }, { detail: ${ detail } }));`,
				false
			)
			.catch( () => undefined );
	}, [ inspectorCommand, ready ] );

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
