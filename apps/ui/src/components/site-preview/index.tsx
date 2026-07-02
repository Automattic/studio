import { useQuery } from '@tanstack/react-query';
import { __, sprintf } from '@wordpress/i18n';
import {
	capturePhoto,
	chevronLeft,
	chevronRight,
	closeSmall,
	code,
	copy,
	external,
	file as fileIcon,
	globe,
	pencil,
	trash,
	wordpress,
} from '@wordpress/icons';
import { ariaKeyShortcut, displayShortcut, isKeyboardEvent } from '@wordpress/keycodes';
import { Button, Icon, IconButton, Tooltip } from '@wordpress/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DotGrid } from '@/components/dot-grid';
import { IconSwitch } from '@/components/icon-switch';
import { ResizeHandle, ResizeOverlay } from '@/components/resize-handle';
import { useConnector } from '@/data/core';
import { useIsSiteStarting, useStartSite } from '@/data/queries/use-sites';
import { usePointerDrag } from '@/hooks/use-pointer-drag';
import { getSiteUrl } from '@/lib/get-site-url';
import { bottomDrawerIcon, moonIcon, playIcon, refreshIcon, sunIcon } from '@/lib/icons';
import { usePluginSiteTag } from '@/lib/plugin-prototype';
import {
	formatPreviewConsoleEntriesForText,
	getPreviewConsoleLevelFromWebviewLevel,
	getPreviewConsoleSourceLabel,
	MAX_PREVIEW_CONSOLE_ENTRIES,
} from './console-utils';
import {
	INSPECTOR_BRIDGE_PREFIX,
	INSPECTOR_COMMAND_EVENT,
	INSPECTOR_PAGE_SCRIPT,
} from './inspector-script';
import styles from './style.module.css';
import type {
	Annotation,
	PreviewConsoleEntry,
	PreviewConsoleLevel,
	PreviewConsoleTextFile,
} from './types';
import type { LocalMediaFile, SiteDetails } from '@/data/core';
import type {
	CSSProperties,
	ComponentProps,
	KeyboardEvent as ReactKeyboardEvent,
	ReactElement,
} from 'react';

export type { Annotation, PreviewConsoleEntry, PreviewConsoleTextFile } from './types';

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
	// Called when the user captures the preview as an image to attach to the
	// composer for the active session.
	onScreenshotDone?: ( file: File ) => void | Promise< void >;
	// Called when the user exports console messages as a text file to attach to
	// the composer for the active session.
	onConsoleFileDone?: ( file: PreviewConsoleTextFile ) => void | Promise< void >;
	// Called when the user navigates within the preview (link clicks,
	// back/forward) so the parent can keep its `path` in sync without
	// forcing a reload.
	onPathChange?: ( path: string ) => void;
	// True while the panel is toggled off but kept mounted (so the webview
	// stays warm). Disables the global browser shortcuts in that state.
	collapsed?: boolean;
	// Mirrors the preview's bounded console buffer to dashboard/session state so
	// agent turns can include recent browser console output.
	onConsoleEntriesChange?: ( entries: PreviewConsoleEntry[] ) => void;
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

type PreviewColorScheme = 'light' | 'dark';
type ConsoleFilter = 'all' | PreviewConsoleLevel;

