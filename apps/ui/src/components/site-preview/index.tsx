import { DESIGN_SYSTEM_PREVIEW_PATH } from '@studio/common/ai/chat-artifacts';
import {
	INSPECTOR_COMMAND_EVENT,
	INSPECTOR_PAGE_SCRIPT,
	parseInspectorMessage,
	type BrowserShortcutCommand,
	type InspectorEvent,
} from '@studio/common/ai/inspector/page-script';
import { getSiteOperationLabel } from '@studio/common/lib/site-operation-labels';
import { useQueryClient } from '@tanstack/react-query';
import { __, sprintf } from '@wordpress/i18n';
import { Icon } from '@wordpress/icons';
import {
	ariaKeyShortcut,
	displayShortcut,
	isAppleOS,
	isKeyboardEvent,
	shortcutAriaLabel,
} from '@wordpress/keycodes';
import { clsx } from 'clsx';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnnotationOverlay, type AnnotationAnchor } from '@/components/annotations/overlay';
import {
	editAnnotation,
	escapeAnnotations,
	getSiteAnnotations,
	isAnnotationsBusy,
	pickAnnotation,
	setAnnotating,
	useSiteAnnotations,
	type SiteAnnotations,
} from '@/components/annotations/store';
import { DesignSystemView } from '@/components/design-system-view';
import { PreviewParticles } from '@/components/preview-particles';
import {
	SiteHeaderSpace,
	useSiteHeader,
	useSiteHeaderNavigation,
} from '@/components/site-header-actions';
import { SiteContextMenu, StoppedSitePreview } from '@/components/stopped-site-preview';
import { Button, IconButton } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import * as Menu from '@/components/ui/menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { VisuallyHidden } from '@/components/ui/visually-hidden';
import { useConnector } from '@/data/core';
import { useAgenticFeatures } from '@/data/queries/use-agentic-features';
import { siteDesignQueryKey, useSiteDesign } from '@/data/queries/use-site-design';
import { useSiteIcon } from '@/data/queries/use-site-icon';
import { siteThumbnailQueryKey, useSiteThumbnail } from '@/data/queries/use-site-thumbnail';
import { useIsSiteStarting, useIsSiteStopping, useSiteOperation } from '@/data/queries/use-sites';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useOpenSettings } from '@/hooks/use-open-settings';
import { useSidebarCollapsed } from '@/hooks/use-sidebar-collapsed';
import { useTrafficLightSpace } from '@/hooks/use-traffic-light-space';
import { useWindowControlsInset } from '@/hooks/use-window-controls-inset';
import { getSiteUrl } from '@/lib/get-site-url';
import {
	annotateIcon,
	browserBackIcon,
	browserForwardIcon,
	globeIcon,
	refreshIcon,
} from '@/lib/icons';
import { isDialogOpen } from '@/lib/shortcuts';
import {
	DATABASE_HOME_PATH,
	getPathFromPreviewUrl,
	getPreviewRealm,
	getRealmNavigationPath,
	getRealmOpenEvent,
	PreviewAddressBar,
	type PreviewRealm,
} from './address-bar';
import styles from './style.module.css';
import type { SiteDetails } from '@/data/core';
import type { VisualAnnotationTarget } from '@studio/common/ai/visual-annotations';

export { getPathFromPreviewUrl } from './address-bar';

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
	// Called when the user navigates within the preview (link clicks,
	// back/forward) so the parent can keep its `path` in sync without
	// forcing a reload.
	onPathChange?: ( path: string ) => void;
	// True while the panel is toggled off but kept mounted (so the webview
	// stays warm). Disables the global browser shortcuts in that state.
	collapsed?: boolean;
	// Controls at the toolbar's start, for when the preview is the leftmost pane.
	toolbarStart?: ReactNode;
	// The preview is the leftmost pane, so with the sidebar out of the way its
	// toolbar reaches the window's start edge, where the macOS traffic lights sit.
	atWindowStart?: boolean;
}

interface BrowserHistoryEntry {
	index: number;
	title: string;
	url: string;
}

interface BrowserNavigationState {
	canGoBack: boolean;
	canGoForward: boolean;
	loading: boolean;
	progress: number;
	title: string | null;
	historyEntries: BrowserHistoryEntry[];
	activeHistoryIndex: number;
	// The last main-frame load failed, so the page on screen is the browser's error page.
	failed: boolean;
}

interface BrowserCommand {
	id: number;
	type: BrowserShortcutCommand | 'go-to-history';
	historyIndex?: number;
}

// Electron's `<webview>` is a custom element with non-standard methods. Type
// just the surface we use so this file compiles without an `electron` dep.
interface WebviewTag extends HTMLElement {
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
}

interface WebviewPageTitleUpdatedEvent extends Event {
	title?: string;
}

interface WebviewFailLoadEvent extends Event {
	errorCode: number;
	isMainFrame: boolean;
}

// Chromium's ERR_ABORTED: a load replaced by another one, not a failure.
const ERR_ABORTED = -3;

