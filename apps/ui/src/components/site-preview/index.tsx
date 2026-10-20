import { DESIGN_SYSTEM_PREVIEW_PATH } from '@studio/common/ai/chat-artifacts';
import { getSiteOperationLabel } from '@studio/common/lib/site-operation-labels';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { __, _n, sprintf } from '@wordpress/i18n';
import {
	chevronDown,
	closeSmall,
	fullscreen as fullscreenIcon,
	Icon,
	pencil,
} from '@wordpress/icons';
import {
	ariaKeyShortcut,
	displayShortcut,
	isAppleOS,
	isKeyboardEvent,
	shortcutAriaLabel,
} from '@wordpress/keycodes';
import { Button, Dialog, IconButton, Tooltip } from '@wordpress/ui';
import { clsx } from 'clsx';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DesignSystemView } from '@/components/design-system-view';
import { DotGrid } from '@/components/dot-grid';
import * as Menu from '@/components/menu';
import { useConnector } from '@/data/core';
import { useAgenticFeatures } from '@/data/queries/use-agentic-features';
import { siteDesignQueryKey, useSiteDesign } from '@/data/queries/use-site-design';
import { useSiteIcon } from '@/data/queries/use-site-icon';
import {
	useIsSiteBusy,
	useIsSiteStarting,
	useSiteOperation,
	useStartSite,
} from '@/data/queries/use-sites';
import { themeDetailsQueryKey } from '@/hooks/use-theme-details';
import { useTrafficLightSpace } from '@/hooks/use-traffic-light-space';
import { useWindowControlsInset } from '@/hooks/use-window-controls-inset';
import { getSiteUrl } from '@/lib/get-site-url';
import { browserBackIcon, browserForwardIcon, playIcon, refreshIcon } from '@/lib/icons';
import {
	DATABASE_HOME_PATH,
	getPathFromPreviewUrl,
	getPreviewRealm,
	getRealmNavigationPath,
	getRealmOpenEvent,
	PreviewAddressBar,
	type PreviewRealm,
} from './address-bar';
import {
	INSPECTOR_BRIDGE_PREFIX,
	INSPECTOR_COMMAND_EVENT,
	INSPECTOR_PAGE_SCRIPT,
} from './inspector-script';
import styles from './style.module.css';
import type { Annotation, InspectorCommand, InspectorState } from './types';
import type { SiteDetails } from '@/data/core';

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
	// Enters/leaves full preview. The toolbar toggle only renders when provided.
	onFullscreenChange?: ( value: boolean ) => void;
	// Controls at the toolbar's start, for when the preview is the leftmost pane.
	toolbarStart?: ReactNode;
	// The toolbar reaches the window's start edge, where the macOS traffic
	// lights sit.
	atWindowStart?: boolean;
}

interface InspectorEvent {
	type: 'annotations-updated' | 'browser-command' | 'cancel-requested' | 'done' | 'state';
	annotations?: Annotation[];
	isPicking?: boolean;
	annotationCount?: number;
	hasUnsavedDraft?: boolean;
	command?: PreviewShortcutCommandType;
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
}

type BrowserShortcutCommandType = 'back' | 'forward' | 'reload';

// What the guest page can forward over the console bridge: the browser
// commands it swallows, plus the full-preview toggle (the webview covers most
// of the window in full preview, so the host listener alone would miss it).
type PreviewShortcutCommandType = BrowserShortcutCommandType | 'full-preview';

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

// ⇧⌘F (Ctrl+Shift+F elsewhere) toggles full preview. Listed in Settings →
// Keyboard alongside the other preview shortcuts.
const FULL_PREVIEW_SHORTCUT_KEY = 'f';

