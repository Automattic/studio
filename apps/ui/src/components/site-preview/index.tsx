import { getSiteOperationLabel } from '@studio/common/lib/site-operation-labels';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { __, sprintf } from '@wordpress/i18n';
import { chevronDown, chevronLeft, chevronRight, Icon, moreVertical } from '@wordpress/icons';
import { ariaKeyShortcut, displayShortcut, isAppleOS, isKeyboardEvent } from '@wordpress/keycodes';
import { Button, IconButton, Tooltip } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DotGrid } from '@/components/dot-grid';
import * as Menu from '@/components/menu';
import { OpenInMenu } from '@/components/open-in-menu';
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
import { annotationIcon, playIcon, refreshIcon } from '@/lib/icons';
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
	createInspectorPageScript,
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
	type: 'annotations-updated' | 'browser-command' | 'done' | 'state';
	bridgeToken?: string;
	annotations?: Annotation[];
	isPicking?: boolean;
	annotationCount?: number;
	command?: PreviewShortcutCommandType;
}

const MAX_INSPECTOR_BRIDGE_MESSAGE_LENGTH = 1_100_000;

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
		a.ready === b.ready && a.isPicking === b.isPicking && a.annotationCount === b.annotationCount
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
	viewportControlsDisabled,
	mobileOrientation,
	onMobileOrientationChange,
	fullscreen,
	onFullscreenChange,
}: {
	viewportMode: ViewportMode;
	onViewportModeChange: ( mode: ViewportMode ) => void;
	// Greys out the viewport controls for a surface that can't simulate one,
	// keeping the chosen mode for when the preview returns to one that can.
	viewportControlsDisabled: boolean;
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
						disabled={ viewportControlsDisabled }
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
								disabled={ viewportControlsDisabled }
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

// Annotation commands. With nothing pending there's only one command, so the
// toolbar shows a bare toggle at every width. Once notes are waiting there are
// two, and a narrow toolbar can't fit them inline — `style.module.css` swaps
// the inline pair for a split button, so only one layout is ever in the a11y
// tree.
function PreviewAnnotationControls( {
	isPicking,
	annotationCount,
	disabled,
	onCommand,
}: {
	isPicking: boolean;
	annotationCount: number;
	disabled: boolean;
	onCommand: ( type: InspectorCommand[ 'type' ] ) => void;
} ) {
	const toggleLabel = isPicking ? __( 'Stop annotating' ) : __( 'Annotate' );
	const submitLabel = __( 'Send annotations to chat' );
	const hasPending = annotationCount > 0;
	return (
		<>
			<div
				className={ clsx( styles.annotationControls, hasPending && styles.annotationControlsWide ) }
			>
				<IconButton
					variant="minimal"
					tone="neutral"
					size="small"
					icon={ annotationIcon }
					label={ toggleLabel }
					disabled={ disabled }
					aria-pressed={ isPicking }
					onClick={ () => onCommand( 'toggle-picking' ) }
				/>
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
						"Open in…" control beside it: the annotation icon still toggles directly,
						the chevron opens the pair. Modal for the same reason as the
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
											className={ splitStyles.splitAction }
											aria-label={ toggleLabel }
											aria-pressed={ isPicking }
											disabled={ disabled }
											onClick={ () => onCommand( 'toggle-picking' ) }
										/>
									}
								>
									<Icon icon={ annotationIcon } size={ 18 } />
								</Tooltip.Trigger>
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
							<Menu.Item onClick={ () => onCommand( 'toggle-picking' ) }>{ toggleLabel }</Menu.Item>
							<Menu.Item onClick={ () => onCommand( 'submit' ) }>{ submitLabel }</Menu.Item>
						</Menu.Popup>
					</Menu.Root>
				</div>
			) : null }
		</>
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
			if ( command === 'full-preview' ) {
				onFullscreenChange?.( ! fullscreen );
				return;
			}
			sendBrowserCommand( command );
		},
		[ fullscreen, onFullscreenChange, sendBrowserCommand ]
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
	// or from the database only swaps which surface is visible — it's already
	// loaded, at its own size, so there's nothing to reload or resize.
	const handleSwitchRealm = useCallback(
		( realm: PreviewRealm ) => {
			// Re-selecting the active realm (e.g. via its shortcut) is a no-op.
			if ( activeRealm === realm ) {
				return;
			}
			// The agentic UI opens the realm in its in-app preview panel.
			void connector.trackEvent( getRealmOpenEvent( realm ), { browser: 'internal' } );
			const target = lastRealmPathsRef.current[ realm ];
			// Returning to a surface that's already sitting on the target path just
			// reveals it; anything else is a real navigation.
			if ( surfaces.byKey[ getSurfaceKey( realm ) ]?.path === target ) {
				onPathChange?.( target );
				return;
			}
			onPathChange?.( getRealmNavigationPath( target, siteUrl ) );
		},
		[ activeRealm, connector, onPathChange, siteUrl, surfaces ]
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
					// In RTL the preview pane sits at the physical left, so the
					// header's end-side controls land under the macOS traffic
					// lights — pad past them. Windows/Linux need nothing: their
					// controls sit in the chrome band above the frame.
					trafficLightSpace.end ? { paddingInlineEnd: 96 } : undefined
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
						<PreviewAnnotationControls
							isPicking={ inspectorState.isPicking }
							annotationCount={ inspectorState.annotationCount }
							disabled={ ! canAnnotate }
							onCommand={ sendInspectorCommand }
						/>
					) : null }
					<OpenInMenu key={ site.id } site={ site } browserPath={ getSafePath( path ) } />
					{ canPreview ? (
						<PreviewOverflowMenu
							viewportMode={ viewportMode }
							onViewportModeChange={ handleViewportModeChange }
							viewportControlsDisabled={ ! isResponsiveSurface( activeSurfaceKey ) }
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
												inspectorCommand={ surface.inspectorCommand }
												browserCommand={ surface.browserCommand }
												onBrowserStateChange={ ( state ) =>
													patchSurface( key, { browser: state } )
												}
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
													handleSurfaceNavigation( key, event.currentTarget.src );
													patchSurface( key, {
														browser: {
															...surface.browser,
															loading: false,
															progress: 0,
															title: getIframeTitle( event.currentTarget ),
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
	inspectorCommand?: InspectorCommand | null;
	browserCommand?: BrowserCommand | null;
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
	inspectorCommand,
	browserCommand,
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
	const onBrowserStateChangeRef = useRef( onBrowserStateChange );
	const onBrowserCommandRef = useRef( onBrowserCommand );
	const onNavigateRef = useRef( onNavigate );
	const browserStateRef = useRef< BrowserNavigationState >( EMPTY_BROWSER_STATE );
	const domReadyRef = useRef( false );
	const inspectorEnabledRef = useRef( inspector );
	const currentUrlRef = useRef( url );
	const storedAnnotationsRef = useRef< Annotation[] >( [] );
	const inspectorBridgeTokenRef = useRef( globalThis.crypto.randomUUID() );
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
			publishDocumentTitle();
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
				.executeJavaScript(
					preload + createInspectorPageScript( inspectorBridgeTokenRef.current ),
					false
				)
				.then( () => {
					onInspectorStateRef.current?.( {
						ready: true,
						isPicking: false,
						annotationCount: stored.length,
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
			if ( consoleEvent.message.length > MAX_INSPECTOR_BRIDGE_MESSAGE_LENGTH ) return;
			let parsed: InspectorEvent | null = null;
			try {
				parsed = JSON.parse( consoleEvent.message.slice( INSPECTOR_BRIDGE_PREFIX.length ) );
			} catch {
				return;
			}
			if ( ! parsed ) return;
			if ( parsed.bridgeToken !== inspectorBridgeTokenRef.current ) return;
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
		const detail = JSON.stringify( {
			type: inspectorCommand.type,
			bridgeToken: inspectorBridgeTokenRef.current,
		} );
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
