import { __ } from '@wordpress/i18n';
import { chevronLeft, chevronRight } from '@wordpress/icons';
import { Button, IconButton, Tooltip } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ResizeHandle, ResizeOverlay } from '@/components/resize-handle';
import { useIsSiteStarting, useStartSite } from '@/data/queries/use-sites';
import { useResizablePanel } from '@/hooks/use-resizable-panel';
import { getSiteUrl } from '@/lib/get-site-url';
import { playIcon, refreshIcon } from '@/lib/icons';
import { getPrimaryModifierLabel, isApplePlatform } from '@/lib/keyboard-shortcuts';
import { getNavigatorPlatform } from '@/lib/platform';
import { PREVIEW_PANEL_CONFIG, PREVIEW_PANEL_STORAGE_KEY } from '@/lib/resizable-panels';
import {
	INSPECTOR_BRIDGE_PREFIX,
	INSPECTOR_COMMAND_EVENT,
	INSPECTOR_PAGE_SCRIPT,
} from './inspector-script';
import styles from './style.module.css';
import type { Annotation } from './types';
import type { SiteDetails } from '@/data/core';
import type { CSSProperties, ReactElement } from 'react';

export type { Annotation } from './types';

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
	// When true the panel stays mounted but animates its width to zero, so the
	// open/close toggle is a transition rather than a mount/unmount.
	collapsed?: boolean;
	layoutWidth?: number;
	hideResizeHandle?: boolean;
	onPathChange?: ( path: string ) => void;
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
	hasAdminBar: boolean;
	adminBarBackgroundColor: string | null;
	adminBarForegroundColor: string | null;
}

type BrowserShortcutCommandType = 'back' | 'forward' | 'reload';
type BrowserCommandType = BrowserShortcutCommandType | 'stop';