// Best-effort UA sniff: webview is only meaningful inside Electron. Outside
// (e.g. running apps/ui standalone in a regular browser) the tag is inert, so
// we render a plain iframe instead and skip the inspector.
const isElectron = (): boolean => {
	if ( typeof navigator === 'undefined' ) return false;
	return /\bElectron\//.test( navigator.userAgent );
};

interface PreviewWindow extends Window {
	ipcApi?: {
		clearWebviewCache?: ( webContentsId: number ) => Promise< void >;
		getWebviewNavigationHistory?: ( webContentsId: number ) => Promise< {
			activeIndex: number;
			entries: BrowserHistoryEntry[];
		} >;
		goToWebviewNavigationHistoryEntry?: ( webContentsId: number, index: number ) => Promise< void >;
	};
}

function getWebviewContentsId( webview: WebviewTag ): number {
	const webContentsId = webview.getWebContentsId?.();
	if ( ! webContentsId ) {
		throw new Error( 'Preview webview is not ready.' );
	}
	return webContentsId;
}

// Reloading always drops the HTTP cache: it keeps edited CSS/JS from being
// served stale, and it's the only way to shake a cached 301 (Chrome keeps those
// through every reload variant). When such a redirect has already moved the
// webview onto another origin, reload() would reload *that*, so navigate.
async function reloadPreview(
	webview: WebviewTag,
	intendedUrl: string,
	currentUrl: string
): Promise< void > {
	const { ipcApi } = window as PreviewWindow;
	try {
		await ipcApi?.clearWebviewCache?.( getWebviewContentsId( webview ) );
	} catch {
		// No IPC bridge, or the webview isn't ready.
	}
	if ( isOffOriginRedirect( currentUrl, intendedUrl ) ) {
		await webview.loadURL( intendedUrl ).catch( () => undefined );
		return;
	}
	webview.reload?.();
}

export function isOffOriginRedirect( settledUrl: string, intendedUrl: string ): boolean {
	try {
		return new URL( settledUrl ).origin !== new URL( intendedUrl ).origin;
	} catch {
		return false;
	}
}

const EMPTY_BROWSER_STATE: BrowserNavigationState = {
	canGoBack: false,
	canGoForward: false,
	loading: false,
	progress: 0,
	title: null,
	historyEntries: [],
	activeHistoryIndex: -1,
	failed: false,
};

// Where each realm segment lands before its per-realm memory has anything better.
const DEFAULT_REALM_PATHS: Record< PreviewRealm, string > = {
	frontend: '/',
	admin: '/wp-admin/',
	database: DATABASE_HOME_PATH,
	design: DESIGN_SYSTEM_PREVIEW_PATH,
};

/**
 * Realms that share a browsing session share a surface.
 *
 * The front end and WP Admin link to each other and share a login, so they stay
 * one webview: one history stack, and a page loaded after signing in reflects
 * it. phpMyAdmin is a separate tool nothing links to, and the only realm that
 * isn't responsive — so it gets its own surface, which never resizes when the
 * preview flips to it. The design system isn't a web page: Studio renders it.
 */
type PreviewSurfaceKey = 'site' | 'database' | 'design';

function getSurfaceKey( realm: PreviewRealm ): PreviewSurfaceKey {
	return realm === 'frontend' || realm === 'admin' ? 'site' : realm;
}

// A mounted preview surface: its url, plus the load state and pending commands
// belonging to that webview. Kept alive once created so returning to it is a
// reload at its own size rather than a resize plus a fresh load.
interface PreviewSurfaceState {
	path: string;
	browser: BrowserNavigationState;
	// The annotation inspector is running in the page.
	inspectorReady: boolean;
	browserCommand: BrowserCommand | null;
	reloadNonce: number;
}

type PreviewSurfaces = Partial< Record< PreviewSurfaceKey, PreviewSurfaceState > >;

// Surfaces belong to the site they were opened for, so the owning id travels
// with them: moving to another site replaces the whole set rather than leaving
// the previous site's webviews behind.
interface MountedSurfaces {
	siteId: string;
	byKey: PreviewSurfaces;
}

function createPreviewSurface( path: string, reloadNonce: number ): PreviewSurfaceState {
	return {
		path,
		browser: EMPTY_BROWSER_STATE,
		inspectorReady: false,
		browserCommand: null,
		reloadNonce,
	};
}

function arePreviewSurfacesEqual( a: PreviewSurfaceState, b: PreviewSurfaceState ) {
	return (
		a.path === b.path &&
		a.reloadNonce === b.reloadNonce &&
		a.browserCommand === b.browserCommand &&
		a.inspectorReady === b.inspectorReady &&
		areBrowserStatesEqual( a.browser, b.browser )
	);
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
		label: shortcutAriaLabel.primary( key ),
	};
}

