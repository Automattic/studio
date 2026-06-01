import { __ } from '@wordpress/i18n';
import { external } from '@wordpress/icons';
import { Button, IconButton } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useEffect, useRef, useState } from 'react';
import { ResizeHandle, ResizeOverlay } from '@/components/resize-handle';
import { useConnector } from '@/data/core';
import { useIsSiteStarting, useStartSite } from '@/data/queries/use-sites';
import { useResizablePanel } from '@/hooks/use-resizable-panel';
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
	// Path to display within the previewed site, controlled by the parent so
	// it can be updated by chat artifact events even when the panel was
	// previously collapsed.
	path: string;
	// Bumped by the parent to force a webview reload.
	reloadNonce: number;
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
}

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

export function SitePreview( { site, path, reloadNonce, onAnnotationsDone }: SitePreviewProps ) {
	const connector = useConnector();
	const startSite = useStartSite();
	const isStarting = useIsSiteStarting( site.id );
	const siteUrl = getSiteUrl( site );
	const canPreview = site.running;
	const fullUrl = `${ siteUrl }${ path }`;
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
						<WebviewSurface
							key={ site.id }
							url={ fullUrl }
							reloadNonce={ reloadNonce }
							onAnnotationsDone={ onAnnotationsDone }
						/>
					) : (
						// Non-Electron fallback: plain iframe, no inspector.
						<iframe
							key={ `${ fullUrl }#${ reloadNonce }` }
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
}

/**
 * Renders the site preview as an Electron `<webview>` tag.
 *
 * The annotation inspector is injected into the guest page via
 * `executeJavaScript()` after each load. It reports completed annotation
 * batches by calling `console.log(BRIDGE_PREFIX + JSON.stringify(...))`,
 * which we receive through the webview's `console-message` event.
 */
function WebviewSurface( { url, reloadNonce, onAnnotationsDone }: WebviewSurfaceProps ) {
	const ref = useRef< HTMLElement | null >( null );
	const [ ready, setReady ] = useState( false );
	const onAnnotationsDoneRef = useRef( onAnnotationsDone );
	useEffect( () => {
		onAnnotationsDoneRef.current = onAnnotationsDone;
	}, [ onAnnotationsDone ] );

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

		webview.addEventListener( 'dom-ready', handleDomReady );
		webview.addEventListener( 'console-message', handleConsoleMessage );
		return () => {
			webview.removeEventListener( 'dom-ready', handleDomReady );
			webview.removeEventListener( 'console-message', handleConsoleMessage );
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
		<>
			<webview
				ref={ ref }
				src={ initialNav.url }
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