interface BrowserCommand {
	id: number;
	type: BrowserCommandType;
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
	stop?(): void;
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

const EMPTY_INSPECTOR_STATE: InspectorState = {
	ready: false,
	isPicking: false,
	annotationCount: 0,
};

const EMPTY_BROWSER_STATE: BrowserNavigationState = {
	canGoBack: false,
	canGoForward: false,
	loading: false,
	progress: 0,
	title: null,
	hasAdminBar: false,
	adminBarBackgroundColor: null,
	adminBarForegroundColor: null,
};

const EMPTY_ADMIN_BAR_BROWSER_STATE = {
	hasAdminBar: false,
	adminBarBackgroundColor: null,
	adminBarForegroundColor: null,
} satisfies Pick<
	BrowserNavigationState,
	'hasAdminBar' | 'adminBarBackgroundColor' | 'adminBarForegroundColor'
>;

const ADMIN_BAR_STYLE_SCRIPT = `(() => {
	const adminBar = document.getElementById( 'wpadminbar' );
	if ( ! adminBar ) {
		return { hasAdminBar: false, backgroundColor: null, foregroundColor: null };
	}
	const isVisibleColor = ( color ) => {
		if ( ! color ) {
			return false;
		}
		const normalized = color.replace( /\\s+/g, '' ).toLowerCase();
		if ( normalized === 'transparent' ) {
			return false;
		}
		const rgba = normalized.match( /^rgba\\([^,]+,[^,]+,[^,]+,([^)]+)\\)$/ );
		if ( rgba ) {
			return Number.parseFloat( rgba[ 1 ] ) > 0;
		}
		const rgbAlpha = normalized.match( /^rgb\\([^/]+\\/([^)]+)\\)$/ );
		if ( rgbAlpha ) {
			const alpha = rgbAlpha[ 1 ].endsWith( '%' )
				? Number.parseFloat( rgbAlpha[ 1 ] ) / 100
				: Number.parseFloat( rgbAlpha[ 1 ] );
			return alpha > 0;
		}
		return true;
	};
	const getPaintedBackgroundColor = () => {
		const rect = adminBar.getBoundingClientRect();
		const y = Math.min( Math.max( rect.top + rect.height / 2, 0 ), window.innerHeight - 1 );
		const sampleXs = [
			rect.left + 4,
			rect.left + rect.width / 4,
			rect.left + rect.width / 2,
			rect.right - 4,
		].filter( ( x ) => x >= 0 && x < window.innerWidth );
		for ( const x of sampleXs ) {
			let element = document.elementFromPoint( x, y );
			while ( element ) {
				const color = window.getComputedStyle( element ).backgroundColor;
				if ( isVisibleColor( color ) ) {
					return color;
				}
				if ( element === adminBar ) {
					break;
				}
				element = element.parentElement;
			}
		}
		for ( const element of [ adminBar, ...adminBar.querySelectorAll( '*' ) ] ) {
			const color = window.getComputedStyle( element ).backgroundColor;
			if ( isVisibleColor( color ) ) {
				return color;
			}
		}
		return null;
	};
	const style = window.getComputedStyle( adminBar );
	return {
		hasAdminBar: true,
		backgroundColor: getPaintedBackgroundColor(),
		foregroundColor: style.color || null,
	};
})()`;

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

function getAdminBarBrowserState( value: unknown ) {
	if ( ! value || typeof value !== 'object' ) {
		return EMPTY_ADMIN_BAR_BROWSER_STATE;
	}
	const candidate = value as {
		hasAdminBar?: unknown;
		backgroundColor?: unknown;
		foregroundColor?: unknown;
	};
	if ( ! candidate.hasAdminBar ) {
		return EMPTY_ADMIN_BAR_BROWSER_STATE;
	}
	return {
		hasAdminBar: true,
		adminBarBackgroundColor: normalizeCssColor( candidate.backgroundColor ),
		adminBarForegroundColor: normalizeCssColor( candidate.foregroundColor ),
	};
}

function getIframeAdminBarBrowserState( iframe: HTMLIFrameElement ) {
	try {
		const adminBar = iframe.contentDocument?.getElementById( 'wpadminbar' );
		if ( ! adminBar ) {
			return EMPTY_ADMIN_BAR_BROWSER_STATE;
		}
		const window = iframe.contentWindow;
		const style = window?.getComputedStyle( adminBar );
		return {
			hasAdminBar: true,
			adminBarBackgroundColor: getIframePaintedAdminBarBackground( iframe, adminBar ),
			adminBarForegroundColor: normalizeCssColor( style?.color ),
		};
	} catch {
		return EMPTY_ADMIN_BAR_BROWSER_STATE;
	}
}

function getIframeTitle( iframe: HTMLIFrameElement ) {
	try {
		return normalizeDocumentTitle( iframe.contentDocument?.title );
	} catch {
		return null;
	}
}

function getIframePaintedAdminBarBackground( iframe: HTMLIFrameElement, adminBar: HTMLElement ) {
	const window = iframe.contentWindow;
	const document = iframe.contentDocument;
	if ( ! window || ! document ) {
		return null;
	}
	const rect = adminBar.getBoundingClientRect();
	const y = Math.min( Math.max( rect.top + rect.height / 2, 0 ), window.innerHeight - 1 );
	const sampleXs = [
		rect.left + 4,
		rect.left + rect.width / 4,
		rect.left + rect.width / 2,
		rect.right - 4,
	].filter( ( x ) => x >= 0 && x < window.innerWidth );
	for ( const x of sampleXs ) {
		let element = document.elementFromPoint( x, y );
		while ( element ) {
			const color = window.getComputedStyle( element ).backgroundColor;
			if ( isVisibleCssColor( color ) ) {
				return color;
			}
			if ( element === adminBar ) {
				break;
			}
			element = element.parentElement;
		}
	}
	for ( const element of [ adminBar, ...adminBar.querySelectorAll( '*' ) ] ) {
		const color = window.getComputedStyle( element ).backgroundColor;
		if ( isVisibleCssColor( color ) ) {
			return color;
		}
	}
	return null;
}

function normalizeCssColor( value: unknown ) {
	return typeof value === 'string' && value.trim() ? value : null;
}

function normalizeDocumentTitle( value: unknown ) {
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isVisibleCssColor( value: unknown ) {
	if ( typeof value !== 'string' || ! value.trim() ) {
		return false;
	}
	const normalized = value.replace( /\s+/g, '' ).toLowerCase();
	if ( normalized === 'transparent' ) {
		return false;
	}
	const rgba = normalized.match( /^rgba\([^,]+,[^,]+,[^,]+,([^)]+)\)$/ );
	if ( rgba ) {
		return Number.parseFloat( rgba[ 1 ] ) > 0;
	}
	const rgbAlpha = normalized.match( /^rgb\([^/]+\/([^)]+)\)$/ );
	if ( rgbAlpha ) {
		const alpha = rgbAlpha[ 1 ].endsWith( '%' )
			? Number.parseFloat( rgbAlpha[ 1 ] ) / 100
			: Number.parseFloat( rgbAlpha[ 1 ] );
		return alpha > 0;
	}
	return true;
}

