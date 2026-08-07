import { getSiteOperationLabel } from '@studio/common/lib/site-operation-labels';
import { useQuery } from '@tanstack/react-query';
import { __, sprintf } from '@wordpress/i18n';
import { chevronLeft, chevronRight, moreVertical, pencil } from '@wordpress/icons';
import { ariaKeyShortcut, displayShortcut, isAppleOS, isKeyboardEvent } from '@wordpress/keycodes';
import { Button, IconButton } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DotGrid } from '@/components/dot-grid';
import * as Menu from '@/components/menu';
import { OpenInMenu } from '@/components/open-in-menu';
import { useConnector } from '@/data/core';
import { useAgenticFeatures } from '@/data/queries/use-agentic-features';
import {
	useIsSiteBusy,
	useIsSiteStarting,
	useSiteOperation,
	useStartSite,
} from '@/data/queries/use-sites';
import { useTrafficLightSpace } from '@/hooks/use-traffic-light-space';
import { useWindowControlsOverlay } from '@/hooks/use-window-controls-overlay';
import { getSiteUrl } from '@/lib/get-site-url';
import { playIcon, refreshIcon } from '@/lib/icons';
import {
	DATABASE_HOME_PATH,
	getPathFromPreviewUrl,
	getPreviewRealm,
	getRealmNavigationPath,
	getRealmOpenEvent,
	PreviewAddressBar,
	REALM_SHORTCUT_KEYS,
	useDebouncedValue,
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
import type { CSSProperties } from 'react';

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
	// True while the preview fills the whole window (sidebar and chat hidden).
	fullscreen?: boolean;
	// Enters/leaves full preview. The "•••" menu only offers it when provided.
	onFullscreenChange?: ( value: boolean ) => void;
}

