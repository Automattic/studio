import { __ } from '@wordpress/i18n';
import { external } from '@wordpress/icons';
import { Button, IconButton } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useEffect, useRef, useState } from 'react';
import { ResizeHandle, ResizeOverlay } from '@/components/resize-handle';
import { useConnector } from '@/data/core';
import { useIsSiteStarting, useStartSite } from '@/data/queries/use-sites';
import { useResizablePanel } from '@/hooks/use-resizable-panel';
import { useSessionPreviewUI } from '@/hooks/use-session-ui';
import { getSiteUrl } from '@/lib/get-site-url';
import { playIcon } from '@/lib/icons';
import { PREVIEW_PANEL_CONFIG, PREVIEW_PANEL_STORAGE_KEY } from '@/lib/resizable-panels';
import { INSPECTOR_BRIDGE_PREFIX, INSPECTOR_PAGE_SCRIPT } from './inspector-script';
import styles from './style.module.css';
import type { Annotation } from './types';
import type { SiteDetails } from '@/data/core';
import type { CSSProperties } from 'react';

export type { Annotation } from './types';

interface SitePreviewProps {
	site: SiteDetails;
	// Called when the user clicks "Submit" in the inspector toolbar. Receives
	// the full annotation payload assembled inside the webview's guest page.
	onAnnotationsDone?: ( annotations: Annotation[] ) => void;
}

interface InspectorEvent {
	type: 'done';
	annotations?: Annotation[];
}

// Electron's `<webview>` is a custom element with non-standard methods. Type
// just the surface we use so this file compiles without an `electron` dep.
interface WebviewTag extends HTMLElement {
	loadURL( url: string ): Promise< void >;
	executeJavaScript( code: string, userGesture?: boolean ): Promise< unknown >;
	openDevTools(): void;
}

// Studio's preview pane has its own chrome (header, mode toggle); the WP
// admin bar (`#wpadminbar`) on top of every wp-admin / logged-in front-end
// page is visual noise here. Run the snippet below on every dom-ready so
// it covers both slots and survives in-webview navigation.
//
// We use inline `style.setProperty(..., 'important')` rather than an
// external stylesheet because WP / themes / wp-admin reserve admin-bar
// space across multiple selectors (html, body, #wpwrap, #wpcontent, …)
// and across multiple media queries (32px desktop / 46px mobile / 600px
// breakpoints), often with `!important` themselves. Inline styles win
// the cascade unconditionally, and a small MutationObserver re-applies
// the fix if WP injects late content (e.g. heartbeat re-rendering the
// admin bar after first paint).
const HIDE_ADMIN_BAR_SCRIPT = `
( function () {
	var TARGET_IDS = [ 'wpwrap', 'wpcontent', 'wpbody', 'wpbody-content' ];
	function killTopSpace( el ) {
		if ( ! el || ! el.style || typeof el.style.setProperty !== 'function' ) return;
		el.style.setProperty( 'margin-top', '0', 'important' );
		el.style.setProperty( 'padding-top', '0', 'important' );
	}
	function fix() {
		var bar = document.getElementById( 'wpadminbar' );
		if ( bar && bar.style ) bar.style.setProperty( 'display', 'none', 'important' );
		killTopSpace( document.documentElement );
		killTopSpace( document.body );
		for ( var i = 0; i < TARGET_IDS.length; i++ ) {
			killTopSpace( document.getElementById( TARGET_IDS[ i ] ) );
		}
	}
	fix();
	if ( document.body && typeof MutationObserver === 'function' ) {
		new MutationObserver( fix ).observe( document.body, { childList: true } );
	}
} )();
`;

interface WebviewConsoleEvent extends Event {
	level: number;
	message: string;
}

// Best-effort UA sniff: webview is only meaningful inside Electron. Outside
// (e.g. running apps/ui standalone in a regular browser) the tag is inert, so
// we render a plain iframe instead and skip the inspector.
const isElectron = (): boolean => {
	if ( typeof navigator === 'undefined' ) return false;
	return /\bElectron\//.test( navigator.userAgent );
};