function getBrowserShortcutDescriptor( key: string ) {
	const platform = getNavigatorPlatform();
	const keyLabel = key.toUpperCase();
	const modifier = getPrimaryModifierLabel( platform );

	return {
		displayShortcut: isApplePlatform( platform )
			? `${ modifier }${ keyLabel }`
			: `${ modifier }+${ keyLabel }`,
		ariaKeyShortcut: `${ isApplePlatform( platform ) ? 'Meta' : 'Control' }+${ keyLabel }`,
	};
}

function getBrowserShortcutCommand(
	event: Pick<
		globalThis.KeyboardEvent,
		'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'repeat' | 'defaultPrevented'
	>
): BrowserShortcutCommandType | null {
	if ( event.defaultPrevented || event.repeat || event.shiftKey || event.altKey ) {
		return null;
	}
	const platform = getNavigatorPlatform();
	const hasPrimaryModifier = isApplePlatform( platform ) ? event.metaKey : event.ctrlKey;
	if ( ! hasPrimaryModifier ) {
		return null;
	}
	const key = event.key.toLowerCase();
	if ( key === 'r' ) {
		return 'reload';
	}
	if ( key === '[' ) {
		return 'back';
	}
	if ( key === ']' ) {
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
		<Tooltip.Provider delay={ 0 }>
			<Tooltip.Root>
				<Tooltip.Trigger render={ children } />
				<Tooltip.Popup positioner={ <Tooltip.Positioner side="bottom" /> }>{ label }</Tooltip.Popup>
			</Tooltip.Root>
		</Tooltip.Provider>
	);
}

function areBrowserStatesEqual( a: BrowserNavigationState, b: BrowserNavigationState ) {
	return (
		a.canGoBack === b.canGoBack &&
		a.canGoForward === b.canGoForward &&
		a.loading === b.loading &&
		a.progress === b.progress &&
		a.title === b.title &&
		a.hasAdminBar === b.hasAdminBar &&
		a.adminBarBackgroundColor === b.adminBarBackgroundColor &&
		a.adminBarForegroundColor === b.adminBarForegroundColor
	);
}