interface InspectorEvent {
	type: 'browser-command' | 'done' | 'state';
	annotations?: Annotation[];
	isPicking?: boolean;
	annotationCount?: number;
	command?: PreviewShortcutCommandType;
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

// What the guest page can forward over the console bridge: the browser
// commands it swallows, plus the full-preview toggle (the webview covers most
// of the window in full preview, so the host listener alone would miss it).
type PreviewShortcutCommandType = BrowserShortcutCommandType | 'full-preview';

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

// Best-effort UA sniff: webview is only meaningful inside Electron. Outside
// (e.g. running apps/ui standalone in a regular browser) the tag is inert, so
// we render a plain iframe instead and skip the inspector.
const isElectron = (): boolean => {
	if ( typeof navigator === 'undefined' ) return false;
	return /\bElectron\//.test( navigator.userAgent );
};

interface ViewportPreset {
	id: 'mobile' | 'tablet' | 'desktop';
	// Emulated CSS dimensions; the frame keeps this exact size and scales
	// down to fit the pane.
	width: number;
	height: number;
	// Report the emulated viewport to the page as a mobile device.
	mobile?: boolean;
}

// Simulated-viewport presets, rendered as fixed-size device frames scaled
// to fit the pane: an iPhone-class phone, an iPad-class tablet, and a
// 16:10 laptop.
const VIEWPORT_PRESETS: readonly ViewportPreset[] = [
	{ id: 'mobile', width: 390, height: 844, mobile: true },
	{ id: 'tablet', width: 768, height: 1024 },
	{ id: 'desktop', width: 1440, height: 900 },
];

// The preview's viewport mode: natural pane size, one simulated preset, or
// the side-by-side comparison of the desktop and mobile presets.
type ViewportMode = 'fit' | ViewportPreset[ 'id' ] | 'split';

// The split view reuses the desktop and mobile presets for its two panes.
const MOBILE_PRESET = VIEWPORT_PRESETS[ 0 ];
const DESKTOP_PRESET = VIEWPORT_PRESETS[ 2 ];

// The phone frame's orientation, shared by the mobile preset and the split
// view. Landscape rotates the frame a quarter turn (844×390).
type MobileOrientation = 'portrait' | 'landscape';

const MOBILE_PRESET_LANDSCAPE: ViewportPreset = {
	...MOBILE_PRESET,
	width: MOBILE_PRESET.height,
	height: MOBILE_PRESET.width,
};

function getMobilePreset( orientation: MobileOrientation ): ViewportPreset {
	return orientation === 'landscape' ? MOBILE_PRESET_LANDSCAPE : MOBILE_PRESET;
}

// The preset behind the primary preview surface, or null when the pane
// renders at its natural size. The split view's primary frame is the desktop
// preset; its phone companion is sized separately.
function getActivePreset(
	mode: ViewportMode,
	orientation: MobileOrientation
): ViewportPreset | null {
	if ( mode === 'mobile' ) {
		return getMobilePreset( orientation );
	}
	if ( mode === 'split' ) {
		return DESKTOP_PRESET;
	}
	return VIEWPORT_PRESETS.find( ( preset ) => preset.id === mode ) ?? null;
}

// Breathing room around the split view's phone frame (matches the pane's
// CSS padding, subtracted before computing the frame's fit-to-height scale).
const SPLIT_MOBILE_PANE_PADDING = 16;

// A simulated guest viewport: the page lays out at `width`×`height` CSS px
// and its rendering is scaled by `scale` to fit the preview pane. `mobile`
// makes the emulation report a mobile device, so meta-viewport handling and
// responsive behavior match a real phone.
export interface PreviewViewport {
	width: number;
	height: number;
	scale: number;
	mobile?: boolean;
}

/**
 * The viewport to simulate for a preset inside a pane of the given size:
 * the preset's exact dimensions, scaled down (never up) to fit both axes,
 * like a device frame.
 */
export function getSimulatedViewport(
	preset: { width: number; height: number; mobile?: boolean } | null,
	pane: { width: number; height: number } | null
): PreviewViewport | null {
	if ( ! preset || ! pane || pane.width <= 0 || pane.height <= 0 ) {
		return null;
	}
	return {
		width: preset.width,
		height: preset.height,
		scale: Math.min( 1, pane.width / preset.width, pane.height / preset.height ),
		mobile: Boolean( preset.mobile ),
	};
}

interface PreviewWindow extends Window {
	ipcApi?: {
		setWebviewViewport?: (
			webContentsId: number,
			viewport: PreviewViewport | null
		) => Promise< void >;
	};
}

function getWebviewContentsId( webview: WebviewTag ): number {
	const webContentsId = webview.getWebContentsId?.();
	if ( ! webContentsId ) {
		throw new Error( 'Preview webview is not ready.' );
	}
	return webContentsId;
}

async function applyWebviewViewport(
	webview: WebviewTag,
	viewport: PreviewViewport | null
): Promise< void > {
	const { ipcApi } = window as PreviewWindow;
	await ipcApi?.setWebviewViewport?.( getWebviewContentsId( webview ), viewport );
}

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

// ⇧⌘F (Ctrl+Shift+F elsewhere) toggles full preview. Listed in Settings →
// Keyboard alongside the other preview shortcuts.
const FULL_PREVIEW_SHORTCUT_KEY = 'f';

function isFullPreviewShortcut( event: globalThis.KeyboardEvent ): boolean {
	if ( event.defaultPrevented || event.repeat ) {
		return false;
	}
	return isKeyboardEvent.primaryShift( event, FULL_PREVIEW_SHORTCUT_KEY );
}

function isPreviewShortcutCommand( command: unknown ): command is PreviewShortcutCommandType {
	return (
		command === 'back' ||
		command === 'forward' ||
		command === 'reload' ||
		command === 'full-preview'
	);
}

// Trailing "•••" menu holding the preview's environment controls: the
// responsive viewport controls and full preview. Other view options join it
// as they land.
function PreviewOverflowMenu( {
	viewportMode,
	onViewportModeChange,
	mobileOrientation,
	onMobileOrientationChange,
	fullscreen,
	onFullscreenChange,
}: {
	viewportMode: ViewportMode;
	onViewportModeChange: ( mode: ViewportMode ) => void;
	mobileOrientation: MobileOrientation;
	onMobileOrientationChange: ( orientation: MobileOrientation ) => void;
	fullscreen: boolean;
	onFullscreenChange?: ( value: boolean ) => void;
} ) {
	const viewportLabels: Record< ViewportPreset[ 'id' ], string > = {
		mobile: __( 'Mobile' ),
		tablet: __( 'Tablet' ),
		desktop: __( 'Desktop' ),
	};
	const getPresetLabel = ( preset: ViewportPreset ) =>
		sprintf(
			/* translators: 1: device name (e.g. Mobile), 2: viewport width, 3: viewport height in pixels */
			__( '%1$s · %2$d×%3$d' ),
			viewportLabels[ preset.id ],
			preset.width,
			preset.height
		);
	return (
		// Unlike the app's other (non-modal) menus, this one floats over the
		// webview, which swallows outside clicks before they reach the host
		// document. Modal mode mounts a backdrop that catches them, so
		// clicking the preview dismisses the menu like clicking anywhere else.
		<Menu.Root>
			<Menu.Trigger
				render={
					<IconButton
						variant="minimal"
						tone="neutral"
						size="small"
						icon={ moreVertical }
						label={ __( 'More options' ) }
					/>
				}
			/>
			<Menu.Popup side="bottom" align="end">
				<Menu.Group>
					<Menu.GroupLabel>{ __( 'Responsive mode' ) }</Menu.GroupLabel>
					<Menu.RadioGroup
						value={ viewportMode }
						onValueChange={ ( next ) => onViewportModeChange( next as ViewportMode ) }
					>
						<Menu.RadioItem value="fit">{ __( 'Fit pane' ) }</Menu.RadioItem>
						{ VIEWPORT_PRESETS.map( ( preset ) => (
							<Menu.RadioItem key={ preset.id } value={ preset.id }>
								{ getPresetLabel(
									// Keep the advertised dimensions honest in landscape.
									preset.id === 'mobile' ? getMobilePreset( mobileOrientation ) : preset
								) }
							</Menu.RadioItem>
						) ) }
						<Menu.RadioItem value="split">{ __( 'Desktop + Mobile' ) }</Menu.RadioItem>
					</Menu.RadioGroup>
				</Menu.Group>
				{ viewportMode === 'mobile' || viewportMode === 'split' ? (
					<>
						<Menu.Separator />
						<Menu.Group>
							<Menu.GroupLabel>{ __( 'Mobile orientation' ) }</Menu.GroupLabel>
							<Menu.RadioGroup
								value={ mobileOrientation }
								onValueChange={ ( next ) => onMobileOrientationChange( next as MobileOrientation ) }
							>
								<Menu.RadioItem value="portrait">{ __( 'Portrait' ) }</Menu.RadioItem>
								<Menu.RadioItem value="landscape">{ __( 'Landscape' ) }</Menu.RadioItem>
							</Menu.RadioGroup>
						</Menu.Group>
					</>
				) : null }
				{ onFullscreenChange ? (
					<>
						<Menu.Separator />
						<Menu.Item onClick={ () => onFullscreenChange( ! fullscreen ) }>
							{ fullscreen ? __( 'Exit full preview' ) : __( 'Full preview' ) }
						</Menu.Item>
					</>
				) : null }
			</Menu.Popup>
		</Menu.Root>
	);
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
	fullscreen = false,
	onFullscreenChange,
}: SitePreviewProps ) {
	const connector = useConnector();
	const { chatEnabled } = useAgenticFeatures();
	const startSite = useStartSite();
	const isStarting = useIsSiteStarting( site.id );
	const isBusy = useIsSiteBusy( site );
	const operation = useSiteOperation( site );
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
	// 'fit' renders at the pane's natural size; a preset id simulates that
	// viewport; 'split' shows the desktop and mobile presets together.
	const [ viewportMode, setViewportMode ] = useState< ViewportMode >( 'fit' );
	// Orientation of the phone frame, wherever it shows (mobile preset and
	// the split view's phone pane).
	const [ mobileOrientation, setMobileOrientation ] = useState< MobileOrientation >( 'portrait' );
	const [ paneSize, setPaneSize ] = useState< { width: number; height: number } | null >( null );
	const rootRef = useRef< HTMLElement | null >( null );
	const paneRef = useRef< HTMLDivElement | null >( null );
	const locationRef = useRef< HTMLDivElement | null >( null );
	const commandIdRef = useRef( 0 );
	const canAnnotate = canPreview && inspectorState.ready;
	const progress = browserState.loading
		? Math.max( browserState.progress, 0.12 )
		: browserState.progress;
	const showLoadingProgress = canPreview && progress > 0;
	// Presets are module constants, so this stays referentially stable per
	// mode + orientation.
	const activePreset = getActivePreset( viewportMode, mobileOrientation );
	const splitPreview = viewportMode === 'split';
	// The split view's phone pane: the mobile preset (in its current
	// orientation) scaled to fit the pane height, and capped at half the
	// pane's width so a landscape frame can't crowd out the primary view.
	const splitMobileViewport = useMemo( () => {
		if ( ! splitPreview || ! paneSize ) {
			return null;
		}
		const preset = getMobilePreset( mobileOrientation );
		return getSimulatedViewport( preset, {
			width: Math.max( 160, Math.min( preset.width, Math.round( paneSize.width / 2 ) ) ),
			height: Math.max( 120, paneSize.height - SPLIT_MOBILE_PANE_PADDING * 2 ),
		} );
	}, [ mobileOrientation, paneSize, splitPreview ] );
	// In split mode the desktop simulation fits the space left beside the
	// rendered mobile frame, including its pane padding. This keeps the page
	// at the desktop breakpoint even when the comparison itself is narrow.
	const primaryPaneSize = useMemo( () => {
		if ( ! splitPreview || ! paneSize || ! splitMobileViewport ) {
			return paneSize;
		}
		const mobilePaneWidth =
			splitMobileViewport.width * splitMobileViewport.scale + SPLIT_MOBILE_PANE_PADDING * 2;
		return {
			width: Math.max( 1, paneSize.width - mobilePaneWidth ),
			height: paneSize.height,
		};
	}, [ paneSize, splitMobileViewport, splitPreview ] );
	// No emulation while the site is stopped: the empty state renders in the
	// plain pane, and the chosen mode re-applies on start.
	const previewViewport = useMemo(
		() => ( canPreview ? getSimulatedViewport( activePreset, primaryPaneSize ) : null ),
		[ activePreset, canPreview, primaryPaneSize ]
	);
	// Sizing for the frame around the primary surface: the preset's exact
	// scaled box (the emulation paints it edge to edge).
	const frameStyle = useMemo< CSSProperties | undefined >( () => {
		if ( ! previewViewport ) {
			return undefined;
		}
		return {
			flex: '0 0 auto',
			width: previewViewport.width * previewViewport.scale,
			height: previewViewport.height * previewViewport.scale,
		};
	}, [ previewViewport ] );
	// The iframe fallback has no device emulation, so scaling is a CSS
	// transform instead: lay out at full size, scale down to fit; the frame
	// clips the transform's leftover layout box.
	const iframeStyle: CSSProperties | undefined =
		previewViewport && previewViewport.scale !== 1
			? {
					flex: '0 0 auto',
					width: previewViewport.width,
					height: previewViewport.height,
					transform: `scale(${ previewViewport.scale })`,
					transformOrigin: 'top left',
			  }
			: undefined;

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
	// Shortcuts the guest page swallowed and forwarded back over the console
	// bridge: browser commands go to the webview, full preview to the host.
	const handleForwardedShortcut = useCallback(
		( command: PreviewShortcutCommandType ) => {
			if ( command === 'full-preview' ) {
				onFullscreenChange?.( ! fullscreen );
				return;
			}
			sendBrowserCommand( command );
		},
		[ fullscreen, onFullscreenChange, sendBrowserCommand ]
	);

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
			// Re-selecting the active realm (e.g. via its shortcut) is a no-op —
			// don't bounce the current page through another auto-login hop.
			if ( getPreviewRealm( getSafePath( path ) ) === realm ) {
				return;
			}
			// The agentic UI opens the realm in its in-app preview panel.
			void connector.trackEvent( getRealmOpenEvent( realm ), { browser: 'internal' } );
			const target = lastRealmPathsRef.current[ realm ];
			onPathChange?.( getRealmNavigationPath( target, siteUrl ) );
		},
		[ connector, onPathChange, path, siteUrl ]
	);

	const browserShortcuts = useMemo(
		() => ( {
			back: getNavigationShortcutDescriptor( 'back' ),
			forward: getNavigationShortcutDescriptor( 'forward' ),
			reload: getBrowserShortcutDescriptor( 'r' ),
		} ),
		[]
	);

	// Per-site viewport memory (session-lived, like the parent's per-site
	// path memory): returning to a site restores its last responsive mode.
	const viewportBySiteRef = useRef<
		Record< string, { mode?: ViewportMode; orientation?: MobileOrientation } >
	>( {} );
	const handleViewportModeChange = useCallback(
		( mode: ViewportMode ) => {
			setViewportMode( mode );
			viewportBySiteRef.current[ site.id ] = { ...viewportBySiteRef.current[ site.id ], mode };
			// Two frames side by side need the room — a desktop page beside a
			// phone is unreadable in the narrow panel.
			if ( mode === 'split' ) {
				onFullscreenChange?.( true );
			}
		},
		[ onFullscreenChange, site.id ]
	);
	const handleMobileOrientationChange = useCallback(
		( orientation: MobileOrientation ) => {
			setMobileOrientation( orientation );
			viewportBySiteRef.current[ site.id ] = {
				...viewportBySiteRef.current[ site.id ],
				orientation,
			};
		},
		[ site.id ]
	);

	// The comparison is a full-preview mode: leaving full preview (or landing
	// on a site that remembered it) falls back to the single fit-to-pane view
	// rather than squeezing both frames into the panel. Only when the host
	// offers full preview at all — otherwise the mode could never be picked.
	useEffect( () => {
		if ( onFullscreenChange && ! fullscreen && viewportMode === 'split' ) {
			handleViewportModeChange( 'fit' );
		}
	}, [ fullscreen, handleViewportModeChange, onFullscreenChange, viewportMode ] );

	useEffect( () => {
		setBrowserState( EMPTY_BROWSER_STATE );
		setInspectorState( EMPTY_INSPECTOR_STATE );
		const remembered = viewportBySiteRef.current[ site.id ];
		setViewportMode( remembered?.mode ?? 'fit' );
		setMobileOrientation( remembered?.orientation ?? 'portrait' );
	}, [ site.id ] );

	// The simulated viewport is derived from the pane's size, so it has to
	// follow pane resizes live. Rounded to whole px so subpixel resize
	// reports don't churn re-renders and emulation calls.
	useEffect( () => {
		const pane = paneRef.current;
		if ( ! pane || typeof ResizeObserver === 'undefined' ) {
			return;
		}
		const observer = new ResizeObserver( ( entries ) => {
			const rect = entries[ entries.length - 1 ]?.contentRect;
			if ( ! rect ) {
				return;
			}
			const width = Math.round( rect.width );
			const height = Math.round( rect.height );
			setPaneSize( ( current ) =>
				current?.width === width && current?.height === height ? current : { width, height }
			);
		} );
		observer.observe( pane );
		return () => observer.disconnect();
	}, [] );

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
			// Only claim the full-preview chord when the host actually offers
			// the mode, so it stays available to the page otherwise.
			const fullPreview =
				! command && ! realm && !! onFullscreenChange && isFullPreviewShortcut( event );
			if ( ! command && ! realm && ! fullPreview ) {
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
			} else {
				onFullscreenChange?.( ! fullscreen );
			}
		};

		document.addEventListener( 'keydown', handleKeyDown, { capture: true } );
		return () => document.removeEventListener( 'keydown', handleKeyDown, { capture: true } );
	}, [
		canPreview,
		collapsed,
		fullscreen,
		handleSwitchRealm,
		onFullscreenChange,
		sendBrowserCommand,
	] );

	return (
		<aside
			ref={ rootRef }
			className={ clsx( styles.root, fullscreen && styles.rootFullscreen ) }
			aria-label={ __( 'Site preview' ) }
		>
			<div
				// In full preview the toolbar reaches the window's physical left
				// edge, where the macOS traffic lights sit.
				className={ clsx(
					styles.header,
					fullscreen && trafficLightSpace.start && styles.headerTrafficLights
				) }
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
					(and the omnibox popup anchored to this element) centered. */ }
				<div ref={ locationRef } className={ styles.browserLocation }>
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
								searchEnabled={ canUseWebview }
								anchorRef={ locationRef }
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
					{ canPreview && chatEnabled && connector.capabilities.annotatePreview ? (
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
					<OpenInMenu key={ site.id } site={ site } browserPath={ getSafePath( path ) } />
					{ canPreview ? (
						<PreviewOverflowMenu
							viewportMode={ viewportMode }
							onViewportModeChange={ handleViewportModeChange }
							mobileOrientation={ mobileOrientation }
							onMobileOrientationChange={ handleMobileOrientationChange }
							fullscreen={ fullscreen }
							onFullscreenChange={ onFullscreenChange }
						/>
					) : null }
				</div>
				{ showLoadingProgress ? (
					<div className={ styles.loadingProgress } aria-hidden="true">
						<span style={ { transform: `scaleX(${ Math.min( progress, 1 ) })` } } />
					</div>
				) : null }
			</div>
			<div className={ styles.body }>
				<div
					ref={ paneRef }
					className={ clsx(
						styles.previewViewport,
						previewViewport && styles.previewViewportSimulated
					) }
				>
					{ canPreview ? (
						<>
							{ previewViewport ? (
								<div className={ styles.viewportGrid } aria-hidden="true">
									<DotGrid
										spacing={ 32 }
										crossSize={ 5 }
										crossThickness={ 0.75 }
										opacity={ 0.16 }
										intro={ false }
									/>
								</div>
							) : null }
							<div
								className={ clsx( styles.surfaceFrame, previewViewport && styles.deviceFrame ) }
								style={ frameStyle }
							>
								{ canUseWebview ? (
									<WebviewSurface
										key={ site.id }
										url={ previewUrl }
										reloadNonce={ reloadNonce }
										onAnnotationsDone={ onAnnotationsDone }
										onInspectorState={ handleInspectorState }
										inspectorCommand={ inspectorCommand }
										browserCommand={ browserCommand }
										onBrowserStateChange={ handleBrowserStateChange }
										onBrowserCommand={ handleForwardedShortcut }
										onNavigate={ handlePreviewNavigation }
										viewport={ previewViewport }
									/>
								) : (
									// Non-Electron fallback: plain iframe, no inspector. Reloads
									// by remounting; back/forward aren't reachable from the host.
									<iframe
										key={ `${ previewUrl }#${ reloadNonce }#${
											browserCommand?.type === 'reload' ? browserCommand.id : 0
										}` }
										className={ styles.iframe }
										style={ iframeStyle }
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
								) }
							</div>
							{ splitPreview && splitMobileViewport ? (
								// The comparison's phone pane: a lean companion surface that
								// follows the primary's navigation (shared `path`) but keeps
								// annotations and history on the primary pane.
								<div className={ styles.splitMobilePane }>
									<div
										className={ clsx( styles.surfaceFrame, styles.deviceFrame ) }
										style={ {
											flex: '0 0 auto',
											width: splitMobileViewport.width * splitMobileViewport.scale,
											height: splitMobileViewport.height * splitMobileViewport.scale,
										} }
									>
										{ canUseWebview ? (
											<WebviewSurface
												key={ `${ site.id }-mobile` }
												url={ previewUrl }
												reloadNonce={ reloadNonce }
												viewport={ splitMobileViewport }
												browserCommand={ browserCommand?.type === 'reload' ? browserCommand : null }
												onNavigate={ handlePreviewNavigation }
											/>
										) : (
											<iframe
												key={ `${ previewUrl }#${ reloadNonce }` }
												className={ styles.iframe }
												style={
													splitMobileViewport.scale !== 1
														? {
																flex: '0 0 auto',
																width: splitMobileViewport.width,
																height: splitMobileViewport.height,
																transform: `scale(${ splitMobileViewport.scale })`,
																transformOrigin: 'top left',
														  }
														: undefined
												}
												src={ previewUrl }
												title={ sprintf(
													/* translators: %s: site name */
													__( '%s (mobile)' ),
													site.name
												) }
											/>
										) }
									</div>
								</div>
							) : null }
						</>
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
									{ operation
										? sprintf(
												/* translators: %s: an operation in progress, e.g. "Exporting". */
												__( '%s… the site can start once this finishes.' ),
												getSiteOperationLabel( operation )
										  )
										: __( 'Start the site to see a live preview.' ) }
								</p>
								<Button
									variant="solid"
									tone="brand"
									loading={ isStarting }
									loadingAnnouncement={ __( 'Starting site' ) }
									disabled={ isBusy }
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
	onBrowserCommand?: ( type: PreviewShortcutCommandType ) => void;
	onNavigate?: ( url: string ) => void;
	// Simulated guest viewport, or null for the webview's natural size.
	viewport?: PreviewViewport | null;
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
	viewport = null,
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
				if ( isPreviewShortcutCommand( parsed.command ) ) {
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

	// The CDP metrics override persists across navigations, so it only needs
	// applying when the simulated viewport changes (or on the first dom-ready
	// after one was requested). The `applied` ref skips the initial clear so
	// plain previews don't pay for an emulation round-trip. The value is
	// debounced because pane resizes stream continuous viewport changes and
	// each application is an IPC + CDP round-trip; the CSS frame tracks the
	// drag live and the emulation settles right behind it.
	const debouncedViewport = useDebouncedValue( viewport, 150 );
	const appliedViewportRef = useRef( false );
	useEffect( () => {
		if ( ! ready ) return;
		if ( ! debouncedViewport && ! appliedViewportRef.current ) return;
		const webview = ref.current as WebviewTag | null;
		if ( ! webview ) return;
		appliedViewportRef.current = Boolean( debouncedViewport );
		void applyWebviewViewport( webview, debouncedViewport ).catch( () => undefined );
	}, [ debouncedViewport, ready ] );

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
