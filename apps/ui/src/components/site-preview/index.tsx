import { getSiteOperationLabel } from '@studio/common/lib/site-operation-labels';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { __, sprintf } from '@wordpress/i18n';
import {
	check,
	chevronDown,
	closeSmall,
	Icon,
	moreVertical,
	pencil,
	plus,
	wordpress,
} from '@wordpress/icons';
import { ariaKeyShortcut, displayShortcut, isAppleOS, isKeyboardEvent } from '@wordpress/keycodes';
import { Button, Dialog, IconButton, Tooltip } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DotGrid } from '@/components/dot-grid';
import * as Menu from '@/components/menu';
import { SiteIcon } from '@/components/site-icon';
import splitStyles from '@/components/split-button/style.module.css';
import { useConnector } from '@/data/core';
import { useAgenticFeatures } from '@/data/queries/use-agentic-features';
import {
	useIsSiteBusy,
	useIsSiteStarting,
	useSiteOperation,
	useStartSite,
} from '@/data/queries/use-sites';
import { refreshThemeDetails } from '@/hooks/use-theme-details';
import { useTrafficLightSpace } from '@/hooks/use-traffic-light-space';
import { getSiteUrl } from '@/lib/get-site-url';
import {
	browserBackIcon,
	browserForwardIcon,
	databaseIcon,
	playIcon,
	refreshIcon,
} from '@/lib/icons';
import {
	DATABASE_HOME_PATH,
	getPathFromPreviewUrl,
	getPreviewRealm,
	getRealmNavigationPath,
	PreviewAddressBar,
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

interface PreviewTab {
	id: number;
	path: string;
	title: string;
	reloadNonce: number;
	historyEntries: BrowserHistoryEntry[];
	activeHistoryIndex: number;
}

interface SingleSitePreviewProps extends SitePreviewProps {
	onTitleChange?: ( title: string | null ) => void;
	onTabCycle?: ( direction: -1 | 1 ) => void;
	onHistoryChange?: ( entries: BrowserHistoryEntry[], activeIndex: number ) => void;
	initialHistoryEntries?: BrowserHistoryEntry[];
	initialHistoryIndex?: number;
	hasTabBar?: boolean;
}

interface InspectorEvent {
	type: 'annotations-updated' | 'browser-command' | 'cancel-requested' | 'done' | 'state';
	annotations?: Annotation[];
	isPicking?: boolean;
	annotationCount?: number;
	hasUnsavedDraft?: boolean;
	command?: PreviewShortcutCommandType;
}

interface InspectorState {
	ready: boolean;
	isPicking: boolean;
	annotationCount: number;
	hasUnsavedDraft: boolean;
}

interface InspectorCommand {
	id: number;
	type: 'cancel' | 'toggle-picking' | 'submit';
}

interface BrowserHistoryEntry {
	index: number;
	title: string;
	url: string;
}

interface PreviewTabSession {
	tabs: PreviewTab[];
	activeTabId: number;
}

interface BrowserNavigationState {
	canGoBack: boolean;
	canGoForward: boolean;
	loading: boolean;
	progress: number;
	title: string | null;
	historyEntries: BrowserHistoryEntry[];
	activeHistoryIndex: number;
}

type BrowserShortcutCommandType = 'back' | 'forward' | 'reload';

// What the guest page can forward over the console bridge: the browser
// commands it swallows, plus the full-preview toggle (the webview covers most
// of the window in full preview, so the host listener alone would miss it).
type PreviewShortcutCommandType =
	| BrowserShortcutCommandType
	| 'full-preview'
	| 'previous-tab'
	| 'next-tab';

interface BrowserCommand {
	id: number;
	type: BrowserShortcutCommandType | 'go-to-history';
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

// Breathing room around a floating device frame, mirroring the CSS padding on
// `.realmLayerSimulated` and `.splitMobilePane`. Subtracted from the measured
// pane before computing a frame's fit-to-pane scale.
const PREVIEW_PANE_PADDING = 16;

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
		clearWebviewCache?: ( webContentsId: number ) => Promise< void >;
		getWebviewNavigationHistory?: ( webContentsId: number ) => Promise< {
			activeIndex: number;
			entries: BrowserHistoryEntry[];
		} >;
		restoreWebviewNavigationHistory?: (
			webContentsId: number,
			entries: BrowserHistoryEntry[],
			activeIndex: number
		) => Promise< void >;
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

export function isThemeActivationUrl( url: string ): boolean {
	try {
		const parsed = new URL( url );
		return (
			parsed.pathname.endsWith( '/wp-admin/themes.php' ) &&
			parsed.searchParams.get( 'activated' ) === 'true'
		);
	} catch {
		return false;
	}
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
	historyEntries: [],
	activeHistoryIndex: -1,
};

const EMPTY_INSPECTOR_STATE: InspectorState = {
	ready: false,
	isPicking: false,
	annotationCount: 0,
	hasUnsavedDraft: false,
};

const SITE_THUMBNAIL_QUERY_KEY = [ 'site-preview-thumbnail' ] as const;

// Where each realm segment lands before its per-realm memory has anything
// better: site root, WP Admin dashboard, and phpMyAdmin's WordPress database.
/**
 * Realms that share a browsing session share a surface.
 *
 * The front end and WP Admin link to each other and share a login, so they stay
 * one webview: one history stack, and a page loaded after signing in reflects
 * it. phpMyAdmin is a separate tool nothing links to, and the only realm that
 * isn't responsive — so it gets its own surface, which never resizes or reloads
 * when the preview flips to it.
 */
type PreviewSurfaceKey = 'site' | 'database';

function getSurfaceKey( realm: PreviewRealm ): PreviewSurfaceKey {
	return realm === 'database' ? 'database' : 'site';
}

// Whether a surface previews responsive pages. phpMyAdmin has no mobile layout,
// so its surface always renders at the pane's natural size and the viewport
// controls don't apply to it.
function isResponsiveSurface( key: PreviewSurfaceKey ): boolean {
	return key === 'site';
}

// A mounted preview surface: its url, plus the load state and pending commands
// belonging to that webview. Kept alive once created so returning to it is a
// visibility swap rather than a resize plus a fresh load.
interface PreviewSurfaceState {
	path: string;
	browser: BrowserNavigationState;
	inspector: InspectorState;
	browserCommand: BrowserCommand | null;
	inspectorCommand: InspectorCommand | null;
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
		inspector: EMPTY_INSPECTOR_STATE,
		browserCommand: null,
		inspectorCommand: null,
		reloadNonce,
	};
}

// Sizing for the frame around a surface: the preset's exact scaled box (the
// emulation paints it edge to edge), or nothing when the surface fills its layer.
function getFrameStyle( viewport: PreviewViewport | null ): CSSProperties | undefined {
	if ( ! viewport ) {
		return undefined;
	}
	return {
		flex: '0 0 auto',
		width: viewport.width * viewport.scale,
		height: viewport.height * viewport.scale,
	};
}

// The iframe fallback has no device emulation, so scaling is a CSS transform
// instead: lay out at full size, scale down to fit; the frame clips the
// transform's leftover layout box.
function getIframeStyle( viewport: PreviewViewport | null ): CSSProperties | undefined {
	if ( ! viewport || viewport.scale === 1 ) {
		return undefined;
	}
	return {
		flex: '0 0 auto',
		width: viewport.width,
		height: viewport.height,
		transform: `scale(${ viewport.scale })`,
		transformOrigin: 'top left',
	};
}

function areInspectorStatesEqual( a: InspectorState, b: InspectorState ) {
	return (
		a.ready === b.ready &&
		a.isPicking === b.isPicking &&
		a.annotationCount === b.annotationCount &&
		a.hasUnsavedDraft === b.hasUnsavedDraft
	);
}

function arePreviewSurfacesEqual( a: PreviewSurfaceState, b: PreviewSurfaceState ) {
	return (
		a.path === b.path &&
		a.reloadNonce === b.reloadNonce &&
		a.browserCommand === b.browserCommand &&
		a.inspectorCommand === b.inspectorCommand &&
		areBrowserStatesEqual( a.browser, b.browser ) &&
		areInspectorStatesEqual( a.inspector, b.inspector )
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

export function getTabCycleDirection( event: globalThis.KeyboardEvent ): -1 | 1 | null {
	if ( event.defaultPrevented || event.repeat ) {
		return null;
	}
	if ( isKeyboardEvent.primaryShift( event, '[' ) ) {
		return -1;
	}
	if ( isKeyboardEvent.primaryShift( event, ']' ) ) {
		return 1;
	}
	if ( event.key === 'Tab' && event.ctrlKey && ! event.altKey && ! event.metaKey ) {
		return event.shiftKey ? -1 : 1;
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
		command === 'full-preview' ||
		command === 'previous-tab' ||
		command === 'next-tab'
	);
}

function PreviewResponsiveControls( {
	viewportMode,
	onViewportModeChange,
	viewportControlsDisabled,
	mobileOrientation,
	onMobileOrientationChange,
}: {
	viewportMode: ViewportMode;
	onViewportModeChange: ( mode: ViewportMode ) => void;
	// Greys out the viewport controls for a surface that can't simulate one,
	// keeping the chosen mode for when the preview returns to one that can.
	viewportControlsDisabled: boolean;
	mobileOrientation: MobileOrientation;
	onMobileOrientationChange: ( orientation: MobileOrientation ) => void;
} ) {
	const viewportLabels: Record< ViewportMode, string > = {
		fit: __( 'Responsive' ),
		mobile: __( 'Mobile' ),
		tablet: __( 'Tablet' ),
		desktop: __( 'Desktop' ),
		split: __( 'Desktop + Mobile' ),
	};
	const selectedLabel = viewportLabels[ viewportMode ];
	const getPresetLabel = ( preset: ViewportPreset ) =>
		sprintf(
			/* translators: 1: device name (e.g. Mobile), 2: viewport width, 3: viewport height in pixels */
			__( '%1$s · %2$d×%3$d' ),
			viewportLabels[ preset.id ],
			preset.width,
			preset.height
		);
	const renderSelectedIndicator = ( mode: ViewportMode ) => (
		<span className={ styles.responsiveModeIndicator } aria-hidden="true">
			{ viewportMode === mode ? <Icon icon={ check } size={ 18 } data-keep-size /> : null }
		</span>
	);
	return (
		<Menu.Root>
			<Tooltip.Root>
				<Menu.Trigger
					render={
						<Tooltip.Trigger
							render={
								<Button
									variant="minimal"
									tone="neutral"
									size="small"
									className={ styles.responsiveModeTrigger }
									aria-label={ sprintf( __( 'Responsive mode: %s' ), selectedLabel ) }
								/>
							}
						>
							<span className={ styles.responsiveModeLabel }>{ selectedLabel }</span>
							<Icon
								icon={ chevronDown }
								size={ 12 }
								className={ styles.responsiveModeChevron }
								data-keep-size
							/>
						</Tooltip.Trigger>
					}
				/>
				<Tooltip.Popup positioner={ <Tooltip.Positioner side="bottom" /> }>
					{ __( 'Preview size' ) }
				</Tooltip.Popup>
			</Tooltip.Root>
			<Menu.Popup side="bottom" align="end">
				<Menu.Group>
					<Menu.GroupLabel>{ __( 'Responsive mode' ) }</Menu.GroupLabel>
					<Menu.Group>
						<Menu.Item
							className={ styles.responsiveModeItem }
							aria-current={ viewportMode === 'fit' ? 'true' : undefined }
							disabled={ viewportControlsDisabled }
							onClick={ () => onViewportModeChange( 'fit' ) }
						>
							{ renderSelectedIndicator( 'fit' ) }
							{ __( 'Responsive' ) }
						</Menu.Item>
						{ VIEWPORT_PRESETS.map( ( preset ) => (
							<Menu.Item
								key={ preset.id }
								className={ styles.responsiveModeItem }
								aria-current={ viewportMode === preset.id ? 'true' : undefined }
								disabled={ viewportControlsDisabled }
								onClick={ () => onViewportModeChange( preset.id ) }
							>
								{ renderSelectedIndicator( preset.id ) }
								{ getPresetLabel(
									// Keep the advertised dimensions honest in landscape.
									preset.id === 'mobile' ? getMobilePreset( mobileOrientation ) : preset
								) }
							</Menu.Item>
						) ) }
						<Menu.Item
							className={ styles.responsiveModeItem }
							aria-current={ viewportMode === 'split' ? 'true' : undefined }
							disabled={ viewportControlsDisabled }
							onClick={ () => onViewportModeChange( 'split' ) }
						>
							{ renderSelectedIndicator( 'split' ) }
							{ __( 'Desktop + Mobile' ) }
						</Menu.Item>
					</Menu.Group>
				</Menu.Group>
				{ viewportMode === 'mobile' || viewportMode === 'split' ? (
					<>
						<Menu.Separator />
						<Menu.Group>
							<Menu.GroupLabel>{ __( 'Mobile orientation' ) }</Menu.GroupLabel>
							<Menu.RadioGroup
								value={ mobileOrientation }
								onValueChange={ ( next ) => onMobileOrientationChange( next as MobileOrientation ) }
								disabled={ viewportControlsDisabled }
							>
								<Menu.RadioItem value="portrait">{ __( 'Portrait' ) }</Menu.RadioItem>
								<Menu.RadioItem value="landscape">{ __( 'Landscape' ) }</Menu.RadioItem>
							</Menu.RadioGroup>
						</Menu.Group>
					</>
				) : null }
			</Menu.Popup>
		</Menu.Root>
	);
}

// Annotation commands. With nothing pending there's only one command, so the
// toolbar shows a bare toggle at every width. Once notes are waiting there are
// two, and a narrow toolbar can't fit them inline — `style.module.css` swaps
// the inline pair for a split button, so only one layout is ever in the a11y
// tree.
function PreviewAnnotationControls( {
	isPicking,
	annotationCount,
	hasUnsavedDraft,
	cancelRequestId,
	disabled,
	onCommand,
}: {
	isPicking: boolean;
	annotationCount: number;
	hasUnsavedDraft: boolean;
	cancelRequestId: number;
	disabled: boolean;
	onCommand: ( type: InspectorCommand[ 'type' ] ) => void;
} ) {
	const [ cancelDialogOpen, setCancelDialogOpen ] = useState( false );
	const toggleLabel = isPicking ? __( 'Cancel annotation' ) : __( 'Annotate' );
	const submitLabel = __( 'Send annotations to chat' );
	const hasPending = annotationCount > 0;
	const handledCancelRequestId = useRef( cancelRequestId );
	const requestCancel = useCallback( () => {
		if ( hasPending || hasUnsavedDraft ) {
			setCancelDialogOpen( true );
		} else {
			onCommand( 'cancel' );
		}
	}, [ hasPending, hasUnsavedDraft, onCommand ] );
	useEffect( () => {
		if ( handledCancelRequestId.current === cancelRequestId ) return;
		handledCancelRequestId.current = cancelRequestId;
		if ( isPicking ) requestCancel();
	}, [ cancelRequestId, isPicking, requestCancel ] );
	const handleToggle = () => ( isPicking ? requestCancel() : onCommand( 'toggle-picking' ) );
	const handleCancel = () => {
		setCancelDialogOpen( false );
		onCommand( 'cancel' );
	};
	return (
		<>
			<div
				className={ clsx( styles.annotationControls, hasPending && styles.annotationControlsWide ) }
			>
				<Tooltip.Root>
					<Tooltip.Trigger
						render={
							<Button
								variant="outline"
								tone="neutral"
								size="small"
								className={ styles.annotationToggle }
								aria-label={ toggleLabel }
								disabled={ disabled }
								onClick={ handleToggle }
							>
								{ ! isPicking ? <Icon icon={ pencil } size={ 18 } /> : null }
								<span className={ styles.toolbarLabel }>
									{ isPicking ? __( 'Cancel' ) : __( 'Annotate' ) }
								</span>
							</Button>
						}
					/>
					<Tooltip.Popup positioner={ <Tooltip.Positioner side="bottom" /> }>
						{ isPicking ? __( 'Cancel annotation' ) : __( 'Add notes' ) }
					</Tooltip.Popup>
				</Tooltip.Root>
				{ hasPending ? (
					<Button
						variant="solid"
						tone="brand"
						size="small"
						disabled={ disabled }
						aria-label={ submitLabel }
						onClick={ () => onCommand( 'submit' ) }
					>
						{ __( 'Send to chat' ) }
					</Button>
				) : null }
			</div>
			{ hasPending ? (
				<div className={ styles.annotationMenu }>
					{ /* Two commands to offer, so it becomes a split button matching the
						"Open in…" control beside it: the main action controls annotation,
						and the chevron opens the pair. Modal for the same reason as the
						overflow menu — the webview swallows outside clicks, so the
						backdrop is what dismisses it. */ }
					<Menu.Root>
						<div className={ splitStyles.splitTrigger }>
							<Tooltip.Root>
								<Tooltip.Trigger
									render={
										<Button
											variant="minimal"
											tone="neutral"
											size="small"
											className={ clsx( splitStyles.splitAction, styles.annotationToggle ) }
											aria-label={ toggleLabel }
											disabled={ disabled }
											onClick={ handleToggle }
										>
											{ isPicking ? __( 'Cancel' ) : <Icon icon={ pencil } size={ 18 } /> }
										</Button>
									}
								/>
								<Tooltip.Popup positioner={ <Tooltip.Positioner side="bottom" /> }>
									{ toggleLabel }
								</Tooltip.Popup>
							</Tooltip.Root>
							<Tooltip.Root>
								<Menu.Trigger
									render={
										<Tooltip.Trigger
											render={
												<Button
													variant="minimal"
													tone="neutral"
													size="small"
													className={ splitStyles.splitMenuButton }
													aria-label={ __( 'Annotation options' ) }
													disabled={ disabled }
												/>
											}
										>
											<Icon
												icon={ chevronDown }
												size={ 12 }
												className={ splitStyles.chevron }
												data-keep-size
											/>
										</Tooltip.Trigger>
									}
								/>
								<Tooltip.Popup positioner={ <Tooltip.Positioner side="bottom" /> }>
									{ __( 'Annotation options' ) }
								</Tooltip.Popup>
							</Tooltip.Root>
						</div>
						<Menu.Popup side="bottom" align="end">
							<Menu.Item onClick={ handleToggle }>{ toggleLabel }</Menu.Item>
							<Menu.Item onClick={ () => onCommand( 'submit' ) }>{ submitLabel }</Menu.Item>
						</Menu.Popup>
					</Menu.Root>
				</div>
			) : null }
			<Dialog.Root open={ cancelDialogOpen } onOpenChange={ setCancelDialogOpen }>
				<Dialog.Popup size="small">
					<Dialog.Header>
						<Dialog.Title>{ __( 'Cancel annotation?' ) }</Dialog.Title>
					</Dialog.Header>
					<Dialog.Content>
						<Dialog.Description>
							{ __( 'Your annotations and any unfinished note will be discarded.' ) }
						</Dialog.Description>
					</Dialog.Content>
					<Dialog.Footer>
						<Dialog.Action variant="minimal" tone="neutral">
							{ __( 'Keep annotating' ) }
						</Dialog.Action>
						<Button variant="solid" tone="brand" onClick={ handleCancel }>
							{ __( 'Discard annotations' ) }
						</Button>
					</Dialog.Footer>
				</Dialog.Popup>
			</Dialog.Root>
		</>
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
	onStep,
	onJump,
}: {
	direction: 'back' | 'forward';
	browserState: BrowserNavigationState;
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
	const disabled = back ? ! browserState.canGoBack : ! browserState.canGoForward;
	const [ menuOpen, setMenuOpen ] = useState( false );
	const trigger = (
		<IconButton
			variant="minimal"
			tone="neutral"
			size="small"
			icon={ back ? browserBackIcon : browserForwardIcon }
			label={ label }
			shortcut={ shortcut }
			disabled={ disabled }
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

function areBrowserStatesEqual( a: BrowserNavigationState, b: BrowserNavigationState ) {
	return (
		a.canGoBack === b.canGoBack &&
		a.canGoForward === b.canGoForward &&
		a.loading === b.loading &&
		a.progress === b.progress &&
		a.title === b.title &&
		a.activeHistoryIndex === b.activeHistoryIndex &&
		a.historyEntries.length === b.historyEntries.length &&
		a.historyEntries.every( ( entry, index ) => {
			const other = b.historyEntries[ index ];
			return other?.index === entry.index && other.title === entry.title && other.url === entry.url;
		} )
	);
}

export function getPreviewTabTitle(
	path: string,
	documentTitle: string | null,
	siteName: string
): string {
	const realm = getPreviewRealm( path );
	if ( realm === 'database' ) {
		const query = path.split( '?' )[ 1 ] ?? '';
		const params = new URLSearchParams( query );
		const database = params.get( 'db' );
		const table = params.get( 'table' );
		if ( table && database ) {
			return sprintf(
				/* translators: 1: database table name, 2: database name */
				__( '%1$s · %2$s' ),
				table,
				database
			);
		}
		if ( table ) {
			return sprintf(
				/* translators: %s: database table name */
				__( '%s · Database' ),
				table
			);
		}
		if ( database ) {
			return sprintf(
				/* translators: %s: database name */
				__( '%s · Database' ),
				database
			);
		}
		return __( 'Database' );
	}
	return documentTitle || ( realm === 'admin' ? __( 'WordPress' ) : siteName );
}

const PREVIEW_TAB_SESSION_VERSION = 1;

function getPreviewTabSessionStorageKey( siteId: string ): string {
	return `studio:site-preview:tabs:${ siteId }`;
}

function createPreviewTab(
	id: number,
	path: string,
	title: string,
	reloadNonce: number,
	historyEntries: BrowserHistoryEntry[] = [],
	activeHistoryIndex = -1
): PreviewTab {
	return { id, path, title, reloadNonce, historyEntries, activeHistoryIndex };
}

function normalizeStoredHistory( entries: unknown, siteUrl: string ): BrowserHistoryEntry[] {
	if ( ! Array.isArray( entries ) ) return [];
	return entries.flatMap( ( entry, index ) => {
		if ( ! entry || typeof entry !== 'object' ) return [];
		const candidate = entry as { title?: unknown; url?: unknown };
		if ( typeof candidate.url !== 'string' ) return [];
		try {
			const oldUrl = new URL( candidate.url );
			const url = new URL(
				`${ oldUrl.pathname }${ oldUrl.search }${ oldUrl.hash }`,
				siteUrl
			).toString();
			return [
				{
					index,
					title: typeof candidate.title === 'string' ? candidate.title : '',
					url,
				},
			];
		} catch {
			return [];
		}
	} );
}

function loadPreviewTabSession(
	site: SiteDetails,
	path: string,
	reloadNonce: number
): PreviewTabSession {
	const fallbackPath = getSafePath( path );
	const fallback = {
		tabs: [
			createPreviewTab(
				1,
				fallbackPath,
				getPreviewTabTitle( fallbackPath, null, site.name ),
				reloadNonce
			),
		],
		activeTabId: 1,
	};
	try {
		const raw = window.localStorage.getItem( getPreviewTabSessionStorageKey( site.id ) );
		if ( ! raw ) return fallback;
		const stored = JSON.parse( raw ) as {
			version?: unknown;
			activeTabId?: unknown;
			tabs?: unknown;
		};
		if ( stored.version !== PREVIEW_TAB_SESSION_VERSION || ! Array.isArray( stored.tabs ) ) {
			return fallback;
		}
		const siteUrl = getSiteUrl( site );
		const seenIds = new Set< number >();
		const tabs = stored.tabs.slice( 0, 50 ).flatMap( ( value ) => {
			if ( ! value || typeof value !== 'object' ) return [];
			const tab = value as {
				id?: unknown;
				path?: unknown;
				title?: unknown;
				historyEntries?: unknown;
				activeHistoryIndex?: unknown;
			};
			if (
				typeof tab.id !== 'number' ||
				! Number.isInteger( tab.id ) ||
				tab.id < 1 ||
				seenIds.has( tab.id ) ||
				typeof tab.path !== 'string'
			) {
				return [];
			}
			seenIds.add( tab.id );
			const nextPath = getSafePath( tab.path );
			const historyEntries = normalizeStoredHistory( tab.historyEntries, siteUrl );
			const requestedIndex =
				typeof tab.activeHistoryIndex === 'number'
					? tab.activeHistoryIndex
					: historyEntries.length - 1;
			const activeHistoryIndex =
				historyEntries.length > 0
					? Math.max( 0, Math.min( requestedIndex, historyEntries.length - 1 ) )
					: -1;
			return [
				createPreviewTab(
					tab.id,
					nextPath,
					typeof tab.title === 'string' && tab.title
						? tab.title
						: getPreviewTabTitle( nextPath, null, site.name ),
					reloadNonce,
					historyEntries,
					activeHistoryIndex
				),
			];
		} );
		if ( tabs.length === 0 ) return fallback;
		const activeTabId =
			typeof stored.activeTabId === 'number' && seenIds.has( stored.activeTabId )
				? stored.activeTabId
				: tabs[ 0 ].id;
		return { tabs, activeTabId };
	} catch {
		return fallback;
	}
}

function storePreviewTabSession( siteId: string, tabs: PreviewTab[], activeTabId: number ): void {
	try {
		window.localStorage.setItem(
			getPreviewTabSessionStorageKey( siteId ),
			JSON.stringify( {
				version: PREVIEW_TAB_SESSION_VERSION,
				activeTabId,
				tabs: tabs.map( ( tab ) => ( {
					id: tab.id,
					path: tab.path,
					title: tab.title,
					historyEntries: tab.historyEntries,
					activeHistoryIndex: tab.activeHistoryIndex,
				} ) ),
			} )
		);
	} catch {
		// The preview remains usable when storage is unavailable or full.
	}
}

export function SitePreview( props: SitePreviewProps ) {
	const { site, path, reloadNonce, onPathChange, collapsed = false, fullscreen = false } = props;
	const [ initialSession ] = useState( () => loadPreviewTabSession( site, path, reloadNonce ) );
	const nextTabId = useRef( Math.max( ...initialSession.tabs.map( ( tab ) => tab.id ) ) + 1 );
	const rootRef = useRef< HTMLDivElement | null >( null );
	const trafficLightSpace = useTrafficLightSpace();
	const [ tabs, setTabs ] = useState< PreviewTab[] >( initialSession.tabs );
	const [ activeTabId, setActiveTabId ] = useState( initialSession.activeTabId );
	const [ draggedTabId, setDraggedTabId ] = useState< number | null >( null );
	const draggedTabIdRef = useRef< number | null >( null );
	const dragOverTabIdRef = useRef< number | null >( null );
	const activeTabIdRef = useRef( activeTabId );
	const siteIdRef = useRef( site.id );
	const skipStorageRef = useRef( false );
	const skipNextExternalPathRef = useRef( true );
	const restoredPathRef = useRef(
		initialSession.tabs.find( ( tab ) => tab.id === initialSession.activeTabId )?.path ??
			initialSession.tabs[ 0 ].path
	);
	const activeTab = tabs.find( ( tab ) => tab.id === activeTabId ) ?? tabs[ 0 ];
	useEffect( () => {
		activeTabIdRef.current = activeTabId;
	}, [ activeTabId ] );

	useEffect( () => {
		if ( siteIdRef.current === site.id ) {
			return;
		}
		siteIdRef.current = site.id;
		const session = loadPreviewTabSession( site, path, reloadNonce );
		skipStorageRef.current = true;
		skipNextExternalPathRef.current = true;
		restoredPathRef.current =
			session.tabs.find( ( tab ) => tab.id === session.activeTabId )?.path ??
			session.tabs[ 0 ].path;
		setTabs( session.tabs );
		setActiveTabId( session.activeTabId );
		nextTabId.current = Math.max( ...session.tabs.map( ( tab ) => tab.id ) ) + 1;
	}, [ path, reloadNonce, site ] );

	useEffect( () => {
		if ( skipNextExternalPathRef.current ) {
			skipNextExternalPathRef.current = false;
			if ( restoredPathRef.current !== getSafePath( path ) ) {
				onPathChange?.( restoredPathRef.current );
			}
			return;
		}
		setTabs( ( current ) => {
			const index = current.findIndex( ( tab ) => tab.id === activeTabIdRef.current );
			const currentTab = current[ index ];
			const nextPath = getSafePath( path );
			if ( ! currentTab || currentTab.path === nextPath ) return current;
			const next = [ ...current ];
			next[ index ] = {
				...currentTab,
				path: nextPath,
				title: getPreviewTabTitle( nextPath, null, site.name ),
			};
			return next;
		} );
	}, [ onPathChange, path, site.name ] );

	useEffect( () => {
		if ( skipStorageRef.current ) {
			skipStorageRef.current = false;
			return;
		}
		storePreviewTabSession( site.id, tabs, activeTabId );
	}, [ activeTabId, site.id, tabs ] );

	useEffect( () => {
		setTabs( ( current ) =>
			current.map( ( tab ) =>
				tab.id === activeTabIdRef.current && tab.reloadNonce !== reloadNonce
					? { ...tab, reloadNonce }
					: tab
			)
		);
	}, [ reloadNonce ] );

	const selectTab = ( tab: PreviewTab ) => {
		setActiveTabId( tab.id );
		onPathChange?.( tab.path );
	};

	const addTab = ( nextPath: string ) => {
		const tab = createPreviewTab(
			nextTabId.current++,
			nextPath,
			getPreviewTabTitle( nextPath, null, site.name ),
			reloadNonce
		);
		setTabs( ( current ) => [ ...current, tab ] );
		setActiveTabId( tab.id );
		onPathChange?.( tab.path );
	};

	const closeTab = ( tabId: number ) => {
		const closingIndex = tabs.findIndex( ( tab ) => tab.id === tabId );
		const remaining = tabs.filter( ( tab ) => tab.id !== tabId );
		if ( remaining.length === 0 ) {
			const replacement = createPreviewTab(
				nextTabId.current++,
				'/',
				getPreviewTabTitle( '/', null, site.name ),
				reloadNonce
			);
			setTabs( [ replacement ] );
			setActiveTabId( replacement.id );
			onPathChange?.( replacement.path );
			return;
		}
		setTabs( remaining );
		if ( tabId === activeTabId ) {
			const replacement = remaining[ Math.min( closingIndex, remaining.length - 1 ) ];
			setActiveTabId( replacement.id );
			onPathChange?.( replacement.path );
		}
	};

	const cycleTab = useCallback(
		( direction: -1 | 1 ) => {
			if ( tabs.length < 2 ) return;
			const activeIndex = tabs.findIndex( ( tab ) => tab.id === activeTabIdRef.current );
			const nextIndex = ( activeIndex + direction + tabs.length ) % tabs.length;
			const nextTab = tabs[ nextIndex ];
			setActiveTabId( nextTab.id );
			onPathChange?.( nextTab.path );
		},
		[ onPathChange, tabs ]
	);

	useEffect( () => {
		if ( collapsed || tabs.length < 2 ) return;
		const handleKeyDown = ( event: globalThis.KeyboardEvent ) => {
			const direction = getTabCycleDirection( event );
			if ( ! direction ) return;
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
			cycleTab( direction );
		};
		document.addEventListener( 'keydown', handleKeyDown, true );
		return () => document.removeEventListener( 'keydown', handleKeyDown, true );
	}, [ collapsed, cycleTab, tabs.length ] );

	const reorderTab = ( sourceId: number, targetId: number ) => {
		if ( sourceId === targetId ) return;
		setTabs( ( current ) => {
			const sourceIndex = current.findIndex( ( tab ) => tab.id === sourceId );
			const targetIndex = current.findIndex( ( tab ) => tab.id === targetId );
			if ( sourceIndex < 0 || targetIndex < 0 ) return current;
			const reordered = [ ...current ];
			const [ source ] = reordered.splice( sourceIndex, 1 );
			reordered.splice( targetIndex, 0, source );
			return reordered;
		} );
	};
	const finishTabDrag = () => {
		draggedTabIdRef.current = null;
		dragOverTabIdRef.current = null;
		setDraggedTabId( null );
	};

	return (
		<div
			ref={ rootRef }
			className={ clsx( styles.tabbedRoot, fullscreen && styles.tabbedRootFullscreen ) }
			aria-label={ __( 'Site preview browser' ) }
		>
			<div
				className={ clsx(
					styles.tabBar,
					fullscreen && trafficLightSpace.start && styles.tabBarTrafficLights
				) }
				style={ trafficLightSpace.end ? { paddingInlineEnd: 96 } : undefined }
			>
				<div className={ styles.tabList } role="tablist" aria-label={ __( 'Preview tabs' ) }>
					{ tabs.map( ( tab ) => {
						const selected = tab.id === activeTabId;
						const realm = getPreviewRealm( tab.path );
						return (
							<div
								key={ tab.id }
								className={ clsx(
									styles.tab,
									selected && styles.tabSelected,
									draggedTabId === tab.id && styles.tabDragging
								) }
								draggable
								onDragStart={ ( event ) => {
									draggedTabIdRef.current = tab.id;
									dragOverTabIdRef.current = tab.id;
									setDraggedTabId( tab.id );
									event.dataTransfer.effectAllowed = 'move';
									event.dataTransfer.setData( 'text/plain', String( tab.id ) );
								} }
								onDragOver={ ( event ) => {
									event.preventDefault();
									event.dataTransfer.dropEffect = 'move';
									const sourceId = draggedTabIdRef.current;
									if ( sourceId && dragOverTabIdRef.current !== tab.id ) {
										dragOverTabIdRef.current = tab.id;
										reorderTab( sourceId, tab.id );
									}
								} }
								onDrop={ ( event ) => {
									event.preventDefault();
									finishTabDrag();
								} }
								onDragEnd={ finishTabDrag }
							>
								<Tooltip.Root>
									<Tooltip.Trigger
										render={
											<button
												type="button"
												className={ styles.tabSelect }
												role="tab"
												aria-selected={ selected }
												tabIndex={ selected ? 0 : -1 }
												onClick={ () => selectTab( tab ) }
											/>
										}
									>
										<span className={ styles.tabIcon } data-realm={ realm } aria-hidden="true">
											{ realm === 'frontend' ? (
												<SiteIcon
													className={ styles.tabSiteIcon }
													seed={ `${ site.id }:${ site.name }:${ site.path }` }
													imageSrc={ site.siteIcon }
												/>
											) : (
												<Icon icon={ realm === 'admin' ? wordpress : databaseIcon } size={ 18 } />
											) }
										</span>
										<span className={ styles.tabTitle }>{ tab.title }</span>
									</Tooltip.Trigger>
									<Tooltip.Popup positioner={ <Tooltip.Positioner side="bottom" /> }>
										{ tab.title }
									</Tooltip.Popup>
								</Tooltip.Root>
								<button
									type="button"
									className={ styles.tabClose }
									aria-label={ sprintf(
										/* translators: %s: browser tab title */
										__( 'Close %s' ),
										tab.title
									) }
									onClick={ () => closeTab( tab.id ) }
								>
									<Icon icon={ closeSmall } size={ 16 } />
								</button>
							</div>
						);
					} ) }
				</div>
				<Menu.Root>
					<Menu.Trigger
						render={
							<IconButton
								variant="minimal"
								tone="neutral"
								size="small"
								icon={ plus }
								label={ __( 'New tab' ) }
							/>
						}
					/>
					<Menu.Popup side="bottom" align="end">
						<Menu.Item onClick={ () => addTab( '/' ) }>{ __( 'Front-end' ) }</Menu.Item>
						<Menu.Item
							onClick={ () => addTab( getRealmNavigationPath( '/wp-admin/', getSiteUrl( site ) ) ) }
						>
							{ __( 'WordPress' ) }
						</Menu.Item>
						<Menu.Item onClick={ () => addTab( DATABASE_HOME_PATH ) }>
							{ __( 'Database' ) }
						</Menu.Item>
					</Menu.Popup>
				</Menu.Root>
				{ props.onFullscreenChange ? (
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
							<Menu.Item onClick={ () => props.onFullscreenChange?.( ! fullscreen ) }>
								{ fullscreen ? __( 'Exit full preview' ) : __( 'Full preview' ) }
							</Menu.Item>
						</Menu.Popup>
					</Menu.Root>
				) : null }
			</div>
			<div className={ styles.tabPanels }>
				{ tabs.map( ( tab ) => {
					const selected = tab.id === activeTab?.id;
					return (
						<div
							key={ tab.id }
							className={ clsx( styles.tabPanel, ! selected && styles.tabPanelHidden ) }
							role="tabpanel"
							hidden={ ! selected }
							inert={ selected ? undefined : true }
						>
							<SingleSitePreview
								{ ...props }
								path={ tab.path }
								reloadNonce={ tab.reloadNonce }
								collapsed={ collapsed || ! selected }
								hasTabBar
								onTabCycle={ cycleTab }
								initialHistoryEntries={ tab.historyEntries }
								initialHistoryIndex={ tab.activeHistoryIndex }
								onHistoryChange={ ( entries, activeIndex ) => {
									setTabs( ( current ) =>
										current.map( ( currentTab ) =>
											currentTab.id === tab.id
												? {
														...currentTab,
														historyEntries: entries,
														activeHistoryIndex: activeIndex,
												  }
												: currentTab
										)
									);
								} }
								onPathChange={ ( nextPath ) => {
									setTabs( ( current ) =>
										current.map( ( currentTab ) =>
											currentTab.id === tab.id
												? {
														...currentTab,
														path: nextPath,
														title: getPreviewTabTitle( nextPath, null, site.name ),
												  }
												: currentTab
										)
									);
									if ( selected ) onPathChange?.( nextPath );
								} }
								onTitleChange={ ( title ) => {
									setTabs( ( current ) =>
										current.map( ( currentTab ) => {
											if ( currentTab.id !== tab.id ) return currentTab;
											const nextTitle = getPreviewTabTitle( currentTab.path, title, site.name );
											return currentTab.title === nextTitle
												? currentTab
												: { ...currentTab, title: nextTitle };
										} )
									);
								} }
							/>
						</div>
					);
				} ) }
			</div>
		</div>
	);
}

function SingleSitePreview( {
	site,
	path,
	reloadNonce,
	onAnnotationsDone,
	onPathChange,
	collapsed = false,
	fullscreen = false,
	onFullscreenChange,
	onTitleChange,
	onTabCycle,
	onHistoryChange,
	initialHistoryEntries = [],
	initialHistoryIndex = -1,
	hasTabBar = false,
}: SingleSitePreviewProps ) {
	const connector = useConnector();
	const queryClient = useQueryClient();
	const { chatEnabled } = useAgenticFeatures();
	const startSite = useStartSite();
	const isStarting = useIsSiteStarting( site.id );
	const isBusy = useIsSiteBusy( site );
	const operation = useSiteOperation( site );
	const siteUrl = getSiteUrl( site );
	const canPreview = site.running;
	const canUseWebview = isElectron();
	const trafficLightSpace = useTrafficLightSpace();
	const safePath = getSafePath( path );
	// Which realm the host is pointing the preview at. Derived from the path
	// rather than stored alongside it, so the parent stays the single source of
	// truth for where the preview is aimed.
	const activeRealm = getPreviewRealm( safePath );
	const activeSurfaceKey = getSurfaceKey( activeRealm );
	const siteThumbnail = useQuery( {
		queryKey: [ ...SITE_THUMBNAIL_QUERY_KEY, site.id ],
		queryFn: () => connector.getSiteThumbnail( site.id ),
		enabled: ! canPreview,
		meta: { persist: false },
	} );
	// Surfaces mounted so far. Once created a surface stays mounted and warm;
	// only the active one is visible.
	const [ surfaces, setSurfaces ] = useState< MountedSurfaces >( () => ( {
		siteId: site.id,
		byKey: { [ activeSurfaceKey ]: createPreviewSurface( safePath, reloadNonce ) },
	} ) );
	const activeSurface = surfaces.byKey[ activeSurfaceKey ];
	const browserState = activeSurface?.browser ?? EMPTY_BROWSER_STATE;
	const inspectorState = activeSurface?.inspector ?? EMPTY_INSPECTOR_STATE;
	// 'fit' renders at the pane's natural size; a preset id simulates that
	// viewport; 'split' shows the desktop and mobile presets together.
	const [ viewportMode, setViewportMode ] = useState< ViewportMode >( 'fit' );
	// Orientation of the phone frame, wherever it shows (mobile preset and
	// the split view's phone pane).
	const [ mobileOrientation, setMobileOrientation ] = useState< MobileOrientation >( 'portrait' );
	const [ annotationCancelRequestId, setAnnotationCancelRequestId ] = useState( 0 );
	const [ paneSize, setPaneSize ] = useState< { width: number; height: number } | null >( null );
	const rootRef = useRef< HTMLElement | null >( null );
	const paneRef = useRef< HTMLDivElement | null >( null );
	const commandIdRef = useRef( 0 );
	const onTitleChangeRef = useRef( onTitleChange );
	const onHistoryChangeRef = useRef( onHistoryChange );
	useEffect( () => {
		onTitleChangeRef.current = onTitleChange;
	}, [ onTitleChange ] );
	useEffect( () => {
		onHistoryChangeRef.current = onHistoryChange;
	}, [ onHistoryChange ] );
	useEffect( () => onTitleChangeRef.current?.( browserState.title ), [ browserState.title ] );
	useEffect( () => {
		if ( browserState.historyEntries.length === 0 && initialHistoryEntries.length > 0 ) return;
		onHistoryChangeRef.current?.( browserState.historyEntries, browserState.activeHistoryIndex );
	}, [
		browserState.activeHistoryIndex,
		browserState.historyEntries,
		initialHistoryEntries.length,
	] );
	const canAnnotate = canPreview && inspectorState.ready;
	const progress = browserState.loading
		? Math.max( browserState.progress, 0.12 )
		: browserState.progress;
	const showLoadingProgress = canPreview && progress > 0;
	// Presets are module constants, so this stays referentially stable per
	// mode + orientation.
	const activePreset = getActivePreset( viewportMode, mobileOrientation );
	const splitPreview = isResponsiveSurface( activeSurfaceKey ) && viewportMode === 'split';
	// Simulated frames float inside the layer's padding, so the space they fit
	// into is the measured pane minus that padding.
	const simulatedPaneSize = useMemo(
		() =>
			paneSize
				? {
						width: Math.max( 1, paneSize.width - PREVIEW_PANE_PADDING * 2 ),
						height: Math.max( 1, paneSize.height - PREVIEW_PANE_PADDING * 2 ),
				  }
				: null,
		[ paneSize ]
	);
	// The split view's phone pane: the mobile preset (in its current
	// orientation) scaled to fit the pane height, and capped at half the
	// pane's width so a landscape frame can't crowd out the primary view.
	const splitMobileViewport = useMemo( () => {
		if ( ! splitPreview || ! simulatedPaneSize ) {
			return null;
		}
		const preset = getMobilePreset( mobileOrientation );
		return getSimulatedViewport( preset, {
			width: Math.max( 160, Math.min( preset.width, Math.round( simulatedPaneSize.width / 2 ) ) ),
			height: Math.max( 120, simulatedPaneSize.height - PREVIEW_PANE_PADDING * 2 ),
		} );
	}, [ mobileOrientation, simulatedPaneSize, splitPreview ] );
	// In split mode the desktop simulation fits the space left beside the
	// rendered mobile frame, including its pane padding. This keeps the page
	// at the desktop breakpoint even when the comparison itself is narrow.
	const primaryPaneSize = useMemo( () => {
		if ( ! splitPreview || ! simulatedPaneSize || ! splitMobileViewport ) {
			return simulatedPaneSize;
		}
		const mobilePaneWidth =
			splitMobileViewport.width * splitMobileViewport.scale + PREVIEW_PANE_PADDING * 2;
		return {
			width: Math.max( 1, simulatedPaneSize.width - mobilePaneWidth ),
			height: simulatedPaneSize.height,
		};
	}, [ simulatedPaneSize, splitMobileViewport, splitPreview ] );
	// The viewport a responsive surface simulates. No emulation while the site
	// is stopped: the empty state renders in the plain pane, and the chosen mode
	// re-applies on start.
	const previewViewport = useMemo(
		() => ( canPreview ? getSimulatedViewport( activePreset, primaryPaneSize ) : null ),
		[ activePreset, canPreview, primaryPaneSize ]
	);

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
			if ( isThemeActivationUrl( url ) && connector.getThemeDetails ) {
				void refreshThemeDetails( connector, queryClient, site.id ).catch( () => undefined );
			}
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
		[
			activeSurfaceKey,
			connector,
			onPathChange,
			patchSurface,
			queryClient,
			safePath,
			site.id,
			siteUrl,
		]
	);
	// Commands are addressed to the surface on screen. Each has its own slot, so
	// the hidden one never sees a command it should have missed — and never
	// replays a stale one when it comes back into view.
	const sendBrowserCommand = useCallback(
		( type: BrowserCommand[ 'type' ] ) => {
			commandIdRef.current += 1;
			patchSurface( activeSurfaceKey, { browserCommand: { id: commandIdRef.current, type } } );
		},
		[ activeSurfaceKey, patchSurface ]
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
	const sendInspectorCommand = useCallback(
		( type: InspectorCommand[ 'type' ] ) => {
			commandIdRef.current += 1;
			patchSurface( activeSurfaceKey, { inspectorCommand: { id: commandIdRef.current, type } } );
		},
		[ activeSurfaceKey, patchSurface ]
	);
	// Shortcuts the guest page swallowed and forwarded back over the console
	// bridge: browser commands go to the webview, full preview to the host.
	const handleForwardedShortcut = useCallback(
		( command: PreviewShortcutCommandType ) => {
			if ( command === 'previous-tab' || command === 'next-tab' ) {
				onTabCycle?.( command === 'previous-tab' ? -1 : 1 );
				return;
			}
			if ( command === 'full-preview' ) {
				onFullscreenChange?.( ! fullscreen );
				return;
			}
			if ( inspectorState.isPicking ) {
				return;
			}
			sendBrowserCommand( command );
		},
		[ fullscreen, inspectorState.isPicking, onFullscreenChange, onTabCycle, sendBrowserCommand ]
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
	// seen nonce so merely switching surfaces never reloads the one arrived at.
	const lastHostReloadNonceRef = useRef( reloadNonce );
	useEffect( () => {
		if ( lastHostReloadNonceRef.current === reloadNonce ) {
			return;
		}
		lastHostReloadNonceRef.current = reloadNonce;
		patchSurface( activeSurfaceKey, { reloadNonce } );
	}, [ activeSurfaceKey, patchSurface, reloadNonce ] );

	// Where each realm was last seen, so flipping to WP Admin and back returns
	// to the exact front-end page rather than the site root.
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
		},
		[ site.id ]
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

	useEffect( () => {
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

	// Browser shortcuts (⌘R / ⌘[ / ⌘] / ⌘←/⌘→) pressed while focus is in the
	// host document. Shortcuts pressed inside the guest page are forwarded by
	// the inspector script through the console bridge instead.
	useEffect( () => {
		if ( ! canPreview || collapsed ) {
			return;
		}
		const handleKeyDown = ( event: globalThis.KeyboardEvent ) => {
			const cancelAnnotation =
				inspectorState.isPicking &&
				event.key === 'Escape' &&
				! ( event.target instanceof Element && event.target.closest( '[role="dialog"]' ) );
			const command = inspectorState.isPicking ? null : getBrowserShortcutCommand( event );
			// Only claim the full-preview chord when the host actually offers
			// the mode, so it stays available to the page otherwise.
			const fullPreview = ! command && !! onFullscreenChange && isFullPreviewShortcut( event );
			if ( ! cancelAnnotation && ! command && ! fullPreview ) {
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
			if ( cancelAnnotation ) {
				setAnnotationCancelRequestId( ( current ) => current + 1 );
			} else if ( command ) {
				sendBrowserCommand( command );
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
		inspectorState.isPicking,
		onFullscreenChange,
		sendBrowserCommand,
	] );

	return (
		<aside
			ref={ rootRef }
			className={ clsx(
				styles.root,
				hasTabBar && styles.rootTabbed,
				fullscreen && styles.rootFullscreen
			) }
			aria-label={ __( 'Site preview' ) }
		>
			<div
				// In full preview the toolbar reaches the window's physical left
				// edge, where the macOS traffic lights sit.
				className={ clsx(
					styles.header,
					fullscreen && ! hasTabBar && trafficLightSpace.start && styles.headerTrafficLights
				) }
				style={
					// In RTL the preview pane sits at the physical left, so the
					// header's end-side controls land under the macOS traffic
					// lights — pad past them. Windows/Linux need nothing: their
					// controls sit in the chrome band above the frame.
					! hasTabBar && trafficLightSpace.end ? { paddingInlineEnd: 96 } : undefined
				}
			>
				{ /* Browser navigation stays at the start, the address field fills the
					available middle track, and preview actions stay at the end. */ }
				<div className={ clsx( styles.headerSide, styles.headerSideStart ) }>
					{ canPreview && ! inspectorState.isPicking ? (
						<>
							<BrowserHistoryButton
								direction="back"
								browserState={ browserState }
								shortcut={ browserShortcuts.back }
								onStep={ () => sendBrowserCommand( 'back' ) }
								onJump={ goToHistoryIndex }
							/>
							<BrowserHistoryButton
								direction="forward"
								browserState={ browserState }
								shortcut={ browserShortcuts.forward }
								onStep={ () => sendBrowserCommand( 'forward' ) }
								onJump={ goToHistoryIndex }
							/>
							<IconButton
								variant="minimal"
								tone="neutral"
								size="small"
								icon={ refreshIcon }
								label={ __( 'Refresh' ) }
								shortcut={ browserShortcuts.reload }
								onClick={ () => sendBrowserCommand( 'reload' ) }
							/>
						</>
					) : null }
				</div>
				<div className={ styles.browserLocation }>
					{ canPreview && ! inspectorState.isPicking ? (
						<PreviewAddressBar
							siteUrl={ siteUrl }
							path={ getSafePath( path ) }
							onNavigate={ ( nextPath ) => onPathChange?.( nextPath ) }
						/>
					) : null }
				</div>
				<div className={ clsx( styles.headerSide, styles.headerSideEnd ) }>
					{ canPreview ? (
						<PreviewResponsiveControls
							viewportMode={ viewportMode }
							onViewportModeChange={ handleViewportModeChange }
							viewportControlsDisabled={ ! isResponsiveSurface( activeSurfaceKey ) }
							mobileOrientation={ mobileOrientation }
							onMobileOrientationChange={ handleMobileOrientationChange }
						/>
					) : null }
					{ canPreview && chatEnabled && connector.capabilities.annotatePreview ? (
						<PreviewAnnotationControls
							isPicking={ inspectorState.isPicking }
							annotationCount={ inspectorState.annotationCount }
							hasUnsavedDraft={ inspectorState.hasUnsavedDraft }
							cancelRequestId={ annotationCancelRequestId }
							disabled={ ! canAnnotate }
							onCommand={ sendInspectorCommand }
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
				<div ref={ paneRef } className={ styles.previewViewport }>
					{ canPreview ? (
						// One stacked layer per mounted surface. Only the active layer is
						// visible; the other stays mounted and laid out at its own size, so
						// coming back to it is a visibility swap with nothing to resize,
						// reload or re-emulate.
						( Object.keys( surfaces.byKey ) as PreviewSurfaceKey[] ).map( ( key ) => {
							const surface = surfaces.byKey[ key ];
							if ( ! surface ) {
								return null;
							}
							const active = key === activeSurfaceKey;
							const viewport = isResponsiveSurface( key ) ? previewViewport : null;
							const surfaceUrl = `${ siteUrl }${ surface.path }`;
							return (
								<div
									key={ key }
									className={ clsx(
										styles.realmLayer,
										viewport && styles.realmLayerSimulated,
										! active && styles.realmLayerHidden
									) }
									inert={ active ? undefined : true }
								>
									{ viewport ? (
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
										className={ clsx( styles.surfaceFrame, viewport && styles.deviceFrame ) }
										style={ getFrameStyle( viewport ) }
									>
										{ canUseWebview ? (
											<WebviewSurface
												key={ `${ site.id }-${ key }` }
												url={ surfaceUrl }
												reloadNonce={ surface.reloadNonce }
												// phpMyAdmin isn't an annotation target, so the
												// inspector never goes near it.
												inspector={ isResponsiveSurface( key ) }
												onAnnotationsDone={ onAnnotationsDone }
												onInspectorState={ ( state ) => patchSurface( key, { inspector: state } ) }
												onInspectorCancelRequest={ () =>
													setAnnotationCancelRequestId( ( current ) => current + 1 )
												}
												inspectorCommand={ surface.inspectorCommand }
												browserCommand={ surface.browserCommand }
												initialNavigationHistory={
													key === activeSurfaceKey && initialHistoryEntries.length > 0
														? {
																entries: initialHistoryEntries,
																activeIndex: initialHistoryIndex,
														  }
														: undefined
												}
												onBrowserStateChange={ ( state ) => {
													patchSurface( key, { browser: state } );
												} }
												onBrowserCommand={ handleForwardedShortcut }
												onNavigate={ ( url ) => handleSurfaceNavigation( key, url ) }
												viewport={ viewport }
											/>
										) : (
											// Non-Electron fallback: plain iframe, no inspector. Reloads
											// by remounting; back/forward aren't reachable from the host.
											<iframe
												key={ `${ surfaceUrl }#${ surface.reloadNonce }#${
													surface.browserCommand?.type === 'reload' ? surface.browserCommand.id : 0
												}` }
												className={ styles.iframe }
												style={ getIframeStyle( viewport ) }
												src={ surfaceUrl }
												title={ site.name }
												onLoad={ ( event ) => {
													const title = getIframeTitle( event.currentTarget );
													handleSurfaceNavigation( key, event.currentTarget.src );
													patchSurface( key, {
														browser: {
															...surface.browser,
															loading: false,
															progress: 0,
															title,
														},
													} );
												} }
											/>
										) }
									</div>
									{ active && splitPreview && splitMobileViewport ? (
										// The comparison's phone pane: a lean companion surface that
										// follows the primary's navigation (shared url) but keeps
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
														key={ `${ site.id }-${ key }-mobile` }
														url={ surfaceUrl }
														reloadNonce={ surface.reloadNonce }
														inspector={ false }
														viewport={ splitMobileViewport }
														browserCommand={
															surface.browserCommand?.type === 'reload'
																? surface.browserCommand
																: null
														}
														onNavigate={ ( url ) => handleSurfaceNavigation( key, url ) }
													/>
												) : (
													<iframe
														key={ `${ surfaceUrl }#${ surface.reloadNonce }` }
														className={ styles.iframe }
														style={ getIframeStyle( splitMobileViewport ) }
														src={ surfaceUrl }
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
								</div>
							);
						} )
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
												/* translators: %s: an operation in progress, e.g. "Saving settings". */
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
	onInspectorCancelRequest?: () => void;
	inspectorCommand?: InspectorCommand | null;
	browserCommand?: BrowserCommand | null;
	initialNavigationHistory?: {
		entries: BrowserHistoryEntry[];
		activeIndex: number;
	};
	onBrowserStateChange?: ( state: BrowserNavigationState ) => void;
	onBrowserCommand?: ( type: PreviewShortcutCommandType ) => void;
	onNavigate?: ( url: string ) => void;
	// Simulated guest viewport, or null for the webview's natural size.
	viewport?: PreviewViewport | null;
	// Whether to inject the annotation inspector into the guest page. Off for
	// surfaces that can't be annotated (phpMyAdmin, the split companion).
	inspector?: boolean;
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
	onInspectorCancelRequest,
	inspectorCommand,
	browserCommand,
	initialNavigationHistory,
	onBrowserStateChange,
	onBrowserCommand,
	onNavigate,
	viewport = null,
	inspector = true,
}: WebviewSurfaceProps ) {
	const ref = useRef< HTMLElement | null >( null );
	const [ ready, setReady ] = useState( false );
	// How many loads have reached `dom-ready`. `ready` alone can't drive
	// per-load work — it latches true on the first one and never changes again.
	const [ domReadyCount, setDomReadyCount ] = useState( 0 );
	const onAnnotationsDoneRef = useRef( onAnnotationsDone );
	const onInspectorStateRef = useRef( onInspectorState );
	const onInspectorCancelRequestRef = useRef( onInspectorCancelRequest );
	const onBrowserStateChangeRef = useRef( onBrowserStateChange );
	const onBrowserCommandRef = useRef( onBrowserCommand );
	const onNavigateRef = useRef( onNavigate );
	const browserStateRef = useRef< BrowserNavigationState >( EMPTY_BROWSER_STATE );
	const domReadyRef = useRef( false );
	const inspectorEnabledRef = useRef( inspector );
	const currentUrlRef = useRef( url );
	const storedAnnotationsRef = useRef< Annotation[] >( [] );
	const lastReloadNonceRef = useRef( reloadNonce );
	const initialNavigationHistoryRef = useRef( initialNavigationHistory );
	const didRestoreNavigationHistoryRef = useRef( false );
	const progressTimerRef = useRef< ReturnType< typeof setInterval > | null >( null );
	const progressResetTimerRef = useRef< ReturnType< typeof setTimeout > | null >( null );
	useEffect( () => {
		onAnnotationsDoneRef.current = onAnnotationsDone;
	}, [ onAnnotationsDone ] );
	useEffect( () => {
		onInspectorStateRef.current = onInspectorState;
	}, [ onInspectorState ] );
	useEffect( () => {
		onInspectorCancelRequestRef.current = onInspectorCancelRequest;
	}, [ onInspectorCancelRequest ] );
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
			setDomReadyCount( ( count ) => count + 1 );
			const storedHistory = initialNavigationHistoryRef.current;
			if (
				! didRestoreNavigationHistoryRef.current &&
				storedHistory &&
				storedHistory.entries.length > 1
			) {
				didRestoreNavigationHistoryRef.current = true;
				const { ipcApi } = window as PreviewWindow;
				let webContentsId: number;
				try {
					webContentsId = getWebviewContentsId( webview );
				} catch {
					webContentsId = 0;
				}
				if ( webContentsId ) {
					void ipcApi
						?.restoreWebviewNavigationHistory?.(
							webContentsId,
							storedHistory.entries,
							storedHistory.activeIndex
						)
						.catch( () => undefined );
				}
			}
			publishDocumentTitle();
			publishNavigationHistory();
			if ( ! inspectorEnabledRef.current ) {
				return;
			}
			// If annotations were collected on a previous page, seed
			// window.__studioInspectorState before the IIFE runs so the
			// freshly-injected inspector picks them up on init.
			const stored = storedAnnotationsRef.current;
			const preload =
				stored.length > 0 ? `window.__studioInspectorState=${ JSON.stringify( stored ) };` : '';
			webview
				.executeJavaScript( preload + INSPECTOR_PAGE_SCRIPT, false )
				.then( () => {
					onInspectorStateRef.current?.( {
						ready: true,
						isPicking: false,
						annotationCount: stored.length,
						hasUnsavedDraft: false,
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
			if ( parsed.type === 'cancel-requested' ) {
				onInspectorCancelRequestRef.current?.();
				return;
			}
			if ( parsed.type === 'state' ) {
				onInspectorStateRef.current?.( {
					ready: true,
					isPicking: Boolean( parsed.isPicking ),
					annotationCount: typeof parsed.annotationCount === 'number' ? parsed.annotationCount : 0,
					hasUnsavedDraft: Boolean( parsed.hasUnsavedDraft ),
				} );
				return;
			}
			if ( parsed.type === 'annotations-updated' ) {
				if ( Array.isArray( parsed.annotations ) ) {
					storedAnnotationsRef.current = parsed.annotations;
				}
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
				onInspectorStateRef.current?.( {
					...EMPTY_INSPECTOR_STATE,
					annotationCount: storedAnnotationsRef.current.length,
				} );
			}
			publishBrowserState( { title: null } );
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
		// toolbar's ⟳ — otherwise the agent's `refresh_browser` reloads with a
		// warm cache and serves the CSS/JS it just edited back stale.
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

	// The CDP metrics override outlives a navigation, but only for as long as
	// the guest webContents it was attached to: if that one goes away (a crash,
	// or a process swap that drops the debugger) the override goes with it while
	// `applied` still claims otherwise, and nothing would ever restore it. So
	// re-assert on every dom-ready as well as on viewport changes — one extra
	// round-trip per load in a responsive mode, and it self-heals. The `applied`
	// ref still skips the initial clear so plain previews pay nothing. The value
	// is debounced because pane resizes stream continuous viewport changes and
	// each application is an IPC + CDP round-trip; the CSS frame tracks the
	// drag live and the emulation settles right behind it.
	const debouncedViewport = useDebouncedValue( viewport, 150 );
	const appliedViewportRef = useRef( false );
	useEffect( () => {
		if ( ! domReadyCount ) return;
		if ( ! debouncedViewport && ! appliedViewportRef.current ) return;
		const webview = ref.current as WebviewTag | null;
		if ( ! webview ) return;
		appliedViewportRef.current = Boolean( debouncedViewport );
		void applyWebviewViewport( webview, debouncedViewport ).catch( () => undefined );
	}, [ debouncedViewport, domReadyCount ] );

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