export function SitePreview( {
	site,
	path,
	reloadNonce,
	onAnnotationsDone,
	collapsed = false,
	layoutWidth,
	hideResizeHandle = false,
	onPathChange,
}: SitePreviewProps ) {
	const startSite = useStartSite();
	const isStarting = useIsSiteStarting( site.id );
	const siteUrl = getSiteUrl( site );
	const canPreview = site.running;
	const [ browserState, setBrowserState ] =
		useState< BrowserNavigationState >( EMPTY_BROWSER_STATE );
	const activeBrowserState = browserState;
	const toolbarHasAdminBar = canPreview && activeBrowserState.hasAdminBar;
	const toolbarAdminBarBackground = activeBrowserState.adminBarBackgroundColor ?? '#1d1d1d';
	const toolbarAdminBarForeground = activeBrowserState.adminBarForegroundColor ?? '#f0f0f1';
	const previewUrl = `${ siteUrl }${ getSafePath( path ) }`;
	const pageTitle = getToolbarPageTitle( activeBrowserState.title, site.name );
	const toolbarStyle = toolbarHasAdminBar
		? ( {
				'--site-preview-toolbar-admin-bar-background': toolbarAdminBarBackground,
				'--site-preview-toolbar-admin-bar-foreground': toolbarAdminBarForeground,
		  } as CSSProperties )
		: undefined;
	const progress = activeBrowserState.loading
		? Math.max( activeBrowserState.progress, 0.12 )
		: activeBrowserState.progress;
	const showLoadingProgress = canPreview && progress > 0;
	const [ inspectorState, setInspectorState ] = useState< InspectorState >( EMPTY_INSPECTOR_STATE );
	const activeInspectorState = inspectorState;
	const [ inspectorCommand, setInspectorCommand ] = useState< InspectorCommand | null >( null );
	const [ browserCommand, setBrowserCommand ] = useState< BrowserCommand | null >( null );
	const rootRef = useRef< HTMLElement | null >( null );
	const commandIdRef = useRef( 0 );
	const parentSized = hideResizeHandle && layoutWidth === undefined;
	const previewResize = useResizablePanel( {
		config: PREVIEW_PANEL_CONFIG,
		disabled: hideResizeHandle,
		edge: 'left',
		storageKey: PREVIEW_PANEL_STORAGE_KEY,
	} );
	const previewStyle = parentSized
		? ( {
				'--site-preview-width': `${ previewResize.width }px`,
		  } as CSSProperties )
		: ( {
				'--site-preview-layout-width': `${ layoutWidth ?? previewResize.width }px`,
				'--site-preview-width': `${ previewResize.width }px`,
		  } as CSSProperties );
	const showResizeHandle = ! collapsed && ! hideResizeHandle;
	const canAnnotate = canPreview && activeInspectorState.ready;
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
	const handleInspectorReady = useCallback( () => {
		setInspectorState( ( current ) => ( {
			...current,
			ready: true,
		} ) );
	}, [] );
	const handleInspectorState = useCallback( ( state: InspectorState ) => {
		setInspectorState( state );
	}, [] );

	useEffect( () => {
		if ( typeof document === 'undefined' ) {
			return;
		}
		const body = document.body;
		body.dataset.sitePreviewToolbarTheme = toolbarHasAdminBar ? 'admin-bar' : 'surface';
		if ( toolbarHasAdminBar ) {
			body.style.setProperty(
				'--site-preview-toggle-active-background',
				`color-mix(in srgb, ${ toolbarAdminBarBackground } 94%, ${ toolbarAdminBarForeground })`
			);
			body.style.setProperty(
				'--site-preview-toggle-active-background-hover',
				`color-mix(in srgb, ${ toolbarAdminBarBackground } 90%, ${ toolbarAdminBarForeground })`
			);
			body.style.setProperty(
				'--site-preview-toggle-active-foreground',
				toolbarAdminBarForeground
			);
			body.style.setProperty(
				'--site-preview-toggle-active-foreground-hover',
				toolbarAdminBarForeground
			);
		} else {
			body.style.removeProperty( '--site-preview-toggle-active-background' );
			body.style.removeProperty( '--site-preview-toggle-active-background-hover' );
			body.style.removeProperty( '--site-preview-toggle-active-foreground' );
			body.style.removeProperty( '--site-preview-toggle-active-foreground-hover' );
		}
		return () => {
			delete body.dataset.sitePreviewToolbarTheme;
			body.style.removeProperty( '--site-preview-toggle-active-background' );
			body.style.removeProperty( '--site-preview-toggle-active-background-hover' );
			body.style.removeProperty( '--site-preview-toggle-active-foreground' );
			body.style.removeProperty( '--site-preview-toggle-active-foreground-hover' );
		};
	}, [ toolbarAdminBarBackground, toolbarAdminBarForeground, toolbarHasAdminBar ] );

	const browserShortcuts = useMemo(
		() => ( {
			back: getBrowserShortcutDescriptor( '[' ),
			forward: getBrowserShortcutDescriptor( ']' ),
			reload: getBrowserShortcutDescriptor( 'r' ),
		} ),
		[]
	);
	const annotateTooltipLabel = activeInspectorState.isPicking
		? __( 'Stop annotating' )
		: __( 'Annotate' );
	const submitAnnotationTooltipLabel = __( 'Submit annotations' );

	useEffect( () => {
		setBrowserState( EMPTY_BROWSER_STATE );
		setInspectorState( EMPTY_INSPECTOR_STATE );
	}, [ site.id ] );

	const sendInspectorCommand = useCallback( ( type: InspectorCommand[ 'type' ] ) => {
		commandIdRef.current += 1;
		setInspectorCommand( { id: commandIdRef.current, type } );
	}, [] );
	const sendBrowserCommand = useCallback( ( type: BrowserCommand[ 'type' ] ) => {
		commandIdRef.current += 1;
		setBrowserCommand( { id: commandIdRef.current, type } );
	}, [] );

	useEffect( () => {
		if ( collapsed || ! canPreview ) {
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
		<aside
			ref={ rootRef }
			className={ clsx(
				styles.root,
				parentSized && styles.rootParentSized,
				collapsed && styles.rootCollapsed,
				previewResize.isResizing && styles.rootResizing
			) }
			style={ previewStyle }
			aria-label={ __( 'Site preview' ) }
			aria-hidden={ collapsed || undefined }
		>
			{ showResizeHandle ? (
				<ResizeHandle
					className={ styles.resizeHandle }
					label={ __( 'Resize site preview' ) }
					minWidth={ previewResize.minWidth }
					maxWidth={ previewResize.maxWidth }
					width={ previewResize.width }
					isResizing={ previewResize.isResizing }
					onResizeStart={ previewResize.handleResizeStart }
					onKeyDown={ previewResize.handleKeyDown }
				/>
			) : null }
			<div className={ styles.viewport }>
				<div className={ styles.surface }>
					{ canPreview ? (
						<div
							className={ clsx( styles.header, toolbarHasAdminBar && styles.headerAdminBar ) }
							style={ toolbarStyle }
						>
							<div className={ styles.browserControls } aria-label={ __( 'Browser navigation' ) }>
								<IconButton
									className={ styles.browserControlButton }
									variant="minimal"
									tone="neutral"
									size="small"
									icon={ chevronLeft }
									label={ __( 'Back' ) }
									shortcut={ browserShortcuts.back }
									disabled={ ! activeBrowserState.canGoBack }
									onClick={ () => sendBrowserCommand( 'back' ) }
								/>
								<IconButton
									className={ styles.browserControlButton }
									variant="minimal"
									tone="neutral"
									size="small"
									icon={ chevronRight }
									label={ __( 'Forward' ) }
									shortcut={ browserShortcuts.forward }
									disabled={ ! activeBrowserState.canGoForward }
									onClick={ () => sendBrowserCommand( 'forward' ) }
								/>
								<IconButton
									className={ styles.browserControlButton }
									variant="minimal"
									tone="neutral"
									size="small"
									icon={ refreshIcon }
									label={ __( 'Refresh' ) }
									shortcut={ browserShortcuts.reload }
									onClick={ () => sendBrowserCommand( 'reload' ) }
								/>
							</div>
							<div className={ styles.browserLocation }>
								<ToolbarTooltip label={ previewUrl }>
									<span className={ styles.browserTitle }>{ pageTitle }</span>
								</ToolbarTooltip>
							</div>
							<div className={ styles.annotationControls }>
								<ToolbarTooltip label={ annotateTooltipLabel }>
									<button
										type="button"
										className={ clsx(
											styles.annotationButton,
											activeInspectorState.isPicking && styles.annotationButtonActive
										) }
										disabled={ ! canAnnotate }
										aria-label={ annotateTooltipLabel }
										aria-pressed={ activeInspectorState.isPicking }
										onClick={ () => sendInspectorCommand( 'toggle-picking' ) }
									>
										{ activeInspectorState.isPicking ? __( 'Picking...' ) : __( 'Annotate' ) }
									</button>
								</ToolbarTooltip>
								{ activeInspectorState.annotationCount > 0 ? (
									<ToolbarTooltip label={ submitAnnotationTooltipLabel }>
										<button
											type="button"
											className={ clsx( styles.annotationButton, styles.annotationButtonPrimary ) }
											disabled={ ! canAnnotate }
											aria-label={ submitAnnotationTooltipLabel }
											onClick={ () => sendInspectorCommand( 'submit' ) }
										>
											<span>{ __( 'Submit' ) }</span>
											<span className={ styles.annotationCount }>
												{ activeInspectorState.annotationCount }
											</span>
										</button>
									</ToolbarTooltip>
								) : null }
							</div>
						</div>
					) : null }
					{ showLoadingProgress ? (
						<div className={ styles.loadingProgress } aria-hidden="true">
							<span style={ { transform: `scaleX(${ Math.min( progress, 1 ) })` } } />
						</div>
					) : null }
					<div className={ styles.body }>
						{ canPreview ? (
							isElectron() ? (
								<WebviewSurface
									key={ site.id }
									active={ ! collapsed }
									url={ previewUrl }
									reloadNonce={ reloadNonce }
									onAnnotationsDone={ onAnnotationsDone }
									onInspectorReady={ handleInspectorReady }
									onInspectorState={ handleInspectorState }
									inspectorCommand={ inspectorCommand }
									browserCommand={ browserCommand }
									onBrowserStateChange={ handleBrowserStateChange }
									onBrowserCommand={ sendBrowserCommand }
									onNavigate={ handlePreviewNavigation }
								/>
							) : (
								<div
									className={ clsx(
										styles.previewSurface,
										! collapsed && styles.previewSurfaceActive
									) }
									aria-hidden={ collapsed }
								>
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
													...getIframeAdminBarBrowserState( event.currentTarget ),
												};
												return areBrowserStatesEqual( current, next ) ? current : next;
											} );
										} }
									/>
								</div>
							)
						) : (
							<div className={ styles.empty }>
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
						) }
					</div>
				</div>
			</div>
			{ previewResize.isResizing ? <ResizeOverlay /> : null }
		</aside>
	);
}