export function SitePreview( { site, onAnnotationsDone }: SitePreviewProps ) {
	const connector = useConnector();
	const startSite = useStartSite();
	const isStarting = useIsSiteStarting( site.id );
	const siteUrl = getSiteUrl( site );
	const canPreview = site.running;
	const { mode, site: siteSlot, panel: panelSlot, setMode } = useSessionPreviewUI();
	const hasPanel = !! panelSlot;
	const activeSlot = mode === 'panel' && panelSlot ? panelSlot : siteSlot;
	const fullUrl = `${ siteUrl }${ activeSlot.path }`;

	const previewResize = useResizablePanel( {
		config: PREVIEW_PANEL_CONFIG,
		edge: 'left',
		storageKey: PREVIEW_PANEL_STORAGE_KEY,
	} );
	const previewStyle = {
		'--site-preview-width': `${ previewResize.width }px`,
	} as CSSProperties;

	return (
		<aside className={ styles.root } style={ previewStyle } aria-label={ __( 'Site preview' ) }>
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
			<div className={ styles.header }>
				<div className={ styles.trafficLights } aria-hidden="true">
					<span className={ clsx( styles.trafficLight, styles.trafficLightActive ) } />
					<span className={ styles.trafficLight } />
					<span className={ styles.trafficLight } />
				</div>
				<div className={ styles.modeToggle } role="group" aria-label={ __( 'Preview mode' ) }>
					<button
						type="button"
						className={ clsx( styles.modeButton, mode === 'site' && styles.modeButtonActive ) }
						onClick={ () => setMode( 'site' ) }
						aria-pressed={ mode === 'site' }
					>
						{ __( 'Site' ) }
					</button>
					<button
						type="button"
						className={ clsx( styles.modeButton, mode === 'panel' && styles.modeButtonActive ) }
						onClick={ () => setMode( 'panel' ) }
						disabled={ ! hasPanel }
						aria-pressed={ mode === 'panel' }
						title={ ! hasPanel ? __( 'No panel generated yet' ) : __( 'Show generated panel' ) }
					>
						{ __( 'Panel' ) }
					</button>
				</div>
				<span className={ styles.headerSpacer } aria-hidden="true" />
				<span className={ styles.separator } aria-hidden="true" />
				<IconButton
					variant="minimal"
					tone="neutral"
					size="small"
					icon={ external }
					label={ __( 'Open site in browser' ) }
					disabled={ ! canPreview }
					onClick={ () => void connector.openExternalUrl( fullUrl ) }
				/>
			</div>
			<div className={ styles.body }>
				{ canPreview ? (
					isElectron() ? (
						<>
							{ /* Two webviews — one per slot — kept mounted so toggling
							     Site↔Panel preserves each side's in-page state (scroll
							     position, DataView filters, etc.) and avoids a fresh
							     navigation through `/studio-auto-login` each time. */ }
							<WebviewSurface
								key={ `${ site.id }/site` }
								url={ `${ siteUrl }${ siteSlot.path }` }
								reloadNonce={ siteSlot.reloadNonce }
								onAnnotationsDone={ onAnnotationsDone }
								enableInspector
								hidden={ mode !== 'site' }
							/>
							{ panelSlot ? (
								<WebviewSurface
									key={ `${ site.id }/panel` }
									url={ `${ siteUrl }${ panelSlot.path }` }
									reloadNonce={ panelSlot.reloadNonce }
									enableInspector={ false }
									hidden={ mode !== 'panel' }
								/>
							) : null }
						</>
					) : (
						// Non-Electron fallback: plain iframe, no inspector.
						<iframe
							key={ `${ fullUrl }#${ activeSlot.reloadNonce }` }
							className={ styles.iframe }
							src={ fullUrl }
							title={ site.name }
						/>
					)
				) : (
					<div className={ styles.empty }>
						<p className={ styles.emptyText }>{ __( 'Start the site to see a live preview.' ) }</p>
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
			{ previewResize.isResizing ? <ResizeOverlay /> : null }
		</aside>
	);
}

interface WebviewSurfaceProps {
	url: string;
	reloadNonce: number;
	onAnnotationsDone?: ( annotations: Annotation[] ) => void;
	enableInspector?: boolean;
	// When true, the underlying `<webview>` stays mounted (preserving page
	// state and avoiding a re-navigation) but is hidden via CSS.
	hidden?: boolean;
}

/**
 * Renders the site preview as an Electron `<webview>` tag.
 *
 * The annotation inspector is injected into the guest page via
 * `executeJavaScript()` after each load. It reports completed annotation
 * batches by calling `console.log(BRIDGE_PREFIX + JSON.stringify(...))`,
 * which we receive through the webview's `console-message` event.
 *
 * When `enableInspector` is false (e.g. for studio-panels admin pages) the
 * inspector script is skipped — those pages are agent-rendered UI, not the
 * site content the inspector is designed to annotate.
 */
function WebviewSurface( {
	url,
	reloadNonce,
	onAnnotationsDone,
	enableInspector = true,
	hidden = false,
}: WebviewSurfaceProps ) {
	const ref = useRef< HTMLElement | null >( null );
	const [ ready, setReady ] = useState( false );
	const onAnnotationsDoneRef = useRef( onAnnotationsDone );
	useEffect( () => {
		onAnnotationsDoneRef.current = onAnnotationsDone;
	}, [ onAnnotationsDone ] );
	const enableInspectorRef = useRef( enableInspector );
	useEffect( () => {
		enableInspectorRef.current = enableInspector;
	}, [ enableInspector ] );

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

		const handleDomReady = () => {
			setReady( true );
			webview.executeJavaScript( HIDE_ADMIN_BAR_SCRIPT, false ).catch( () => undefined );
			if ( ! enableInspectorRef.current ) return;
			webview.executeJavaScript( INSPECTOR_PAGE_SCRIPT, false ).catch( () => {
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
			if ( ! parsed || parsed.type !== 'done' || ! parsed.annotations ) return;
			onAnnotationsDoneRef.current?.( parsed.annotations );
		};

		// Cmd/Ctrl+Shift+I opens the webview's own DevTools so the inner
		// page can be inspected. Without this the iframe is opaque and
		// debugging anything inside Studio's preview is painful.
		const handleHostKeydown = ( event: KeyboardEvent ) => {
			if (
				( event.metaKey || event.ctrlKey ) &&
				event.shiftKey &&
				( event.key === 'I' || event.key === 'i' )
			) {
				event.preventDefault();
				try {
					webview.openDevTools();
				} catch {
					// Webview not yet attached or already open — both are fine.
				}
			}
		};

		webview.addEventListener( 'dom-ready', handleDomReady );
		webview.addEventListener( 'console-message', handleConsoleMessage );
		window.addEventListener( 'keydown', handleHostKeydown );
		return () => {
			webview.removeEventListener( 'dom-ready', handleDomReady );
			webview.removeEventListener( 'console-message', handleConsoleMessage );
			window.removeEventListener( 'keydown', handleHostKeydown );
		};
	}, [] );

	// Navigation effect — gated on `ready` so the first call happens after
	// `dom-ready`. If url/nonce changed while loading, the latest values are
	// flushed when `ready` flips to true.
	useEffect( () => {
		if ( ! ready ) return;
		if ( url === initialNav.url && reloadNonce === initialNav.reloadNonce ) return;
		const webview = ref.current as WebviewTag | null;
		if ( ! webview ) return;
		webview.loadURL( url ).catch( () => undefined );
	}, [ url, reloadNonce, ready, initialNav.url, initialNav.reloadNonce ] );

	return (
		<div className={ clsx( styles.webviewSlot, hidden && styles.webviewSlotHidden ) }>
			<webview
				ref={ ref }
				src={ initialNav.url }
				className={ styles.iframe }
				allowpopups="true"
				partition="persist:site-preview"
			/>
			{ ! ready ? (
				<div className={ styles.spinnerOverlay } aria-hidden="true">
					<span className={ styles.spinner } />
				</div>
			) : null }
		</div>
	);
}
