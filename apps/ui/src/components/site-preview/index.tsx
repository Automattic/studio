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
	onAnnotationsDone?: ( annotations: Annotation[] ) => void;
}

interface InspectorEvent {
	type: 'done';
	annotations?: Annotation[];
}

// Subset of Electron's `<webview>` API we use; typed locally so this file
// compiles without an `electron` dep.
interface WebviewTag extends HTMLElement {
	loadURL( url: string ): Promise< void >;
	executeJavaScript( code: string, userGesture?: boolean ): Promise< unknown >;
	insertCSS( css: string ): Promise< string >;
}

// Studio's preview pane has its own chrome; the WP admin bar at the top of
// every wp-admin / logged-in front-end page is visual noise here. The CSS
// covers elements that exist or arrive later (e.g. @wordpress/boot mounts
// `.boot-layout__stage` async), the JS sets inline styles that win the
// cascade for elements present at dom-ready.
const HIDE_ADMIN_BAR_CSS = `
	#wpadminbar { display: none !important; }
	html.wp-toolbar, body.admin-bar { margin-top: 0 !important; padding-top: 0 !important; }
	html .boot-layout--single-page .boot-layout__stage,
	html .boot-layout--single-page .boot-layout__inspector {
		top: 0 !important;
		height: 100% !important;
	}
`;

const HIDE_ADMIN_BAR_SCRIPT = `
( function () {
	var TARGET_IDS = [ 'wpwrap', 'wpcontent', 'wpbody', 'wpbody-content' ];
	var TARGET_SELECTORS = [
		'.boot-layout--single-page .boot-layout__stage',
		'.boot-layout--single-page .boot-layout__inspector',
	];
	function killTopSpace( el ) {
		if ( ! el || ! el.style || typeof el.style.setProperty !== 'function' ) return;
		el.style.setProperty( 'margin-top', '0', 'important' );
		el.style.setProperty( 'padding-top', '0', 'important' );
	}
	function killTopOffset( el ) {
		if ( ! el || ! el.style || typeof el.style.setProperty !== 'function' ) return;
		var cs = getComputedStyle( el );
		if ( cs.position === 'static' ) return;
		el.style.setProperty( 'top', '0', 'important' );
		el.style.setProperty( 'height', '100%', 'important' );
	}
	function fix() {
		var bar = document.getElementById( 'wpadminbar' );
		if ( bar && bar.style ) bar.style.setProperty( 'display', 'none', 'important' );
		killTopSpace( document.documentElement );
		killTopSpace( document.body );
		for ( var i = 0; i < TARGET_IDS.length; i++ ) {
			killTopSpace( document.getElementById( TARGET_IDS[ i ] ) );
		}
		for ( var k = 0; k < TARGET_SELECTORS.length; k++ ) {
			var nodes = document.querySelectorAll( TARGET_SELECTORS[ k ] );
			for ( var j = 0; j < nodes.length; j++ ) {
				killTopSpace( nodes[ j ] );
				killTopOffset( nodes[ j ] );
			}
		}
	}
	fix();
	// boot's layout primitives mount async after dom-ready; the observer
	// re-runs the fix as they arrive.
	if ( document.body && typeof MutationObserver === 'function' ) {
		new MutationObserver( fix ).observe( document.body, { childList: true, subtree: true } );
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
							{ /* Two webviews kept mounted so toggling Site↔Panel preserves
							     each side's in-page state and avoids re-navigating through
							     /studio-auto-login. */ }
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
	hidden?: boolean;
}

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

	// `loadURL` before `dom-ready` throws — capture mount-time values once
	// and skip the navigation effect until they no longer match.
	const [ initialNav ] = useState( () => ( { url, reloadNonce } ) );

	// React doesn't recognise `<webview>`'s non-standard events
	// (`dom-ready`, `console-message`); wire them via native listeners.
	useEffect( () => {
		const webview = ref.current as WebviewTag | null;
		if ( ! webview ) return;

		const handleDomReady = () => {
			setReady( true );
			webview.insertCSS( HIDE_ADMIN_BAR_CSS ).catch( () => undefined );
			webview.executeJavaScript( HIDE_ADMIN_BAR_SCRIPT, false ).catch( () => undefined );
			if ( ! enableInspectorRef.current ) return;
			webview.executeJavaScript( INSPECTOR_PAGE_SCRIPT, false ).catch( () => {
				// Transient injection failures (e.g. frame swapped mid-eval)
				// recover on the next dom-ready.
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

		webview.addEventListener( 'dom-ready', handleDomReady );
		webview.addEventListener( 'console-message', handleConsoleMessage );
		return () => {
			webview.removeEventListener( 'dom-ready', handleDomReady );
			webview.removeEventListener( 'console-message', handleConsoleMessage );
		};
	}, [] );

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