function getSafePath( path: unknown ) {
	return typeof path === 'string' && path.trim() ? path : '/';
}

function getToolbarPageTitle( title: string | null, siteName: string ) {
	const trimmedTitle = normalizeDocumentTitle( title );
	if ( trimmedTitle ) {
		const [ wordPressAdminTitle ] = trimmedTitle.split( /\s+\u2039\s+/ );
		const withoutWordPressSuffix = wordPressAdminTitle
			.replace( /\s+[\u2013\u2014-]\s+WordPress$/i, '' )
			.trim();
		return withoutWordPressSuffix || trimmedTitle;
	}
	return siteName || __( 'Site preview' );
}

function getPathFromPreviewUrl( url: string, baseUrl: string ) {
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
	active: boolean;
	url: string;
	reloadNonce: number;
	onAnnotationsDone?: ( annotations: Annotation[] ) => void;
	onInspectorReady?: () => void;
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
	active,
	url,
	reloadNonce,
	onAnnotationsDone,
	onInspectorReady,
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
	const onInspectorReadyRef = useRef( onInspectorReady );
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
		onInspectorReadyRef.current = onInspectorReady;
	}, [ onInspectorReady ] );
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

	const startProgress = useCallback( () => {
		clearProgressTimers();
		publishBrowserState( {
			loading: true,
			progress: Math.max( browserStateRef.current.progress, 0.12 ),
			...EMPTY_ADMIN_BAR_BROWSER_STATE,
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

	// The initial url+nonce are loaded by the `src` attribute on the
	// `<webview>` itself; calling `loadURL` before `dom-ready` throws
	// "WebView must be attached to the DOM and the dom-ready event emitted".
	// We capture the mount-time values once and skip the navigation effect
	// while it still matches them.
	const [ initialNav ] = useState( () => ( { url, reloadNonce } ) );

	// Wire DOM events on the underlying custom element. We use refs + native
	// event listeners because React doesn't recognise `<webview>`'s
	// non-standard events (`dom-ready`, `console-message`).
	useEffect( () => {
		const webview = ref.current as WebviewTag | null;
		if ( ! webview ) return;

		const detectAdminBar = () => {
			webview
				.executeJavaScript( ADMIN_BAR_STYLE_SCRIPT, false )
				.then( ( adminBarStyle ) => {
					publishBrowserState( getAdminBarBrowserState( adminBarStyle ) );
				} )
				.catch( () => {
					publishBrowserState( EMPTY_ADMIN_BAR_BROWSER_STATE );
				} );
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
			publishBrowserState( EMPTY_ADMIN_BAR_BROWSER_STATE );
			detectAdminBar();
			publishDocumentTitle();
			webview
				.executeJavaScript( INSPECTOR_PAGE_SCRIPT, false )
				.then( () => {
					onInspectorReadyRef.current?.();
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
		// successful load; without a per-load guard the admin-bar script would
		// execute once per event instead of once per navigation.
		let didDetectAfterLoad = false;
		const handleNavigate = ( event: Event ) => {
			const navigateEvent = event as { url?: unknown };
			if ( typeof navigateEvent.url === 'string' ) {
				currentUrlRef.current = navigateEvent.url;
				onNavigateRef.current?.( navigateEvent.url );
			}
			didDetectAfterLoad = false;
			publishBrowserState();
		};
		const handleStartLoading = () => {
			didDetectAfterLoad = false;
			onInspectorStateRef.current?.( EMPTY_INSPECTOR_STATE );
			publishBrowserState( { title: null } );
			startProgress();
		};
		const handleStopLoading = () => {
			finishProgress();
			if ( domReadyRef.current && ! didDetectAfterLoad ) {
				didDetectAfterLoad = true;
				detectAdminBar();
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

	useEffect( () => {
		if ( active ) {
			publishBrowserState();
		}
	}, [ active, publishBrowserState ] );

	// Navigation effect — gated on `ready` so the first call happens after
	// `dom-ready`. If url/nonce changed while loading, the latest values are
	// flushed when `ready` flips to true.
	useEffect( () => {
		if ( ! ready ) return;
		if ( url === initialNav.url && reloadNonce === initialNav.reloadNonce ) return;
		if ( url === currentUrlRef.current && reloadNonce === lastReloadNonceRef.current ) return;
		const webview = ref.current as WebviewTag | null;
		if ( ! webview ) return;
		currentUrlRef.current = url;
		lastReloadNonceRef.current = reloadNonce;
		webview.loadURL( url ).catch( () => undefined );
	}, [ url, reloadNonce, ready, initialNav.url, initialNav.reloadNonce ] );

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
			} else if ( browserCommand.type === 'stop' ) {
				webview.stop?.();
				finishProgress();
			}
		} finally {
			publishBrowserState();
		}
	}, [ browserCommand, finishProgress, publishBrowserState, ready ] );

	return (
		<div
			className={ clsx( styles.previewSurface, active && styles.previewSurfaceActive ) }
			aria-hidden={ ! active }
		>
			<webview
				ref={ ref }
				src={ initialNav.url }
				className={ styles.iframe }
				allowpopups={ true }
				partition="persist:site-preview"
			/>
			{ active && ! ready ? (
				<div className={ styles.spinnerOverlay } aria-hidden="true">
					<span className={ styles.spinner } />
				</div>
			) : null }
		</div>
	);
}