function getNavigationShortcutDescriptor( direction: 'back' | 'forward' ) {
	const isApple = isAppleOS();
	const arrow = direction === 'back' ? '←' : '→';
	const arrowKey = direction === 'back' ? 'ArrowLeft' : 'ArrowRight';
	const bracket = direction === 'back' ? '[' : ']';
	const arrowLabel = direction === 'back' ? __( 'Left Arrow' ) : __( 'Right Arrow' );
	return {
		displayShortcut: isApple ? `⌘${ arrow }` : `Alt+${ arrow }`,
		ariaKeyShortcut: `${ isApple ? 'Meta' : 'Alt' }+${ arrowKey } ${ ariaKeyShortcut.primary(
			bracket
		) }`,
		label: isApple ? `${ __( 'Command' ) } ${ arrowLabel }` : `${ __( 'Alt' ) } + ${ arrowLabel }`,
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
): BrowserShortcutCommand | null {
	if ( event.defaultPrevented || event.repeat ) {
		return null;
	}
	// ⌘⇧R is accepted as an alias so the browser habit isn't a dead key.
	if ( isKeyboardEvent.primary( event, 'r' ) || isKeyboardEvent.primaryShift( event, 'r' ) ) {
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

function AnnotateButton( {
	active,
	disabled,
	disabledReason,
	iconOnly,
	onClick,
}: {
	active: boolean;
	disabled: boolean;
	disabledReason?: string;
	iconOnly: boolean;
	onClick: () => void;
} ) {
	return (
		<span
			className={ styles.disabledControlTooltipTarget }
			title={ disabled ? disabledReason : undefined }
		>
			<Tooltip>
				<TooltipTrigger
					render={
						<Button
							variant="ghost"
							className={ clsx( styles.annotateButton, active && styles.annotateButtonActive ) }
							aria-label={ __( 'Annotate' ) }
							aria-pressed={ active }
							aria-description={
								disabled
									? disabledReason
									: active
									? __( 'Exit annotation mode. Your notes will be kept.' )
									: undefined
							}
							disabled={ disabled }
							onClick={ onClick }
						>
							<Icon icon={ annotateIcon } size={ 16 } data-icon="inline-start" />
							{ iconOnly ? null : <span>{ __( 'Annotate' ) }</span> }
						</Button>
					}
				/>
				<TooltipContent side="bottom">
					{ disabledReason ?? ( active ? __( 'Exit annotation mode' ) : __( 'Annotate' ) ) }
				</TooltipContent>
			</Tooltip>
		</span>
	);
}

export function getDirectionalHistoryEntries(
	entries: BrowserHistoryEntry[],
	activeIndex: number,
	direction: 'back' | 'forward'
): BrowserHistoryEntry[] {
	const directional = entries.filter( ( entry ) =>
		direction === 'back' ? entry.index < activeIndex : entry.index > activeIndex
	);
	return direction === 'back' ? directional.reverse() : directional;
}

function getHistoryEntryPath( url: string ) {
	try {
		const parsed = new URL( url );
		return `${ parsed.pathname }${ parsed.search }${ parsed.hash }`;
	} catch {
		return url;
	}
}

function BrowserHistoryButton( {
	direction,
	browserState,
	shortcut,
	disabled: disabledByHost,
	onStep,
	onJump,
}: {
	direction: 'back' | 'forward';
	browserState: BrowserNavigationState;
	disabled: boolean;
	shortcut: ReturnType< typeof getNavigationShortcutDescriptor >;
	onStep: () => void;
	onJump: ( index: number ) => void;
} ) {
	const entries = getDirectionalHistoryEntries(
		browserState.historyEntries,
		browserState.activeHistoryIndex,
		direction
	);
	const back = direction === 'back';
	const label = back ? __( 'Back' ) : __( 'Forward' );
	const disabled =
		disabledByHost || ( back ? ! browserState.canGoBack : ! browserState.canGoForward );
	const [ menuOpen, setMenuOpen ] = useState( false );
	const trigger = (
		<IconButton
			icon={ back ? browserBackIcon : browserForwardIcon }
			label={ label }
			shortcut={ shortcut }
			tooltipSide="bottom"
			disabled={ disabled }
			disabledAppearance="icon"
			onClick={ onStep }
			onContextMenu={ ( event ) => {
				event.preventDefault();
				setMenuOpen( true );
			} }
		/>
	);

	return (
		<Menu.Root
			open={ menuOpen }
			onOpenChange={ ( open ) => {
				if ( ! open ) {
					setMenuOpen( false );
				}
			} }
		>
			<Menu.Trigger render={ trigger } />
			<Menu.Popup side="bottom" align="start">
				{ entries.length ? (
					entries.map( ( entry ) => (
						<Menu.Item
							key={ `${ entry.index }:${ entry.url }` }
							onClick={ () => onJump( entry.index ) }
						>
							<span className={ styles.historyEntry }>
								<span className={ styles.historyTitle }>
									{ entry.title || getHistoryEntryPath( entry.url ) }
								</span>
								<span className={ styles.historyPath }>{ getHistoryEntryPath( entry.url ) }</span>
							</span>
						</Menu.Item>
					) )
				) : (
					<Menu.Item disabled>
						{ back ? __( 'No back history' ) : __( 'No forward history' ) }
					</Menu.Item>
				) }
			</Menu.Popup>
		</Menu.Root>
	);
}

function PreviewLoadFailed( { onRetry }: { onRetry: () => void } ) {
	return (
		<Empty className={ styles.loadFailed }>
			<EmptyMedia>
				<Icon icon={ globeIcon } />
			</EmptyMedia>
			<EmptyTitle>{ __( 'Preview could not load' ) }</EmptyTitle>
			<EmptyDescription>
				{ __( 'Check that your site is running, then try again.' ) }
			</EmptyDescription>
			<Button variant="outline" onClick={ onRetry }>
				{ __( 'Try again' ) }
			</Button>
		</Empty>
	);
}

function areBrowserStatesEqual( a: BrowserNavigationState, b: BrowserNavigationState ) {
	return (
		a.canGoBack === b.canGoBack &&
		a.canGoForward === b.canGoForward &&
		a.loading === b.loading &&
		a.progress === b.progress &&
		a.title === b.title &&
		a.failed === b.failed &&
		a.activeHistoryIndex === b.activeHistoryIndex &&
		a.historyEntries.length === b.historyEntries.length &&
		a.historyEntries.every( ( entry, index ) => {
			const other = b.historyEntries[ index ];
			return other?.index === entry.index && other.title === entry.title && other.url === entry.url;
		} )
	);
}

export function SitePreview( {
	site,
	liveUrl,
	path,
	reloadNonce,
	onSendAnnotations,
	onPathChange,
	collapsed = false,
	toolbarStart,
	atWindowStart = false,
}: SitePreviewProps ) {
	const connector = useConnector();
	const queryClient = useQueryClient();
	const openSettings = useOpenSettings();
	const { chatEnabled } = useAgenticFeatures();
	const operation = useSiteOperation( site );
	const startPending = useIsSiteStarting( site.id );
	const stopPending = useIsSiteStopping( site.id );
	const live = !! liveUrl;
	// This window's own start or stop lands before the CLI records it.
	const isStarting = ! live && ( startPending || operation === 'start' );
	const isStopping = ! live && ( stopPending || operation === 'stop' );
	const otherOperation = isStarting || isStopping ? null : operation;
	const siteUrl = liveUrl ?? getSiteUrl( site );
	const canPreview = live || site.running;
	const canUseWebview = isElectron();
	const trafficLightSpace = useTrafficLightSpace();
	const sidebarCollapsed = useSidebarCollapsed();
	const windowControlsInset = useWindowControlsInset( 'toolbar' );
	const safePath = getSafePath( path );
	// Which realm the host is pointing the preview at. Derived from the path
	// rather than stored alongside it, so the parent stays the single source of
	// truth for where the preview is aimed.
	const activeRealm = getPreviewRealm( safePath );
	const activeSurfaceKey = getSurfaceKey( activeRealm );
	const siteDesign = useSiteDesign( site );
	const siteIcon = useSiteIcon( site.id );
	const siteThumbnail = useSiteThumbnail( site.id, { enabled: ! canPreview } );
	// Surfaces mounted so far. Once created a surface stays mounted and warm;
	// only the active one is visible.
	const [ surfaces, setSurfaces ] = useState< MountedSurfaces >( () => ( {
		siteId: site.id,
		byKey: { [ activeSurfaceKey ]: createPreviewSurface( safePath, reloadNonce ) },
	} ) );
	const activeSurface = surfaces.byKey[ activeSurfaceKey ];
	const browserState = activeSurface?.browser ?? EMPTY_BROWSER_STATE;
	const annotations = useSiteAnnotations( site.id );
	// A site that was just started keeps its loading stage over the preview
	// until the first page arrives.
	const [ awaitingReveal, setAwaitingReveal ] = useState( false );
	useEffect( () => {
		if ( isStarting ) {
			setAwaitingReveal( true );
		} else if ( ! canPreview ) {
			setAwaitingReveal( false );
		}
	}, [ canPreview, isStarting ] );
	const loadingStage = isStarting || ( awaitingReveal && activeSurfaceKey !== 'design' );
	const [ annotationAnchor, setAnnotationAnchor ] = useState< AnnotationAnchor | null >( null );
	const commandIdRef = useRef( 0 );
	// Studio renders the design system itself, so it needs no page injection.
	const showAnnotate =
		! live &&
		canPreview &&
		chatEnabled &&
		( connector.capabilities.annotatePreview || activeSurfaceKey === 'design' );
	const canAnnotateSurface = showAnnotate && activeSurfaceKey !== 'database';
	const canAnnotate =
		canAnnotateSurface &&
		( activeSurfaceKey === 'design' ? !! siteDesign.data : !! activeSurface?.inspectorReady );
	const progress = browserState.loading
		? Math.max( browserState.progress, 0.12 )
		: browserState.progress;
	const showLoadingProgress = canPreview && progress > 0;
	const patchSurface = useCallback(
		( key: PreviewSurfaceKey, patch: Partial< PreviewSurfaceState > ) => {
			setSurfaces( ( current ) => {
				const surface = current.byKey[ key ];
				if ( ! surface ) {
					return current;
				}
				const next = { ...surface, ...patch };
				return arePreviewSurfacesEqual( surface, next )
					? current
					: { ...current, byKey: { ...current.byKey, [ key ]: next } };
			} );
		},
		[]
	);
	const handleSurfaceNavigation = useCallback(
		( key: PreviewSurfaceKey, url: string ) => {
			const nextPath = getPathFromPreviewUrl( url, siteUrl );
			if ( ! nextPath ) {
				return;
			}
			patchSurface( key, { path: nextPath } );
			// Only the visible surface speaks for the preview's location, so the
			// hidden one settling a redirect can't move the address bar. This is also
			// what lights up the WordPress segment when a front-end link points at
			// wp-admin: same surface, new path, new realm.
			if ( key === activeSurfaceKey && nextPath !== safePath ) {
				onPathChange?.( nextPath );
			}
		},
		[ activeSurfaceKey, onPathChange, patchSurface, safePath, siteUrl ]
	);
	// Commands are addressed to the surface on screen. Each has its own slot, so
	// the hidden one never sees a command it should have missed — and never
	// replays a stale one when it comes back into view.
	const sendSurfaceCommand = useCallback(
		( key: PreviewSurfaceKey, type: BrowserCommand[ 'type' ] ) => {
			if ( key === 'design' ) {
				if ( type === 'reload' ) {
					void queryClient.invalidateQueries( { queryKey: siteDesignQueryKey( site.id ) } );
				}
				return;
			}
			commandIdRef.current += 1;
			patchSurface( key, { browserCommand: { id: commandIdRef.current, type } } );
		},
		[ patchSurface, queryClient, site.id ]
	);
	const sendBrowserCommand = useCallback(
		( type: BrowserCommand[ 'type' ] ) => sendSurfaceCommand( activeSurfaceKey, type ),
		[ activeSurfaceKey, sendSurfaceCommand ]
	);
	const goToHistoryIndex = useCallback(
		( historyIndex: number ) => {
			commandIdRef.current += 1;
			patchSurface( activeSurfaceKey, {
				browserCommand: {
					id: commandIdRef.current,
					type: 'go-to-history',
					historyIndex,
				},
			} );
		},
		[ activeSurfaceKey, patchSurface ]
	);
	useEffect( () => {
		if ( ! canAnnotateSurface ) {
			setAnnotating( site.id, false );
		}
	}, [ canAnnotateSurface, site.id ] );
	useEffect( () => {
		setAnnotationAnchor( null );
	}, [ activeSurfaceKey, site.id ] );
	// Anchors arrive in client coordinates; the overlay sits on the viewport.
	const toViewportAnchor = useCallback( ( anchor: AnnotationAnchor | null ) => {
		const box = viewportRef.current?.getBoundingClientRect();
		return anchor && box ? { left: anchor.left - box.left, top: anchor.top - box.top } : null;
	}, [] );
	const handleAnnotationPick = useCallback(
		( target: VisualAnnotationTarget, anchor: AnnotationAnchor ) => {
			if ( pickAnnotation( site.id, target ) ) {
				setAnnotationAnchor( toViewportAnchor( anchor ) );
			}
		},
		[ site.id, toViewportAnchor ]
	);
	const sendAnnotations = useCallback(
		( noteIds?: string[] ) => {
			onSendAnnotations?.( site.id, noteIds );
			if ( ! noteIds ) {
				setAnnotating( site.id, false );
			}
		},
		[ onSendAnnotations, site.id ]
	);
	// Keeps the page that just loaded as the site's picture for while it's
	// stopped, once the page has had a moment to settle.
	const viewportRef = useRef< HTMLDivElement | null >( null );
	const [ loadedPage, setLoadedPage ] = useState< { url: string; guestId?: number } | null >(
		null
	);
	const handleSurfaceLoad = useCallback(
		( key: PreviewSurfaceKey, url: string, guestId?: number ) => {
			setAwaitingReveal( false );
			if ( key === 'site' && ! live ) {
				setLoadedPage( { url, guestId } );
			}
		},
		[ live ]
	);
	const handleSurfaceBrowserState = useCallback(
		( key: PreviewSurfaceKey, browser: BrowserNavigationState ) => {
			patchSurface( key, { browser } );
			if ( browser.failed ) {
				setAwaitingReveal( false );
			}
		},
		[ patchSurface ]
	);
	useEffect( () => {
		const pagePath = loadedPage && getPathFromPreviewUrl( loadedPage.url, siteUrl );
		if ( ! pagePath ) {
			return;
		}
		const timer = setTimeout( () => {
			const viewport = viewportRef.current;
			if ( ! viewport?.clientWidth || ! viewport.clientHeight ) {
				return;
			}
			void connector
				.captureSitePreview( site.id, {
					path: pagePath,
					width: Math.min( viewport.clientWidth, 2400 ),
					height: Math.min( viewport.clientHeight, 2400 ),
					guestId: loadedPage.guestId,
				} )
				.then( ( thumbnail ) => {
					if ( thumbnail ) {
						queryClient.setQueryData( siteThumbnailQueryKey( site.id ), thumbnail );
					}
				} )
				.catch( () => undefined );
		}, 240 );
		return () => clearTimeout( timer );
	}, [ connector, loadedPage, queryClient, site.id, siteUrl ] );

	// Shortcuts the guest page swallowed and forwarded back over the console
	// bridge, for the webview.
	const handleInspectorEvent = useCallback(
		( event: InspectorEvent ) => {
			const editingId = getSiteAnnotations( site.id ).editingId;
			if ( event.type === 'browser-command' ) {
				sendBrowserCommand( event.command );
			} else if ( event.type === 'escape' ) {
				escapeAnnotations( site.id );
			} else if ( event.type === 'pick' ) {
				handleAnnotationPick( event.target, event.anchor );
			} else if ( event.type === 'edit' ) {
				editAnnotation( site.id, event.id );
				setAnnotationAnchor( toViewportAnchor( event.anchor ) );
			} else if ( event.id === editingId ) {
				const next = toViewportAnchor( event.anchor );
				setAnnotationAnchor( ( current ) =>
					current?.left === next?.left && current?.top === next?.top ? current : next
				);
			}
		},
		[ handleAnnotationPick, sendBrowserCommand, site.id, toViewportAnchor ]
	);

	// Point the active surface at whatever path the host is asking for, creating
	// it the first time it's needed. The other surface keeps the url it was left
	// on, so it doesn't reload. A brand-new surface starts level with the host's
	// reload nonce, so mounting it doesn't count as a reload request.
	useEffect( () => {
		setSurfaces( ( current ) => {
			const mounted = createPreviewSurface( safePath, reloadNonce );
			if ( current.siteId !== site.id ) {
				return { siteId: site.id, byKey: { [ activeSurfaceKey ]: mounted } };
			}
			const surface = current.byKey[ activeSurfaceKey ];
			if ( ! surface ) {
				return { ...current, byKey: { ...current.byKey, [ activeSurfaceKey ]: mounted } };
			}
			return surface.path === safePath
				? current
				: {
						...current,
						byKey: { ...current.byKey, [ activeSurfaceKey ]: { ...surface, path: safePath } },
				  };
		} );
	}, [ activeSurfaceKey, reloadNonce, safePath, site.id ] );

	// A host-driven reload targets what's on screen. Tracked against the last
	// seen nonce so a switch doesn't replay it on the surface arrived at. WP
	// Admin is left alone: the person may be working there, with unsaved edits
	// in the editor, and a reload would interrupt them.
	const lastHostReloadNonceRef = useRef( reloadNonce );
	useEffect( () => {
		if ( lastHostReloadNonceRef.current === reloadNonce ) {
			return;
		}
		lastHostReloadNonceRef.current = reloadNonce;
		if ( activeRealm === 'admin' ) {
			return;
		}
		if ( activeSurfaceKey === 'design' ) {
			sendSurfaceCommand( 'design', 'reload' );
		} else {
			patchSurface( activeSurfaceKey, { reloadNonce } );
		}
	}, [ activeRealm, activeSurfaceKey, patchSurface, reloadNonce, sendSurfaceCommand ] );

	// Where each realm was last seen, so flipping to WP Admin and back returns
	// to the exact front-end page rather than the site root.
	const lastRealmPathsRef = useRef< Record< PreviewRealm, string > >( {
		...DEFAULT_REALM_PATHS,
	} );
	useEffect( () => {
		lastRealmPathsRef.current = { ...DEFAULT_REALM_PATHS };
	}, [ site.id ] );
	useEffect( () => {
		// Auto-login is a transient hop, not a place to return to.
		if ( safePath.startsWith( '/studio-auto-login' ) ) {
			return;
		}
		lastRealmPathsRef.current[ getPreviewRealm( safePath ) ] = safePath;
	}, [ safePath ] );

	// Realm segments (front end / WP Admin / database). Moving between the front
	// end and WP Admin is a navigation inside the shared site surface, so they
	// keep one history and one login; admin targets go through the site's
	// /studio-auto-login endpoint so they never land on the login form. Moving to
	// another surface reloads it, so it shows what changed while it was hidden.
	const handleSwitchRealm = useCallback(
		( realm: PreviewRealm ) => {
			// Re-selecting the active realm (e.g. via its shortcut) is a no-op.
			if ( activeRealm === realm ) {
				return;
			}
			// The agentic UI opens the realm in its in-app preview panel.
			void connector.trackEvent( getRealmOpenEvent( realm ), { browser: 'internal' } );
			const target = lastRealmPathsRef.current[ realm ];
			const key = getSurfaceKey( realm );
			if ( surfaces.byKey[ key ]?.path === target ) {
				sendSurfaceCommand( key, 'reload' );
				onPathChange?.( target );
				return;
			}
			onPathChange?.( getRealmNavigationPath( target, siteUrl ) );
		},
		[ activeRealm, connector, onPathChange, sendSurfaceCommand, siteUrl, surfaces ]
	);

	const browserShortcuts = useMemo(
		() => ( {
			back: getNavigationShortcutDescriptor( 'back' ),
			forward: getNavigationShortcutDescriptor( 'forward' ),
			reload: getBrowserShortcutDescriptor( 'r' ),
		} ),
		[]
	);

	// Browser shortcuts (⌘R / ⌘[ / ⌘] / ⌘←/⌘→) pressed anywhere in the host
	// document but a dialog, the composer included. Shortcuts pressed inside the
	// guest page are forwarded by the inspector script through the console
	// bridge instead.
	useEffect( () => {
		if ( ! canPreview || isStopping || collapsed ) {
			return;
		}
		const handleKeyDown = ( event: globalThis.KeyboardEvent ) => {
			const command = getBrowserShortcutCommand( event );
			if ( ! command || isDialogOpen() ) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			sendBrowserCommand( command );
		};

		document.addEventListener( 'keydown', handleKeyDown, { capture: true } );
		return () => document.removeEventListener( 'keydown', handleKeyDown, { capture: true } );
	}, [ canPreview, collapsed, isStopping, sendBrowserCommand ] );

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
	const openSiteSettings = () => openSettings( 'site', site.id );
	const { host: headerHost, layout: headerLayout } = useSiteHeader();
	useSiteHeaderNavigation(
		canPreview && ! collapsed
			? {
					canGoBack: browserState.canGoBack,
					canGoForward: browserState.canGoForward,
					disabled: isStopping,
					back: () => sendBrowserCommand( 'back' ),
					forward: () => sendBrowserCommand( 'forward' ),
					reload: () => sendBrowserCommand( 'reload' ),
					settings: openSiteSettings,
					openExternal,
					backShortcut: browserShortcuts.back.displayShortcut,
					forwardShortcut: browserShortcuts.forward.displayShortcut,
			  }
			: null
	);

	return (
		<aside className={ styles.root } aria-label={ __( 'Site preview' ) }>
			<div
				data-site-header
				className={ clsx(
					styles.header,
					atWindowStart && sidebarCollapsed && trafficLightSpace.start && styles.headerTrafficLights
				) }
				style={ {
					// In RTL the preview pane sits at the physical left, so the
					// header's end-side controls land under the macOS traffic
					// lights — pad past them.
					...( trafficLightSpace.end && { paddingInlineEnd: 96 } ),
					...( windowControlsInset > 0 && {
						paddingRight: windowControlsInset + 8,
					} ),
				} }
			>
				{ /* Browser navigation stays at the start, the address field fills the
					available middle track, and preview actions stay at the end. */ }
				<div className={ styles.headerSide }>
					{ toolbarStart ? (
						<div data-site-header-reserved className={ styles.toolbarStart }>
							{ toolbarStart }
						</div>
					) : null }
					{ canPreview ? (
						<div
							data-site-header-navigation
							className={ clsx(
								styles.navigation,
								headerLayout === 'navigation-overflow' && styles.navigationHidden
							) }
							aria-hidden={ headerLayout === 'navigation-overflow' || undefined }
							inert={ headerLayout === 'navigation-overflow' }
						>
							{ browserState.canGoBack || browserState.canGoForward ? (
								<>
									<BrowserHistoryButton
										direction="back"
										browserState={ browserState }
										shortcut={ browserShortcuts.back }
										disabled={ isStopping }
										onStep={ () => sendBrowserCommand( 'back' ) }
										onJump={ goToHistoryIndex }
									/>
									<BrowserHistoryButton
										direction="forward"
										browserState={ browserState }
										shortcut={ browserShortcuts.forward }
										disabled={ isStopping }
										onStep={ () => sendBrowserCommand( 'forward' ) }
										onJump={ goToHistoryIndex }
									/>
								</>
							) : null }
							<IconButton
								icon={ refreshIcon }
								label={ __( 'Reload preview' ) }
								shortcut={ browserShortcuts.reload }
								tooltipSide="bottom"
								disabled={ isStopping }
								onClick={ () => sendBrowserCommand( 'reload' ) }
							/>
						</div>
					) : null }
				</div>
				<div
					className={ styles.browserLocation }
					data-site-header-address={ ( canPreview && ! isStarting && ! isStopping ) || undefined }
				>
					{ isStarting || isStopping ? (
						<span role="status" className={ styles.addressStatus }>
							{ isStopping ? __( 'Stopping site…' ) : __( 'Starting site…' ) }
						</span>
					) : canPreview ? (
						<PreviewAddressBar
							site={ site }
							siteIcon={ siteIcon }
							siteUrl={ siteUrl }
							path={ getSafePath( path ) }
							remote={ live }
							onNavigate={ ( nextPath ) => onPathChange?.( nextPath ) }
							onSwitchRealm={ handleSwitchRealm }
							hasDesignSystem={ !! siteDesign.data }
							onOpenExternal={ openExternal }
							onOpenSettings={ live ? undefined : openSiteSettings }
							hideActions={ headerLayout !== 'inline' }
						/>
					) : null }
				</div>
				<div className={ clsx( styles.headerSide, styles.headerSideEnd ) }>
					{ showAnnotate ? (
						<span data-site-header-annotate className={ styles.headerItem }>
							<AnnotateButton
								active={ annotations.active }
								disabled={ ! canAnnotate || isAnnotationsBusy( annotations ) }
								disabledReason={
									activeSurfaceKey === 'database' ? __( 'Not available for Database' ) : undefined
								}
								iconOnly={ headerLayout !== 'inline' }
								onClick={ () => setAnnotating( site.id, ! annotations.active ) }
							/>
						</span>
					) : null }
					{ headerHost === 'preview' && ! collapsed ? <SiteHeaderSpace /> : null }
				</div>
				{ showLoadingProgress ? (
					<div className={ styles.loadingProgress } aria-hidden="true">
						<span style={ { transform: `scaleX(${ Math.min( progress, 1 ) })` } } />
					</div>
				) : null }
			</div>
			<div className={ styles.body }>
				<div ref={ viewportRef } className={ styles.previewViewport }>
					{ canPreview &&
						// One stacked layer per mounted surface. Only the active layer is
						// visible; the other stays mounted and laid out at its own size, so
						// coming back to it is a reload with nothing to resize or re-emulate.
						( Object.keys( surfaces.byKey ) as PreviewSurfaceKey[] ).map( ( key ) => {
							const surface = surfaces.byKey[ key ];
							if ( ! surface ) {
								return null;
							}
							const active = key === activeSurfaceKey;
							const surfaceUrl = `${ siteUrl }${ surface.path }`;
							if ( key === 'design' ) {
								return (
									<div
										key={ key }
										className={ clsx( styles.realmLayer, ! active && styles.realmLayerHidden ) }
										inert={ active ? undefined : true }
									>
										<div className={ clsx( styles.surfaceFrame, styles.designSurface ) }>
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
										</div>
									</div>
								);
							}
							return (
								<div
									key={ key }
									className={ clsx( styles.realmLayer, ! active && styles.realmLayerHidden ) }
									inert={ active ? undefined : true }
								>
									<div className={ styles.surfaceFrame }>
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
												onBrowserStateChange={ ( state ) =>
													handleSurfaceBrowserState( key, state )
												}
												onNavigate={ ( url ) => handleSurfaceNavigation( key, url ) }
												onLoad={ ( url, guestId ) => handleSurfaceLoad( key, url, guestId ) }
											/>
										) : (
											// Non-Electron fallback: plain iframe, no inspector. Reloads
											// by remounting; back/forward aren't reachable from the host.
											<iframe
												key={ `${ surfaceUrl }#${ surface.reloadNonce }#${
													surface.browserCommand?.type === 'reload' ? surface.browserCommand.id : 0
												}` }
												className={ styles.iframe }
												src={ surfaceUrl }
												title={ site.name }
												onLoad={ ( event ) => {
													const { src } = event.currentTarget;
													const title = getIframeTitle( event.currentTarget );
													handleSurfaceNavigation( key, src );
													// A frame fires `load` for the browser's own error page too, and
													// it's cross-origin, so ask the server whether it's there at all.
													void fetch( src, {
														method: 'HEAD',
														mode: 'no-cors',
														cache: 'no-store',
													} )
														.then(
															() => false,
															() => true
														)
														.then( ( failed ) => {
															if ( ! failed ) {
																handleSurfaceLoad( key, src );
															}
															handleSurfaceBrowserState( key, {
																...EMPTY_BROWSER_STATE,
																title,
																failed,
															} );
														} );
												} }
											/>
										) }
										{ surface.browser.failed ? (
											<PreviewLoadFailed onRetry={ () => sendSurfaceCommand( key, 'reload' ) } />
										) : null }
									</div>
								</div>
							);
						} ) }
					<SiteContextMenu site={ site } disabled={ canPreview }>
						<div
							className={ styles.empty }
							data-revealed={ canPreview && ! loadingStage ? true : undefined }
						>
							<PreviewParticles active={ loadingStage } showLogo={ loadingStage } />
							{ loadingStage ? (
								<VisuallyHidden role="status">{ __( 'Loading site preview' ) }</VisuallyHidden>
							) : null }
							{ canPreview ? null : (
								<div className={ styles.emptyContent }>
									{ isStarting ? null : <StoppedSitePreview site={ site } /> }
									{ otherOperation || ( ! isStarting && ! siteThumbnail.data ) ? (
										<p className={ styles.emptyText }>
											{ otherOperation
												? sprintf(
														/* translators: %s: an operation in progress, e.g. "Saving settings". */
														__( '%s… the site can start once this finishes.' ),
														getSiteOperationLabel( otherOperation )
												  )
												: __( 'Start the site to see a live preview.' ) }
										</p>
									) : null }
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

function getSafePath( path: unknown ) {
	return typeof path === 'string' && path.trim() ? path : '/';
}

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
function WebviewSurface( {
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
			const { ipcApi } = window as PreviewWindow;
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
				const { ipcApi } = window as PreviewWindow;
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