function getFullPreviewShortcutDescriptor() {
	return {
		displayShortcut: displayShortcut.primaryShift( FULL_PREVIEW_SHORTCUT_KEY ),
		ariaKeyShortcut: ariaKeyShortcut.primaryShift( FULL_PREVIEW_SHORTCUT_KEY ),
		label: shortcutAriaLabel.primaryShift( FULL_PREVIEW_SHORTCUT_KEY ),
	};
}

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
	disabledReason,
	onCommand,
}: {
	isPicking: boolean;
	annotationCount: number;
	hasUnsavedDraft: boolean;
	cancelRequestId: number;
	disabled: boolean;
	disabledReason?: string;
	onCommand: ( type: InspectorCommand[ 'type' ] ) => void;
} ) {
	const [ cancelDialogOpen, setCancelDialogOpen ] = useState( false );
	const toggleLabel = isPicking ? __( 'Cancel annotation' ) : __( 'Annotate' );
	const submitLabel = __( 'Send notes to chat' );
	const submitDescription = sprintf(
		/* translators: %d is the number of annotation notes waiting to be sent. */
		_n(
			'%d note waiting. Sending finishes annotating.',
			'%d notes waiting. Sending finishes annotating.',
			annotationCount
		),
		annotationCount
	);
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
				<span
					className={ styles.disabledControlTooltipTarget }
					title={ disabled ? disabledReason : undefined }
				>
					<Tooltip.Root>
						<Tooltip.Trigger
							render={
								<Button
									variant="outline"
									tone="neutral"
									size="small"
									className={ clsx(
										styles.annotationToggle,
										isPicking && styles.annotationToggleActive
									) }
									aria-label={ toggleLabel }
									aria-description={ disabled ? disabledReason : undefined }
									disabled={ disabled }
									onClick={ handleToggle }
								>
									<Icon icon={ isPicking ? closeSmall : pencil } size={ 18 } />
									<span className={ styles.toolbarLabel }>
										{ isPicking ? __( 'Cancel' ) : __( 'Annotate' ) }
									</span>
								</Button>
							}
						/>
						<Tooltip.Popup positioner={ <Tooltip.Positioner side="bottom" /> }>
							{ disabledReason ?? ( isPicking ? __( 'Cancel annotation' ) : __( 'Add notes' ) ) }
						</Tooltip.Popup>
					</Tooltip.Root>
				</span>
				{ hasPending ? (
					<Button
						variant="solid"
						tone="brand"
						size="small"
						className={ styles.annotationSubmit }
						disabled={ disabled }
						aria-label={ submitLabel }
						aria-description={ submitDescription }
						onClick={ () => onCommand( 'submit' ) }
					>
						{ submitLabel }
					</Button>
				) : null }
			</div>
			{ hasPending ? (
				<div className={ styles.annotationMenu }>
					{ /* Two commands to offer, so the narrow layout folds them into one
						menu, like the "Open in…" control beside it. Modal for the same
						reason as the overflow menu — the webview swallows outside clicks,
						so the backdrop is what dismisses it. */ }
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
												className={ styles.annotationMenuTrigger }
												aria-label={ __( 'Annotation options' ) }
												disabled={ disabled }
											/>
										}
									>
										<Icon icon={ isPicking ? closeSmall : pencil } size={ 18 } />
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
								{ __( 'Annotation options' ) }
							</Tooltip.Popup>
						</Tooltip.Root>
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

export function SitePreview( {
	site,
	path,
	reloadNonce,
	onAnnotationsDone,
	onPathChange,
	collapsed = false,
	fullscreen = false,
	onFullscreenChange,
	toolbarStart,
	atWindowStart = false,
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
	const windowControlsInset = useWindowControlsInset( 'toolbar' );
	const safePath = getSafePath( path );
	// Which realm the host is pointing the preview at. Derived from the path
	// rather than stored alongside it, so the parent stays the single source of
	// truth for where the preview is aimed.
	const activeRealm = getPreviewRealm( safePath );
	const activeSurfaceKey = getSurfaceKey( activeRealm );
	const siteDesign = useSiteDesign( site );
	const siteIcon = useSiteIcon( site.id );
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
	const [ annotationCancelRequestId, setAnnotationCancelRequestId ] = useState( 0 );
	const rootRef = useRef< HTMLElement | null >( null );
	const commandIdRef = useRef( 0 );
	const canAnnotate = canPreview && inspectorState.ready;
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
			if ( isThemeActivationUrl( url ) ) {
				void queryClient.invalidateQueries( { queryKey: themeDetailsQueryKey( site.id ) } );
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
		[ activeSurfaceKey, onPathChange, patchSurface, queryClient, safePath, site.id, siteUrl ]
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
			if ( inspectorState.isPicking ) {
				return;
			}
			sendBrowserCommand( command );
		},
		[ fullscreen, inspectorState.isPicking, onFullscreenChange, sendBrowserCommand ]
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
	// seen nonce so a switch doesn't replay it on the surface arrived at.
	const lastHostReloadNonceRef = useRef( reloadNonce );
	useEffect( () => {
		if ( lastHostReloadNonceRef.current === reloadNonce ) {
			return;
		}
		lastHostReloadNonceRef.current = reloadNonce;
		if ( activeSurfaceKey === 'design' ) {
			sendSurfaceCommand( 'design', 'reload' );
		} else {
			patchSurface( activeSurfaceKey, { reloadNonce } );
		}
	}, [ activeSurfaceKey, patchSurface, reloadNonce, sendSurfaceCommand ] );

	const onDesignInspectorState = useCallback(
		( state: InspectorState ) => patchSurface( 'design', { inspector: state } ),
		[ patchSurface ]
	);

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

	// Browser shortcuts (⌘R / ⌘[ / ⌘] / ⌘←/⌘→)
	// pressed while focus is in the host document. Shortcuts pressed inside the
	// guest page are forwarded by the inspector script through the console
	// bridge instead.
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
			className={ clsx( styles.root, fullscreen && styles.rootFullscreen ) }
			aria-label={ __( 'Site preview' ) }
		>
			<div
				hidden={ ! canPreview && ! toolbarStart }
				className={ clsx(
					styles.header,
					! canPreview && ! toolbarStart && styles.browserChromeHidden,
					inspectorState.isPicking && styles.headerAnnotating,
					atWindowStart && trafficLightSpace.start && styles.headerTrafficLights
				) }
				style={ {
					// In RTL the preview pane sits at the physical left, so the
					// header's end-side controls land under the macOS traffic
					// lights — pad past them.
					...( trafficLightSpace.end && { paddingInlineEnd: 96 } ),
					...( windowControlsInset > 0 && {
						paddingRight: `calc(${ windowControlsInset }px + var(--wpds-dimension-padding-sm))`,
					} ),
				} }
			>
				{ /* Browser navigation stays at the start, the address field fills the
					available middle track, and preview actions stay at the end. */ }
				<div className={ styles.headerSide }>
					{ toolbarStart }
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
					{ canPreview && inspectorState.isPicking ? (
						<p className={ styles.annotatingMessage } role="status">
							{ __( 'Click anything on the page to add a note' ) }
						</p>
					) : null }
					{ canPreview && ! inspectorState.isPicking ? (
						<PreviewAddressBar
							site={ site }
							siteIcon={ siteIcon }
							siteUrl={ siteUrl }
							path={ getSafePath( path ) }
							onNavigate={ ( nextPath ) => onPathChange?.( nextPath ) }
							onSwitchRealm={ handleSwitchRealm }
							hasDesignSystem={ !! siteDesign.data }
							onOpenExternal={
								activeRealm === 'design'
									? undefined
									: () => {
											const safePath = getSafePath( path );
											const realm = getPreviewRealm( safePath );
											// Matches the realm on screen (front end / WP Admin / phpMyAdmin)
											// rather than always the front end.
											void connector.trackEvent( getRealmOpenEvent( realm ), {
												browser: 'external',
											} );
											// Admin screens go through /studio-auto-login so they don't land on
											// the login form; the front end opens logged out.
											void connector
												.openSiteUrl( site.id, safePath, { autoLogin: realm !== 'frontend' } )
												.catch( ( error ) => {
													console.error( 'Failed to open site in browser:', error );
												} );
									  }
							}
						/>
					) : null }
				</div>
				<div className={ clsx( styles.headerSide, styles.headerSideEnd ) }>
					{ canPreview &&
					chatEnabled &&
					// Studio renders the design system itself, so it needs no page injection.
					( connector.capabilities.annotatePreview || activeSurfaceKey === 'design' ) ? (
						<PreviewAnnotationControls
							isPicking={ inspectorState.isPicking }
							annotationCount={ inspectorState.annotationCount }
							hasUnsavedDraft={ inspectorState.hasUnsavedDraft }
							cancelRequestId={ annotationCancelRequestId }
							disabled={ ! canAnnotate }
							disabledReason={
								activeSurfaceKey === 'database' ? __( 'Not available for Database' ) : undefined
							}
							onCommand={ sendInspectorCommand }
						/>
					) : null }
					{ canPreview && onFullscreenChange ? (
						<IconButton
							variant="minimal"
							tone="neutral"
							size="small"
							icon={ fullscreenIcon }
							label={ fullscreen ? __( 'Exit full preview' ) : __( 'Full preview' ) }
							shortcut={ getFullPreviewShortcutDescriptor() }
							aria-pressed={ fullscreen }
							onClick={ () => onFullscreenChange( ! fullscreen ) }
							positioner={ <Tooltip.Positioner side="bottom" /> }
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
				<div className={ styles.previewViewport }>
					{ canPreview ? (
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
														annotations={ {
															command: surface.inspectorCommand,
															onState: onDesignInspectorState,
															onDone: onAnnotationsDone,
														} }
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
												onAnnotationsDone={ onAnnotationsDone }
												onInspectorState={ ( state ) => patchSurface( key, { inspector: state } ) }
												onInspectorCancelRequest={ () =>
													setAnnotationCancelRequestId( ( current ) => current + 1 )
												}
												inspectorCommand={ surface.inspectorCommand }
												browserCommand={ surface.browserCommand }
												onBrowserStateChange={ ( state ) => {
													patchSurface( key, { browser: state } );
												} }
												onBrowserCommand={ handleForwardedShortcut }
												onNavigate={ ( url ) => handleSurfaceNavigation( key, url ) }
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
	onBrowserStateChange?: ( state: BrowserNavigationState ) => void;
	onBrowserCommand?: ( type: PreviewShortcutCommandType ) => void;
	onNavigate?: ( url: string ) => void;
	// Whether to inject the annotation inspector into the guest page. Off for
	// phpMyAdmin, which can't be annotated.
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
	onBrowserStateChange,
	onBrowserCommand,
	onNavigate,
	inspector = true,
}: WebviewSurfaceProps ) {
	const ref = useRef< HTMLElement | null >( null );
	const [ ready, setReady ] = useState( false );
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
		// toolbar's ⟳ — otherwise the reload after an agent run uses a warm
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
