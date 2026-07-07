import { useQuery } from '@tanstack/react-query';
import { __, sprintf } from '@wordpress/i18n';
import {
	aspectRatio,
	capturePhoto,
	chevronLeft,
	chevronRight,
	closeSmall,
	code,
	copy,
	crop,
	external,
	file as fileIcon,
	fullscreen as fullscreenIcon,
	moreVertical,
	pencil,
	search,
	trash,
} from '@wordpress/icons';
import { ariaKeyShortcut, displayShortcut, isKeyboardEvent } from '@wordpress/keycodes';
import { Button, Icon, IconButton, Tooltip } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DotGrid } from '@/components/dot-grid';
import { IconSwitch } from '@/components/icon-switch';
import * as Menu from '@/components/menu';
import { ResizeHandle, ResizeOverlay } from '@/components/resize-handle';
import { QuickMenuItem, QuickMenuPopup, QuickMenuTrigger } from '@/components/site-quick-menu';
import { toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { useIsSiteStarting, useStartSite } from '@/data/queries/use-sites';
import { usePointerDrag } from '@/hooks/use-pointer-drag';
import { useSidebarCollapsed } from '@/hooks/use-sidebar-collapsed';
import { getSiteUrl } from '@/lib/get-site-url';
import { bottomDrawerIcon, moonIcon, playIcon, refreshIcon, sunIcon } from '@/lib/icons';
import { usePluginSiteTag } from '@/lib/plugin-prototype';
import {
	formatPreviewConsoleEntriesForText,
	getPreviewConsoleSourceLabel,
	MAX_PREVIEW_CONSOLE_ENTRIES,
} from './console-utils';
import {
	DATABASE_HOME_PATH,
	getPathFromPreviewUrl,
	getPreviewRealm,
	getRealmNavigationPath,
	PreviewAddressBar,
	REALM_SHORTCUT_KEYS,
	type PreviewRealm,
} from './location-omnibox';
import styles from './style.module.css';
import {
	areBrowserStatesEqual,
	EMPTY_BROWSER_STATE,
	EMPTY_INSPECTOR_STATE,
	WebviewSurface,
	type BrowserCommand,
	type BrowserNavigationState,
	type BrowserShortcutCommandType,
	type InspectorCommandRequest,
	type InspectorState,
	type PageClipRequest,
	type PreviewColorScheme,
	type PreviewViewport,
} from './webview-surface';
import type {
	PreviewConsoleEntry,
	PreviewConsoleLevel,
	PreviewConsoleTextFile,
	RawClipCapture,
} from './types';
import type { SiteDetails } from '@/data/core';
import type { ComposerClipInput } from '@studio/common/ai/composer-attachments';
import type {
	AgentMarker,
	ClipMarker,
	InspectorHostCommand,
	InspectorMode,
} from '@studio/common/inspector/protocol';
import type {
	CSSProperties,
	ComponentProps,
	KeyboardEvent as ReactKeyboardEvent,
	ReactElement,
} from 'react';

export type { PreviewConsoleEntry, PreviewConsoleTextFile, RawClipCapture } from './types';
export type { PreviewViewport } from './webview-surface';
export { getPathFromPreviewUrl } from './location-omnibox';

interface SitePreviewProps {
	site: SiteDetails;
	// Path to display within the previewed site, controlled by the parent so
	// it can be updated by chat artifact events even when the panel was
	// previously collapsed.
	path: string;
	// Bumped by the parent to force a webview reload.
	reloadNonce: number;
	// Called for every finished clip (element, region, page, console): the
	// session view turns it into a composer attachment. The clip UI only
	// renders when provided.
	onClip?: ( input: ComposerClipInput ) => void | Promise< void >;
	// Marker-popup edits to existing clips (the composer owns them).
	onClipUpdate?: ( id: string, comment: string ) => void;
	onClipRemove?: ( id: string ) => void;
	// "Add selected text to chat": quoted text for the composer draft.
	onComposerText?: ( text: string ) => void;
	// The active session's clips, mirrored into the guest page as numbered
	// markers (and used for chip↔marker identity).
	clipMarkers?: ClipMarker[];
	// Agent-placed highlights ("I changed this"), rendered by the guest
	// overlay in a distinct style from the user's clip markers.
	agentMarkers?: AgentMarker[];
	// Called when the user navigates within the preview (link clicks,
	// back/forward) so the parent can keep its `path` in sync without
	// forcing a reload.
	onPathChange?: ( path: string ) => void;
	// True while the panel is toggled off but kept mounted (so the webview
	// stays warm). Disables the global browser shortcuts in that state.
	collapsed?: boolean;
	// True while the preview fills the whole window (sidebar and chat hidden).
	// Reflected on the toolbar's full-preview toggle button.
	fullscreen?: boolean;
	// Called when the user toggles full preview from the toolbar. The button
	// only renders when provided.
	onToggleFullscreen?: () => void;
	// Mirrors the preview's bounded console buffer to dashboard/session state so
	// agent turns can include recent browser console output.
	onConsoleEntriesChange?: ( entries: PreviewConsoleEntry[] ) => void;
}

type ConsoleFilter = 'all' | PreviewConsoleLevel;

// Simulated-width presets, pending a designed control: the WordPress editor's
// desktop/tablet/mobile trio, sized to an iPhone-class width, the classic
// tablet breakpoint, and a common laptop width.
const VIEWPORT_PRESETS = [
	{ id: 'mobile', width: 390 },
	{ id: 'tablet', width: 768 },
	{ id: 'desktop', width: 1440 },
] as const;

// Best-effort UA sniff: webview is only meaningful inside Electron. Outside
// (e.g. running apps/ui standalone in a regular browser) the tag is inert, so
// we render a plain iframe instead and skip the inspector.
const isElectron = (): boolean => {
	if ( typeof navigator === 'undefined' ) return false;
	return /\bElectron\//.test( navigator.userAgent );
};

function getInitialPreviewColorScheme(): PreviewColorScheme {
	if (
		typeof window !== 'undefined' &&
		typeof window.matchMedia === 'function' &&
		window.matchMedia( '(prefers-color-scheme: dark)' ).matches
	) {
		return 'dark';
	}
	return 'light';
}

/**
 * The viewport to simulate for a requested page width inside a pane of the
 * given size. Wider than the pane → the guest is scaled down to fit its
 * width, with the emulated height extended so the scaled page still fills
 * the pane vertically. Narrower → 1:1, letterboxed by the pane.
 */
export function getSimulatedViewport(
	requestedWidth: number | null,
	pane: { width: number; height: number } | null
): PreviewViewport | null {
	if ( requestedWidth === null || ! pane || pane.width <= 0 || pane.height <= 0 ) {
		return null;
	}
	const scale = Math.min( 1, pane.width / requestedWidth );
	return {
		width: requestedWidth,
		height: Math.max( 1, Math.round( pane.height / scale ) ),
		scale,
	};
}

// Where each realm segment lands before its per-realm memory has anything
// better: site root, WP Admin dashboard, and phpMyAdmin's WordPress database.
const DEFAULT_REALM_PATHS: Record< PreviewRealm, string > = {
	frontend: '/',
	admin: '/wp-admin/',
	database: DATABASE_HOME_PATH,
};

const SITE_THUMBNAIL_QUERY_KEY = [ 'site-preview-thumbnail' ] as const;
const DEFAULT_CONSOLE_HEIGHT = 280;
const MIN_CONSOLE_HEIGHT = 168;
const MAX_CONSOLE_HEIGHT = 560;
const MIN_BROWSER_HEIGHT_WHILE_RESIZING = 120;

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

function getBrowserShortcutCommand(
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

function ToolbarTooltip( {
	label,
	children,
}: {
	label: string;
	children: ReactElement< Record< string, unknown > >;
} ) {
	return (
		<Tooltip.Root>
			<Tooltip.Trigger render={ children } />
			<Tooltip.Popup positioner={ <Tooltip.Positioner side="bottom" /> }>{ label }</Tooltip.Popup>
		</Tooltip.Root>
	);
}

function PreviewColorSchemeSwitch( {
	colorScheme,
	disabled,
	onChange,
}: {
	colorScheme: PreviewColorScheme;
	disabled: boolean;
	onChange: () => void;
} ) {
	const label =
		colorScheme === 'dark' ? __( 'Preview in light mode' ) : __( 'Preview in dark mode' );

	return (
		<IconSwitch
			checked={ colorScheme === 'dark' }
			onChange={ onChange }
			label={ label }
			disabled={ disabled }
			startIcon={ sunIcon }
			endIcon={ moonIcon }
		/>
	);
}

// Temporary control for the viewport simulation while its real UI is being
// designed: a plain radio menu of simulated-width presets.
function PreviewViewportMenu( {
	value,
	disabled,
	onChange,
}: {
	value: number | null;
	disabled?: boolean;
	onChange: ( width: number | null ) => void;
} ) {
	const labels: Record< ( typeof VIEWPORT_PRESETS )[ number ][ 'id' ], string > = {
		mobile: __( 'Mobile' ),
		tablet: __( 'Tablet' ),
		desktop: __( 'Desktop' ),
	};
	return (
		<Menu.Root modal={ false }>
			<Menu.Trigger
				render={
					<IconButton
						variant="minimal"
						tone="neutral"
						size="small"
						icon={ aspectRatio }
						label={ __( 'Simulate viewport size' ) }
						aria-pressed={ value !== null }
						disabled={ disabled }
					/>
				}
			/>
			<Menu.Popup side="bottom" align="end">
				<Menu.RadioGroup
					value={ value === null ? 'fit' : String( value ) }
					onValueChange={ ( next ) => onChange( next === 'fit' ? null : Number( next ) ) }
				>
					<Menu.RadioItem value="fit">{ __( 'Fit pane' ) }</Menu.RadioItem>
					{ VIEWPORT_PRESETS.map( ( preset ) => (
						<Menu.RadioItem key={ preset.id } value={ String( preset.width ) }>
							{ sprintf(
								/* translators: 1: device name (e.g. Mobile), 2: viewport width in pixels */
								__( '%1$s · %2$dpx' ),
								labels[ preset.id ],
								preset.width
							) }
						</Menu.RadioItem>
					) ) }
				</Menu.RadioGroup>
			</Menu.Popup>
		</Menu.Root>
	);
}

// Trailing "•••" menu holding the occasional actions that don't earn a
// permanent toolbar button: console and open in browser. All clip actions
// live in the Clip split button.
function PreviewOverflowMenu( {
	canPreview,
	canUseWebview,
	consoleLabel,
	onToggleConsole,
	onOpenInBrowser,
}: {
	canPreview: boolean;
	canUseWebview: boolean;
	consoleLabel: string;
	onToggleConsole: () => void;
	onOpenInBrowser: () => void;
} ) {
	return (
		<Menu.Root modal={ false }>
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
				<QuickMenuItem
					icon={ bottomDrawerIcon }
					label={ consoleLabel }
					disabled={ ! canUseWebview }
					onClick={ onToggleConsole }
				/>
				<Menu.Separator />
				<QuickMenuItem
					icon={ external }
					label={ __( 'Open site in browser' ) }
					disabled={ ! canPreview }
					onClick={ onOpenInBrowser }
				/>
			</Menu.Popup>
		</Menu.Root>
	);
}

// The clip actions, as a split button (like "Open in…"): the main button
// re-runs whatever the user clipped last; the dropdown switches kinds. Each
// action is an explicit mode with its own gestures, so nothing fights the
// page — scrolling only zooms inside the loupe.
type PreviewClipAction = 'element' | 'region' | 'loupe' | 'page';

const CLIP_ACTION_STORAGE_KEY = 'studio:preview-clip-menu:last-used';

function isPreviewClipAction( value: string | null ): value is PreviewClipAction {
	return value === 'element' || value === 'region' || value === 'loupe' || value === 'page';
}

function getStoredClipAction(): PreviewClipAction {
	try {
		const stored = window.localStorage.getItem( CLIP_ACTION_STORAGE_KEY );
		return isPreviewClipAction( stored ) ? stored : 'element';
	} catch {
		return 'element';
	}
}

function PreviewClipMenu( {
	activeMode,
	onSetMode,
	onPageClip,
	pageClipBusy = false,
	clipCount = 0,
	onClearClips,
}: {
	activeMode: InspectorMode;
	onSetMode: ( mode: InspectorMode ) => void;
	onPageClip: () => void;
	// Page clips render in a headless browser and take seconds; the trigger
	// wears a spinner while one is in flight.
	pageClipBusy?: boolean;
	// Pending clips in the composer; enables "Clear clips".
	clipCount?: number;
	onClearClips?: () => void;
} ) {
	const [ lastUsed, setLastUsed ] = useState< PreviewClipAction >( getStoredClipAction );
	const rememberAction = ( action: PreviewClipAction ) => {
		setLastUsed( action );
		try {
			window.localStorage.setItem( CLIP_ACTION_STORAGE_KEY, action );
		} catch {
			// Storage failures only mean the trigger won't persist.
		}
	};
	const actions: { id: PreviewClipAction; icon: ReactElement; label: string }[] = [
		{ id: 'element', icon: pencil, label: __( 'Clip an element' ) },
		{ id: 'region', icon: crop, label: __( 'Clip a region' ) },
		{ id: 'loupe', icon: search, label: __( 'Zoom in and snap' ) },
		{ id: 'page', icon: capturePhoto, label: __( 'Clip the full page' ) },
	];
	const runAction = ( action: PreviewClipAction ) => {
		rememberAction( action );
		if ( action === 'page' ) {
			if ( ! pageClipBusy ) {
				onPageClip();
			}
			return;
		}
		onSetMode( activeMode === action ? 'off' : action );
	};
	const isActive = activeMode !== 'off';
	const lastUsedAction = actions.find( ( action ) => action.id === lastUsed ) ?? actions[ 0 ];

	return (
		<Menu.Root modal={ false }>
			<QuickMenuTrigger
				menuLabel={ __( 'Clip…' ) }
				actionLabel={
					pageClipBusy
						? __( 'Clipping the page…' )
						: isActive
						? __( 'Stop clipping' )
						: lastUsedAction.label
				}
				logo={ lastUsedAction.icon }
				busy={ pageClipBusy }
				onActionClick={ () => ( isActive ? onSetMode( 'off' ) : runAction( lastUsed ) ) }
			/>
			<QuickMenuPopup>
				{ actions.map( ( action ) => (
					<QuickMenuItem
						key={ action.id }
						icon={ action.icon }
						label={ action.label }
						disabled={ action.id === 'page' && pageClipBusy }
						onClick={ () => runAction( action.id ) }
					/>
				) ) }
				{ onClearClips ? (
					<>
						<Menu.Separator />
						<QuickMenuItem
							icon={ trash }
							label={ __( 'Clear clips' ) }
							destructive
							disabled={ clipCount === 0 }
							onClick={ onClearClips }
						/>
					</>
				) : null }
			</QuickMenuPopup>
		</Menu.Root>
	);
}

function getConsoleFilterLabel( filter: ConsoleFilter ) {
	switch ( filter ) {
		case 'all':
			return __( 'All' );
		case 'debug':
			return __( 'Debug' );
		case 'log':
			return __( 'Logs' );
		case 'info':
			return __( 'Info' );
		case 'warning':
			return __( 'Warnings' );
		case 'error':
			return __( 'Errors' );
	}
}

function getConsoleEntryLevelLabel( level: PreviewConsoleLevel ) {
	switch ( level ) {
		case 'debug':
			return __( 'Debug' );
		case 'log':
			return __( 'Log' );
		case 'info':
			return __( 'Info' );
		case 'warning':
			return __( 'Warning' );
		case 'error':
			return __( 'Error' );
	}
}

function isConsoleEntryVisible( entry: PreviewConsoleEntry, filter: ConsoleFilter ) {
	if ( filter === 'all' ) {
		return true;
	}
	if ( filter === 'log' ) {
		return entry.level === 'log' || entry.level === 'info' || entry.level === 'debug';
	}
	return entry.level === filter;
}

function formatConsoleEntryTime( timestamp: number ) {
	return new Date( timestamp ).toLocaleTimeString( [], {
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
	} );
}

function createConsoleTextFile( entries: PreviewConsoleEntry[] ): PreviewConsoleTextFile {
	const timestamp = new Date().toISOString().replace( /[:.]/g, '-' );
	const contents = formatPreviewConsoleEntriesForText( entries );
	return {
		name: `browser-console-${ timestamp }.txt`,
		contents,
		mimeType: 'text/plain',
		size: new Blob( [ contents ], { type: 'text/plain' } ).size,
	};
}

const CONSOLE_FILTERS: ConsoleFilter[] = [ 'all', 'error', 'warning', 'log' ];

function PreviewConsoleDrawer( {
	entries,
	filter,
	hasEntries,
	height,
	isAttaching,
	resizeHandleProps,
	onFilterChange,
	onClear,
	onCopy,
	onAttach,
	onClose,
}: {
	entries: PreviewConsoleEntry[];
	filter: ConsoleFilter;
	hasEntries: boolean;
	height: number;
	isAttaching: boolean;
	resizeHandleProps: Omit<
		ComponentProps< typeof ResizeHandle >,
		'className' | 'label' | 'orientation'
	>;
	onFilterChange: ( filter: ConsoleFilter ) => void;
	onClear: () => void;
	onCopy: () => void;
	onAttach?: () => void;
	onClose: () => void;
} ) {
	return (
		<section
			className={ styles.consoleDrawer }
			aria-label={ __( 'Console' ) }
			style={ { '--preview-console-height': `${ height }px` } as CSSProperties }
		>
			<ResizeHandle
				className={ styles.consoleResizeHandle }
				label={ __( 'Resize console' ) }
				orientation="horizontal"
				{ ...resizeHandleProps }
			/>
			<header className={ styles.consoleHeader }>
				<div className={ styles.consoleTitle }>
					<span className={ styles.consoleTitleIcon } aria-hidden="true">
						<Icon icon={ code } size={ 14 } />
					</span>
					<span>{ __( 'Console' ) }</span>
				</div>
				<div
					className={ styles.consoleFilters }
					role="group"
					aria-label={ __( 'Console filters' ) }
				>
					{ CONSOLE_FILTERS.map( ( option ) => (
						<button
							key={ option }
							type="button"
							className={ styles.consoleFilter }
							aria-pressed={ filter === option }
							onClick={ () => onFilterChange( option ) }
						>
							{ getConsoleFilterLabel( option ) }
						</button>
					) ) }
				</div>
				<div className={ styles.consoleActions }>
					<IconButton
						variant="minimal"
						tone="neutral"
						size="small"
						icon={ copy }
						label={ __( 'Copy visible console messages' ) }
						disabled={ entries.length === 0 }
						onClick={ onCopy }
					/>
					<IconButton
						variant="minimal"
						tone="neutral"
						size="small"
						icon={ fileIcon }
						label={ __( 'Attach visible console messages to composer' ) }
						loading={ isAttaching }
						loadingAnnouncement={ __( 'Attaching console messages' ) }
						disabled={ ! onAttach || entries.length === 0 || isAttaching }
						onClick={ onAttach }
					/>
					<IconButton
						variant="minimal"
						tone="neutral"
						size="small"
						icon={ trash }
						label={ __( 'Clear console' ) }
						disabled={ ! hasEntries }
						onClick={ onClear }
					/>
					<IconButton
						variant="minimal"
						tone="neutral"
						size="small"
						icon={ closeSmall }
						label={ __( 'Close console' ) }
						onClick={ onClose }
					/>
				</div>
			</header>
			<div className={ styles.consoleBody }>
				{ entries.length > 0 ? (
					<ol className={ styles.consoleEntries }>
						{ entries.map( ( entry ) => {
							const source = getPreviewConsoleSourceLabel( entry );
							return (
								<li key={ entry.id } className={ styles.consoleEntry } data-level={ entry.level }>
									<span className={ styles.consoleEntryMeta }>
										<span className={ styles.consoleEntryTime }>
											{ formatConsoleEntryTime( entry.timestamp ) }
										</span>
										<span className={ styles.consoleEntryLevel }>
											{ getConsoleEntryLevelLabel( entry.level ) }
										</span>
									</span>
									<span className={ styles.consoleEntryMessage }>{ entry.message }</span>
									{ source ? (
										<span className={ styles.consoleEntrySource }>{ source }</span>
									) : null }
								</li>
							);
						} ) }
					</ol>
				) : (
					<div className={ styles.consoleEmpty }>
						{ hasEntries
							? __( 'No messages match this filter.' )
							: __( 'No console messages yet.' ) }
					</div>
				) }
			</div>
		</section>
	);
}

export function SitePreview( {
	site,
	path,
	reloadNonce,
	onClip,
	onClipUpdate,
	onClipRemove,
	onComposerText,
	clipMarkers,
	agentMarkers,
	onPathChange,
	collapsed = false,
	fullscreen = false,
	onToggleFullscreen,
	onConsoleEntriesChange,
}: SitePreviewProps ) {
	const connector = useConnector();
	const startSite = useStartSite();
	const isStarting = useIsSiteStarting( site.id );
	// With the sidebar hidden the split frame goes full-bleed, so the toolbar
	// compensates for the lost frame gap (see .headerSidebarCollapsed).
	const sidebarCollapsed = useSidebarCollapsed();
	// Prototype: plugin sites get plugin-flavored copy in the stopped state.
	const pluginTag = usePluginSiteTag( site.id );
	const siteUrl = getSiteUrl( site );
	const canUseWebview = isElectron();
	const canPreview = site.running;
	const previewUrl = `${ siteUrl }${ getSafePath( path ) }`;
	const [ browserState, setBrowserState ] =
		useState< BrowserNavigationState >( EMPTY_BROWSER_STATE );
	const [ browserCommand, setBrowserCommand ] = useState< BrowserCommand | null >( null );
	const [ inspectorState, setInspectorState ] = useState< InspectorState >( EMPTY_INSPECTOR_STATE );
	const [ inspectorCommand, setInspectorCommand ] = useState< InspectorCommandRequest | null >(
		null
	);
	const [ pageClipRequest, setPageClipRequest ] = useState< PageClipRequest | null >( null );
	const [ isCapturingPageClip, setIsCapturingPageClip ] = useState( false );
	// Read by document-level key handlers without re-subscribing per change.
	const inspectorStateRef = useRef( inspectorState );
	useEffect( () => {
		inspectorStateRef.current = inspectorState;
	}, [ inspectorState ] );
	const [ previewColorScheme, setPreviewColorScheme ] = useState< PreviewColorScheme >(
		getInitialPreviewColorScheme
	);
	// Simulated page width in CSS px; null renders at the pane's natural size.
	const [ viewportWidth, setViewportWidth ] = useState< number | null >( null );
	const [ paneSize, setPaneSize ] = useState< { width: number; height: number } | null >( null );
	const [ consoleEntries, setConsoleEntries ] = useState< PreviewConsoleEntry[] >( [] );
	const [ consoleOpen, setConsoleOpen ] = useState( false );
	const [ consoleFilter, setConsoleFilter ] = useState< ConsoleFilter >( 'all' );
	const [ consoleHeight, setConsoleHeight ] = useState( DEFAULT_CONSOLE_HEIGHT );
	const [ isAttachingConsoleFile, setIsAttachingConsoleFile ] = useState( false );
	const rootRef = useRef< HTMLElement | null >( null );
	const bodyRef = useRef< HTMLDivElement | null >( null );
	const locationRef = useRef< HTMLDivElement | null >( null );
	const paneRef = useRef< HTMLDivElement | null >( null );
	const commandIdRef = useRef( 0 );
	const siteThumbnail = useQuery( {
		queryKey: [ ...SITE_THUMBNAIL_QUERY_KEY, site.id ],
		queryFn: () => connector.getSiteThumbnail( site.id ),
		enabled: ! canPreview,
		meta: { persist: false },
	} );
	// Page clips only need the webview (the capture goes through the
	// debugger, not the guest script); mode commands no-op until the
	// inspector script reports ready.
	const canPageClip = canPreview && canUseWebview && !! onClip;
	const progress = browserState.loading
		? Math.max( browserState.progress, 0.12 )
		: browserState.progress;
	const showLoadingProgress = canPreview && progress > 0;
	const visibleConsoleEntries = useMemo(
		() => consoleEntries.filter( ( entry ) => isConsoleEntryVisible( entry, consoleFilter ) ),
		[ consoleEntries, consoleFilter ]
	);
	const consoleButtonLabel = consoleOpen ? __( 'Hide console' ) : __( 'Show console' );

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
			const target = lastRealmPathsRef.current[ realm ];
			onPathChange?.( getRealmNavigationPath( target, siteUrl ) );
		},
		[ onPathChange, path, siteUrl ]
	);
	const handleBrowserStateChange = useCallback( ( state: BrowserNavigationState ) => {
		setBrowserState( ( current ) => ( areBrowserStatesEqual( current, state ) ? current : state ) );
	}, [] );
	const handleInspectorState = useCallback( ( state: InspectorState ) => {
		setInspectorState( state );
	}, [] );
	const handleConsoleEntry = useCallback( ( entry: PreviewConsoleEntry ) => {
		setConsoleEntries( ( current ) => [ ...current, entry ].slice( -MAX_PREVIEW_CONSOLE_ENTRIES ) );
	}, [] );
	const clearConsoleEntries = useCallback( () => {
		setConsoleEntries( [] );
	}, [] );
	const copyVisibleConsoleEntries = useCallback( () => {
		void connector
			.copyText( formatPreviewConsoleEntriesForText( visibleConsoleEntries ) )
			// The stable id collapses rapid re-copies into one toast.
			.then( () => toast.success( __( 'Copied' ), { id: 'copy-feedback' } ) )
			.catch( () => {
				// Clipboard failures are non-fatal; the console remains visible.
			} );
	}, [ connector, visibleConsoleEntries ] );
	// Preview state every clip carries: which realm/page it was made on and
	// how the preview was set up at the time. Restorable context for the
	// agent ("mobile viewport, dark mode, WP Admin").
	const buildClipInput = useCallback(
		( raw: RawClipCapture ): ComposerClipInput => {
			const names: Record< RawClipCapture[ 'grain' ], string > = {
				element: __( 'Element clip' ),
				region: __( 'Region clip' ),
				page: __( 'Page clip' ),
				console: __( 'Console clip' ),
			};
			return {
				grain: raw.grain,
				name: names[ raw.grain ],
				comment: raw.comment,
				target: raw.target,
				documentRect: raw.documentRect,
				coveredTag: raw.coveredTag,
				coveredSelector: raw.coveredSelector,
				zoom: raw.zoom,
				image: raw.image,
				context: {
					realm: getPreviewRealm( getSafePath( path ) ),
					url: raw.url,
					pathname: raw.pathname,
					viewportWidth,
					colorScheme: previewColorScheme,
				},
			};
		},
		[ path, previewColorScheme, viewportWidth ]
	);
	const handleClipCapture = useCallback(
		async ( raw: RawClipCapture ) => {
			await onClip?.( buildClipInput( raw ) );
		},
		[ buildClipInput, onClip ]
	);
	// Clips are composer attachments; clearing removes each one there, and
	// the marker sync takes the on-page markers with them.
	const clearClips = useCallback( () => {
		for ( const marker of clipMarkers ?? [] ) {
			onClipRemove?.( marker.id );
		}
	}, [ clipMarkers, onClipRemove ] );
	// The headless page-clip browser has no cookies; send admin/database
	// URLs through the site's auto-login endpoint so they don't capture the
	// login form.
	const resolvePageClipUrl = useCallback(
		( url: string ) => {
			const clipPath = getPathFromPreviewUrl( url, siteUrl );
			if ( ! clipPath ) {
				return url;
			}
			return `${ siteUrl }${ getRealmNavigationPath( clipPath, siteUrl ) }`;
		},
		[ siteUrl ]
	);
	const handleTextSelection = useCallback(
		( text: string, pathname: string ) => {
			if ( ! onComposerText ) {
				return;
			}
			const quoted = text
				.split( '\n' )
				.map( ( line ) => `> ${ line }` )
				.join( '\n' );
			onComposerText( pathname ? `${ quoted }\n\n(from ${ pathname })` : quoted );
		},
		[ onComposerText ]
	);
	const attachVisibleConsoleEntries = useCallback( async () => {
		if ( ! onClip || visibleConsoleEntries.length === 0 || isAttachingConsoleFile ) {
			return;
		}
		setIsAttachingConsoleFile( true );
		try {
			const file = createConsoleTextFile( visibleConsoleEntries );
			const filePath = await connector.createTemporaryTextFile( file.name, file.contents );
			await onClip( {
				...buildClipInput( { grain: 'console' } ),
				filePath,
				fileSize: file.size,
				entryCount: visibleConsoleEntries.length,
			} );
		} catch ( error ) {
			console.error( 'Failed to attach console messages:', error );
			toast.error( __( 'Console messages could not be attached.' ) );
		} finally {
			setIsAttachingConsoleFile( false );
		}
	}, [ buildClipInput, connector, isAttachingConsoleFile, onClip, visibleConsoleEntries ] );
	const getMaxConsoleHeight = useCallback( () => {
		const bodyHeight = bodyRef.current?.getBoundingClientRect().height;
		if ( ! bodyHeight ) {
			return MAX_CONSOLE_HEIGHT;
		}
		return Math.max(
			MIN_CONSOLE_HEIGHT,
			Math.min( MAX_CONSOLE_HEIGHT, bodyHeight - MIN_BROWSER_HEIGHT_WHILE_RESIZING )
		);
	}, [] );
	const clampConsoleHeight = useCallback(
		( next: number ) => Math.min( getMaxConsoleHeight(), Math.max( MIN_CONSOLE_HEIGHT, next ) ),
		[ getMaxConsoleHeight ]
	);
	const saveConsoleHeight = useCallback(
		( next: number ) => {
			const clampedHeight = clampConsoleHeight( next );
			setConsoleHeight( clampedHeight );
			return clampedHeight;
		},
		[ clampConsoleHeight ]
	);
	const {
		isDragging: isResizingConsole,
		onMouseDown: handleConsoleResizeStart,
		cancel: cancelConsoleResize,
	} = usePointerDrag( {
		axis: 'y',
		cursor: 'row-resize',
		onStart: () => consoleHeight,
		onMove: ( start, deltaY ) => {
			const nextHeight = clampConsoleHeight( start - deltaY );
			setConsoleHeight( nextHeight );
			return nextHeight;
		},
		onCommit: ( latest ) => {
			saveConsoleHeight( latest );
		},
	} );
	const handleConsoleResizeKeyDown = useCallback(
		( event: ReactKeyboardEvent< HTMLDivElement > ) => {
			if (
				event.key !== 'ArrowUp' &&
				event.key !== 'ArrowDown' &&
				event.key !== 'Home' &&
				event.key !== 'End'
			) {
				return;
			}
			event.preventDefault();
			if ( event.key === 'Home' ) {
				saveConsoleHeight( MIN_CONSOLE_HEIGHT );
				return;
			}
			if ( event.key === 'End' ) {
				saveConsoleHeight( getMaxConsoleHeight() );
				return;
			}
			saveConsoleHeight( consoleHeight + ( event.key === 'ArrowUp' ? 24 : -24 ) );
		},
		[ consoleHeight, getMaxConsoleHeight, saveConsoleHeight ]
	);
	const sendBrowserCommand = useCallback( ( type: BrowserCommand[ 'type' ] ) => {
		commandIdRef.current += 1;
		setBrowserCommand( { id: commandIdRef.current, type } );
	}, [] );
	const sendInspectorCommand = useCallback( ( command: InspectorHostCommand ) => {
		commandIdRef.current += 1;
		setInspectorCommand( { id: commandIdRef.current, command } );
	}, [] );
	const requestPageClip = useCallback( () => {
		if ( ! canPageClip || isCapturingPageClip ) {
			return;
		}
		commandIdRef.current += 1;
		setPageClipRequest( { id: commandIdRef.current } );
	}, [ canPageClip, isCapturingPageClip ] );
	const togglePreviewColorScheme = useCallback( () => {
		setPreviewColorScheme( ( current ) => ( current === 'dark' ? 'light' : 'dark' ) );
	}, [] );

	const browserShortcuts = useMemo(
		() => ( {
			back: getBrowserShortcutDescriptor( '[' ),
			forward: getBrowserShortcutDescriptor( ']' ),
			reload: getBrowserShortcutDescriptor( 'r' ),
		} ),
		[]
	);
	const refreshTooltipLabel = `${ __( 'Refresh' ) } ${ browserShortcuts.reload.displayShortcut }`;

	useEffect( () => {
		setBrowserState( EMPTY_BROWSER_STATE );
		setInspectorState( EMPTY_INSPECTOR_STATE );
		setConsoleEntries( [] );
		setConsoleOpen( false );
		setConsoleHeight( DEFAULT_CONSOLE_HEIGHT );
		setViewportWidth( null );
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

	const previewViewport = useMemo(
		() => getSimulatedViewport( viewportWidth, paneSize ),
		[ paneSize, viewportWidth ]
	);
	// A viewport narrower than the pane renders 1:1 as a letterboxed column;
	// wider ones keep the surface at pane size and let the emulation scale.
	const surfaceStyle: CSSProperties | undefined =
		previewViewport && previewViewport.scale === 1
			? { flex: '0 0 auto', width: previewViewport.width }
			: undefined;
	// The iframe fallback has no device emulation, so the wide case is a CSS
	// transform instead: lay out at full size, scale the box down to fit.
	const iframeStyle: CSSProperties | undefined =
		previewViewport && previewViewport.scale !== 1
			? {
					flex: '0 0 auto',
					width: previewViewport.width,
					height: previewViewport.height,
					transform: `scale(${ previewViewport.scale })`,
					transformOrigin: 'top left',
			  }
			: surfaceStyle;

	useEffect( () => {
		onConsoleEntriesChange?.( consoleEntries );
	}, [ consoleEntries, onConsoleEntriesChange ] );

	useEffect( () => {
		if ( ! consoleOpen ) {
			cancelConsoleResize();
		}
	}, [ cancelConsoleResize, consoleOpen ] );

	// Browser shortcuts (⌘R / ⌘[ / ⌘]) pressed while focus is in the host
	// document. Shortcuts pressed inside the guest page are forwarded by the
	// inspector script through the console bridge instead.
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

	// Escape pressed while focus is in the host document exits the active
	// clip mode (the guest handles Escape itself when focused).
	useEffect( () => {
		if ( ! canPreview || collapsed || ! canUseWebview ) {
			return;
		}
		const handleKeyDown = ( event: globalThis.KeyboardEvent ) => {
			if ( event.key !== 'Escape' || inspectorStateRef.current.mode === 'off' ) {
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
			sendInspectorCommand( { type: 'set-mode', mode: 'off' } );
		};
		document.addEventListener( 'keydown', handleKeyDown, { capture: true } );
		return () => document.removeEventListener( 'keydown', handleKeyDown, { capture: true } );
	}, [ canPreview, canUseWebview, collapsed, sendInspectorCommand ] );

	return (
		<aside
			ref={ rootRef }
			className={ clsx( styles.root, fullscreen && styles.rootFullscreen ) }
			aria-label={ __( 'Site preview' ) }
		>
			<div className={ clsx( styles.header, sidebarCollapsed && styles.headerSidebarCollapsed ) }>
				{ /* Equal-flex side tracks keep the address control truly centered
					in the toolbar regardless of what each side holds. */ }
				<div className={ styles.headerSide }>
					{ canPreview ? (
						<div className={ styles.browserControls } aria-label={ __( 'Browser navigation' ) }>
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
							<ToolbarTooltip label={ refreshTooltipLabel.trim() }>
								<Button
									variant="minimal"
									tone="neutral"
									size="small"
									className={ styles.refreshButton }
									aria-label={ __( 'Refresh' ) }
									aria-keyshortcuts={ browserShortcuts.reload.ariaKeyShortcut }
									onClick={ () => sendBrowserCommand( 'reload' ) }
								>
									<span className={ styles.refreshIcon } aria-hidden="true">
										{ refreshIcon }
									</span>
								</Button>
							</ToolbarTooltip>
						</div>
					) : null }
				</div>
				<div ref={ locationRef } className={ styles.browserLocation }>
					{ canPreview ? (
						<PreviewAddressBar
							site={ site }
							siteUrl={ siteUrl }
							path={ getSafePath( path ) }
							searchEnabled={ canUseWebview }
							anchorRef={ locationRef }
							onNavigate={ ( nextPath ) => onPathChange?.( nextPath ) }
							onSwitchRealm={ handleSwitchRealm }
						/>
					) : null }
				</div>
				<div className={ clsx( styles.headerSide, styles.headerSideEnd ) }>
					{ canPreview ? (
						<>
							{ connector.capabilities.annotatePreview && onClip && canUseWebview ? (
								<>
									<PreviewClipMenu
										activeMode={ inspectorState.mode }
										onSetMode={ ( nextMode ) =>
											sendInspectorCommand( { type: 'set-mode', mode: nextMode } )
										}
										onPageClip={ requestPageClip }
										pageClipBusy={ isCapturingPageClip }
										clipCount={ clipMarkers?.length ?? 0 }
										onClearClips={ onClipRemove ? clearClips : undefined }
									/>
									<span className={ styles.separator } aria-hidden="true" />
								</>
							) : null }
							<PreviewViewportMenu value={ viewportWidth } onChange={ setViewportWidth } />
							<PreviewColorSchemeSwitch
								colorScheme={ previewColorScheme }
								disabled={ ! canUseWebview }
								onChange={ togglePreviewColorScheme }
							/>
							{ onToggleFullscreen ? (
								<IconButton
									variant="minimal"
									tone="neutral"
									size="small"
									icon={ fullscreenIcon }
									label={ fullscreen ? __( 'Exit full preview' ) : __( 'Full preview' ) }
									aria-pressed={ fullscreen }
									onClick={ onToggleFullscreen }
								/>
							) : null }
						</>
					) : null }
					<PreviewOverflowMenu
						canPreview={ canPreview }
						canUseWebview={ canUseWebview }
						consoleLabel={ consoleButtonLabel }
						onToggleConsole={ () => setConsoleOpen( ( current ) => ! current ) }
						onOpenInBrowser={ () => void connector.openExternalUrl( previewUrl ) }
					/>
				</div>
				{ showLoadingProgress ? (
					<div className={ styles.loadingProgress } aria-hidden="true">
						<span style={ { transform: `scaleX(${ Math.min( progress, 1 ) })` } } />
					</div>
				) : null }
			</div>
			<div ref={ bodyRef } className={ styles.body }>
				<div
					ref={ paneRef }
					className={ clsx(
						styles.previewViewport,
						previewViewport && styles.previewViewportSimulated
					) }
				>
					{ canPreview ? (
						canUseWebview ? (
							<WebviewSurface
								key={ site.id }
								url={ previewUrl }
								reloadNonce={ reloadNonce }
								onInspectorState={ handleInspectorState }
								inspectorCommand={ inspectorCommand }
								browserCommand={ browserCommand }
								onBrowserStateChange={ handleBrowserStateChange }
								onBrowserCommand={ sendBrowserCommand }
								onNavigate={ handlePreviewNavigation }
								colorScheme={ previewColorScheme }
								viewport={ previewViewport }
								surfaceStyle={ surfaceStyle }
								onConsoleEntry={ handleConsoleEntry }
								clipMarkers={ clipMarkers }
								agentMarkers={ agentMarkers }
								pageClipRequest={ pageClipRequest }
								resolvePageClipUrl={ resolvePageClipUrl }
								onPageClipBusyChange={ setIsCapturingPageClip }
								onClipCapture={ onClip ? handleClipCapture : undefined }
								onClipUpdate={ onClipUpdate }
								onClipRemove={ onClipRemove }
								onTextSelection={ onComposerText ? handleTextSelection : undefined }
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
						)
					) : (
						<div className={ styles.empty }>
							<div className={ styles.emptyGrid } aria-hidden="true">
								<DotGrid spacing={ 32 } crossSize={ 5 } crossThickness={ 0.75 } opacity={ 0.16 } />
							</div>
							<div className={ styles.emptyContent }>
								{ siteThumbnail.data ? (
									<div className={ styles.emptyThumbnail }>
										<img
											src={ siteThumbnail.data }
											alt={ sprintf( __( 'Screenshot of %s' ), site.name ) }
										/>
									</div>
								) : null }
								<p className={ styles.emptyText }>
									{ pluginTag
										? __( 'Start the plugin to see a live preview.' )
										: __( 'Start the site to see a live preview.' ) }
								</p>
								<Button
									variant="solid"
									tone="brand"
									className={ styles.startButton }
									loading={ isStarting }
									loadingAnnouncement={
										pluginTag ? __( 'Starting plugin' ) : __( 'Starting site' )
									}
									onClick={ () => startSite.mutate( site.id ) }
								>
									<span className={ styles.startIcon } aria-hidden="true">
										{ playIcon }
									</span>
									{ pluginTag ? __( 'Start plugin' ) : __( 'Start site' ) }
								</Button>
							</div>
						</div>
					) }
				</div>
				{ canPreview && consoleOpen ? (
					<PreviewConsoleDrawer
						entries={ visibleConsoleEntries }
						filter={ consoleFilter }
						hasEntries={ consoleEntries.length > 0 }
						height={ consoleHeight }
						isAttaching={ isAttachingConsoleFile }
						resizeHandleProps={ {
							minWidth: MIN_CONSOLE_HEIGHT,
							maxWidth: MAX_CONSOLE_HEIGHT,
							width: Math.min( MAX_CONSOLE_HEIGHT, consoleHeight ),
							isResizing: isResizingConsole,
							onResizeStart: handleConsoleResizeStart,
							onKeyDown: handleConsoleResizeKeyDown,
						} }
						onFilterChange={ setConsoleFilter }
						onClear={ clearConsoleEntries }
						onCopy={ copyVisibleConsoleEntries }
						onAttach={ onClip ? () => void attachVisibleConsoleEntries() : undefined }
						onClose={ () => setConsoleOpen( false ) }
					/>
				) : null }
				{ isResizingConsole ? <ResizeOverlay orientation="horizontal" /> : null }
			</div>
		</aside>
	);
}

function getSafePath( path: unknown ) {
	return typeof path === 'string' && path.trim() ? path : '/';
}