interface PreviewWindow extends Window {
	ipcApi?: {
		setWebviewColorScheme?: (
			webContentsId: number,
			colorScheme: PreviewColorScheme
		) => Promise< void >;
	};
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
	sourceId?: string;
	line?: number;
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

function localMediaFileToFile( file: LocalMediaFile ): File {
	return new File( [ file.data ], file.name, { type: file.mimeType } );
}

function getWebviewContentsId( webview: WebviewTag ): number {
	const webContentsId = webview.getWebContentsId?.();
	if ( ! webContentsId ) {
		throw new Error( 'Preview webview is not ready.' );
	}
	return webContentsId;
}

async function applyWebviewColorScheme(
	webview: WebviewTag,
	colorScheme: PreviewColorScheme
): Promise< void > {
	const { ipcApi } = window as PreviewWindow;
	await ipcApi?.setWebviewColorScheme?.( getWebviewContentsId( webview ), colorScheme );
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
const DEFAULT_CONSOLE_HEIGHT = 280;
const MIN_CONSOLE_HEIGHT = 168;
const MAX_CONSOLE_HEIGHT = 560;
const MIN_BROWSER_HEIGHT_WHILE_RESIZING = 120;

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

function isBrowserShortcutCommand( command: unknown ): command is BrowserShortcutCommandType {
	return command === 'back' || command === 'forward' || command === 'reload';
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

// Front end / WP Admin switch: globe on the left, WordPress mark on the
// right, thumb under the active side.
function PreviewViewSwitch( {
	isBackend,
	disabled,
	onChange,
}: {
	isBackend: boolean;
	disabled?: boolean;
	onChange: () => void;
} ) {
	return (
		<IconSwitch
			checked={ isBackend }
			onChange={ onChange }
			label={ isBackend ? __( 'View site front end' ) : __( 'View WP Admin' ) }
			disabled={ disabled }
			startIcon={ <Icon icon={ globe } size={ 14 } /> }
			endIcon={ <Icon icon={ wordpress } size={ 14 } /> }
		/>
	);
}

function getPreviewWebviewContentsId( root: HTMLElement | null ): number {
	const webview = root?.querySelector( 'webview' ) as WebviewTag | null;
	if ( ! webview ) {
		throw new Error( 'Preview webview is not ready.' );
	}
	return getWebviewContentsId( webview );
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
	onAnnotationsDone,
	onScreenshotDone,
	onConsoleFileDone,
	onPathChange,
	collapsed = false,
	onConsoleEntriesChange,
}: SitePreviewProps ) {
	const connector = useConnector();
	const startSite = useStartSite();
	const isStarting = useIsSiteStarting( site.id );
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
	const [ inspectorCommand, setInspectorCommand ] = useState< InspectorCommand | null >( null );
	const [ previewColorScheme, setPreviewColorScheme ] = useState< PreviewColorScheme >(
		getInitialPreviewColorScheme
	);
	const [ consoleEntries, setConsoleEntries ] = useState< PreviewConsoleEntry[] >( [] );
	const [ consoleOpen, setConsoleOpen ] = useState( false );
	const [ consoleFilter, setConsoleFilter ] = useState< ConsoleFilter >( 'all' );
	const [ consoleHeight, setConsoleHeight ] = useState( DEFAULT_CONSOLE_HEIGHT );
	const [ isAttachingConsoleFile, setIsAttachingConsoleFile ] = useState( false );
	const [ isCapturingScreenshot, setIsCapturingScreenshot ] = useState( false );
	const [ consoleActionError, setConsoleActionError ] = useState< string | null >( null );
	const rootRef = useRef< HTMLElement | null >( null );
	const bodyRef = useRef< HTMLDivElement | null >( null );
	const commandIdRef = useRef( 0 );
	const siteThumbnail = useQuery( {
		queryKey: [ ...SITE_THUMBNAIL_QUERY_KEY, site.id ],
		queryFn: () => connector.getSiteThumbnail( site.id ),
		enabled: ! canPreview,
		meta: { persist: false },
	} );
	const canAnnotate = canPreview && inspectorState.ready;
	const canCaptureScreenshot = canPreview && canUseWebview && !! onScreenshotDone;
	const pageTitle = getToolbarPageTitle( browserState.title, site.name );
	const progress = browserState.loading
		? Math.max( browserState.progress, 0.12 )
		: browserState.progress;
	const showLoadingProgress = canPreview && progress > 0;
	const [ screenshotError, setScreenshotError ] = useState< string | null >( null );
	const visibleConsoleEntries = useMemo(
		() => consoleEntries.filter( ( entry ) => isConsoleEntryVisible( entry, consoleFilter ) ),
		[ consoleEntries, consoleFilter ]
	);
	const consoleButtonLabel = consoleOpen ? __( 'Hide console' ) : __( 'Show console' );
	const toolbarError = screenshotError ?? consoleActionError;

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
	// Front end / backend toggle. Each side remembers where you last were:
	// toggling to WP Admin and back returns to the exact front-end page, and
	// vice versa. The backend side goes through the site's /studio-auto-login
	// endpoint so it never lands on the login form.
	const isBackendView = isBackendPreviewPath( getSafePath( path ) );
	const lastFrontendPathRef = useRef( '/' );
	const lastBackendPathRef = useRef( '/wp-admin/' );
	useEffect( () => {
		// Reset the per-side memory when the preview moves to another site.
		lastFrontendPathRef.current = '/';
		lastBackendPathRef.current = '/wp-admin/';
	}, [ site.id ] );
	useEffect( () => {
		const safePath = getSafePath( path );
		// Auto-login is a transient hop, not a place to return to.
		if ( safePath.startsWith( '/studio-auto-login' ) ) {
			return;
		}
		if ( isBackendPreviewPath( safePath ) ) {
			lastBackendPathRef.current = safePath;
		} else {
			lastFrontendPathRef.current = safePath;
		}
	}, [ path ] );
	const showFrontend = useCallback(
		() => onPathChange?.( lastFrontendPathRef.current ),
		[ onPathChange ]
	);
	const showBackend = useCallback( () => {
		const target = lastBackendPathRef.current;
		try {
			const redirectTo = new URL( target, siteUrl ).toString();
			onPathChange?.( `/studio-auto-login?redirect_to=${ encodeURIComponent( redirectTo ) }` );
		} catch {
			onPathChange?.( target );
		}
	}, [ onPathChange, siteUrl ] );
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
			.catch( () => {
				// Clipboard failures are non-fatal; the console remains visible.
			} );
	}, [ connector, visibleConsoleEntries ] );
	const attachVisibleConsoleEntries = useCallback( async () => {
		if ( ! onConsoleFileDone || visibleConsoleEntries.length === 0 || isAttachingConsoleFile ) {
			return;
		}
		setIsAttachingConsoleFile( true );
		setConsoleActionError( null );
		try {
			await onConsoleFileDone( createConsoleTextFile( visibleConsoleEntries ) );
		} catch ( error ) {
			console.error( 'Failed to attach console messages:', error );
			setConsoleActionError( __( 'Console messages could not be attached.' ) );
		} finally {
			setIsAttachingConsoleFile( false );
		}
	}, [ isAttachingConsoleFile, onConsoleFileDone, visibleConsoleEntries ] );
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
	const sendInspectorCommand = useCallback( ( type: InspectorCommand[ 'type' ] ) => {
		commandIdRef.current += 1;
		setInspectorCommand( { id: commandIdRef.current, type } );
	}, [] );
	const capturePreviewScreenshot = useCallback( async () => {
		if ( ! canCaptureScreenshot || isCapturingScreenshot ) {
			return;
		}
		setIsCapturingScreenshot( true );
		setScreenshotError( null );
		try {
			const screenshot = await connector.captureSiteScreenshot(
				getPreviewWebviewContentsId( rootRef.current ),
				{
					colorScheme: previewColorScheme,
				}
			);
			await onScreenshotDone?.( localMediaFileToFile( screenshot ) );
		} catch ( error ) {
			console.error( 'Failed to add preview screenshot:', error );
			setScreenshotError( __( 'Screenshot could not be added.' ) );
		} finally {
			setIsCapturingScreenshot( false );
		}
	}, [
		canCaptureScreenshot,
		connector,
		isCapturingScreenshot,
		onScreenshotDone,
		previewColorScheme,
	] );
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
		setConsoleActionError( null );
	}, [ site.id ] );

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
			if ( ! command ) {
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
			sendBrowserCommand( command );
		};

		document.addEventListener( 'keydown', handleKeyDown, { capture: true } );
		return () => document.removeEventListener( 'keydown', handleKeyDown, { capture: true } );
	}, [ canPreview, collapsed, sendBrowserCommand ] );

	return (
		<aside ref={ rootRef } className={ styles.root } aria-label={ __( 'Site preview' ) }>
			<div className={ styles.header }>
				{ canPreview ? (
					<>
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
						<div className={ styles.viewToggle }>
							<PreviewViewSwitch
								isBackend={ isBackendView }
								onChange={ isBackendView ? showFrontend : showBackend }
							/>
						</div>
						<div className={ styles.browserLocation }>
							{ toolbarError ? (
								<span className={ styles.toolbarError } role="status">
									{ toolbarError }
								</span>
							) : (
								<ToolbarTooltip label={ previewUrl }>
									<span className={ styles.browserTitle }>{ pageTitle }</span>
								</ToolbarTooltip>
							) }
						</div>
						<div className={ styles.annotationControls }>
							{ onScreenshotDone ? (
								<IconButton
									variant="minimal"
									tone="neutral"
									size="small"
									icon={ capturePhoto }
									label={
										isCapturingScreenshot
											? __( 'Adding screenshot...' )
											: __( 'Add full-page screenshot to composer' )
									}
									loading={ isCapturingScreenshot }
									loadingAnnouncement={ __( 'Adding screenshot' ) }
									disabled={ ! canCaptureScreenshot || isCapturingScreenshot }
									onClick={ () => void capturePreviewScreenshot() }
								/>
							) : null }
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
					</>
				) : (
					<span className={ styles.headerSpacer } aria-hidden="true" />
				) }
				<span className={ styles.separator } aria-hidden="true" />
				<IconButton
					variant="minimal"
					tone="neutral"
					size="small"
					icon={ bottomDrawerIcon }
					label={ consoleButtonLabel }
					className={ styles.consoleToggle }
					disabled={ ! canUseWebview }
					aria-pressed={ consoleOpen }
					onClick={ () => setConsoleOpen( ( current ) => ! current ) }
				/>
				<IconButton
					variant="minimal"
					tone="neutral"
					size="small"
					icon={ external }
					label={ __( 'Open site in browser' ) }
					disabled={ ! canPreview }
					onClick={ () => void connector.openExternalUrl( previewUrl ) }
				/>
				{ canPreview ? (
					<PreviewColorSchemeSwitch
						colorScheme={ previewColorScheme }
						disabled={ ! canUseWebview }
						onChange={ togglePreviewColorScheme }
					/>
				) : null }
				{ showLoadingProgress ? (
					<div className={ styles.loadingProgress } aria-hidden="true">
						<span style={ { transform: `scaleX(${ Math.min( progress, 1 ) })` } } />
					</div>
				) : null }
			</div>
			<div ref={ bodyRef } className={ styles.body }>
				<div className={ styles.previewViewport }>
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
								colorScheme={ previewColorScheme }
								onConsoleEntry={ handleConsoleEntry }
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
						onAttach={ onConsoleFileDone ? () => void attachVisibleConsoleEntries() : undefined }
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

/**
 * Whether a preview path shows the WordPress backend — either a wp-admin
 * screen directly, or the auto-login endpoint on its way to one.
 */
export function isBackendPreviewPath( path: string ): boolean {
	if ( path.startsWith( '/wp-admin' ) ) {
		return true;
	}
	if ( path.startsWith( '/studio-auto-login' ) ) {
		const query = path.split( '?' )[ 1 ] ?? '';
		const redirectTo = new URLSearchParams( query ).get( 'redirect_to' ) ?? '';
		return redirectTo.includes( '/wp-admin' );
	}
	return false;
}

export function getToolbarPageTitle( title: string | null, siteName: string ) {
	const trimmedTitle = normalizeDocumentTitle( title );
	if ( trimmedTitle ) {
		const [ wordPressAdminTitle ] = trimmedTitle.split( /\s+‹\s+/ );
		const withoutWordPressSuffix = wordPressAdminTitle
			.replace( /\s+[–—-]\s+WordPress$/i, '' )
			.trim();
		return withoutWordPressSuffix || trimmedTitle;
	}
	return siteName || __( 'Site preview' );
}

export function getPathFromPreviewUrl( url: string, baseUrl: string ) {
	try {
		const parsedUrl = new URL( url );
		const parsedBaseUrl = new URL( baseUrl );
		if ( parsedUrl.origin !== parsedBaseUrl.origin ) {
			return null;
		}
		return `${ parsedUrl.pathname }${ parsedUrl.search }${ parsedUrl.hash }`;
	} catch {
		return null;
	}
}

interface WebviewSurfaceProps {
	url: string;
	reloadNonce: number;
	onAnnotationsDone?: ( annotations: Annotation[] ) => void;
	onInspectorState?: ( state: InspectorState ) => void;
	onConsoleEntry?: ( entry: PreviewConsoleEntry ) => void;
	inspectorCommand?: InspectorCommand | null;
	browserCommand?: BrowserCommand | null;
	onBrowserStateChange?: ( state: BrowserNavigationState ) => void;
	onBrowserCommand?: ( type: BrowserShortcutCommandType ) => void;
	onNavigate?: ( url: string ) => void;
	colorScheme: PreviewColorScheme;
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
	onConsoleEntry,
	inspectorCommand,
	browserCommand,
	onBrowserStateChange,
	onBrowserCommand,
	onNavigate,
	colorScheme,
}: WebviewSurfaceProps ) {
	const ref = useRef< HTMLElement | null >( null );
	const [ ready, setReady ] = useState( false );
	const onAnnotationsDoneRef = useRef( onAnnotationsDone );
	const onInspectorStateRef = useRef( onInspectorState );
	const onConsoleEntryRef = useRef( onConsoleEntry );
	const onBrowserStateChangeRef = useRef( onBrowserStateChange );
	const onBrowserCommandRef = useRef( onBrowserCommand );
	const onNavigateRef = useRef( onNavigate );
	const browserStateRef = useRef< BrowserNavigationState >( EMPTY_BROWSER_STATE );
	const domReadyRef = useRef( false );
	const currentUrlRef = useRef( url );
	const lastReloadNonceRef = useRef( reloadNonce );
	const consoleEntryIdRef = useRef( 0 );
	const progressTimerRef = useRef< ReturnType< typeof setInterval > | null >( null );
	const progressResetTimerRef = useRef< ReturnType< typeof setTimeout > | null >( null );
	useEffect( () => {
		onAnnotationsDoneRef.current = onAnnotationsDone;
	}, [ onAnnotationsDone ] );
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
		if ( ! ready ) return;
		const webview = ref.current as WebviewTag | null;
		if ( ! webview ) return;
		void applyWebviewColorScheme( webview, colorScheme ).catch( () => undefined );
	}, [ colorScheme, ready ] );

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
			if ( ! consoleEvent.message.startsWith( INSPECTOR_BRIDGE_PREFIX ) ) {
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
