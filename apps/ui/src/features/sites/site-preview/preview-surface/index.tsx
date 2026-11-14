import {
	INSPECTOR_PAGE_SCRIPT,
	parseInspectorMessage,
	type InspectorEvent,
} from '@studio/agent/protocol/inspector/page-script';
import { __ } from '@wordpress/i18n';
import { isAppleOS } from '@wordpress/keycodes';
import { clsx } from 'clsx';
import { useEffect, useRef, useState } from 'react';
import { useConnector } from '@/data/core';
import { useColorScheme } from '@/data/host/use-color-scheme';
import { PanelLoadError } from '@/features/sites/panel-load-error';
import { normalizeDocumentTitle } from '@/features/sites/site-preview/browser-state';
import { ResponsiveViewport } from '../responsive-preview/viewport';
import { buildClearSelectionScript, buildInspectorCommandScript } from './inspector-command';
import styles from './style.module.css';
import type { ResponsivePreviewSettings } from '@/data/responsive-preview';
import type { SiteAnnotations } from '@/features/annotations';
import type { BrowserCommand } from '@/features/sites/site-preview/browser-state';
import type { AnnotationTool } from '@studio/agent/protocol/inspector/shortcuts';
import type { ReactNode } from 'react';

export { WebviewSurface } from './webview-surface';
export { isElectron } from './webview';

// One stacked layer per mounted surface. Only the active layer is visible; the
// other stays mounted and laid out at its own size, so coming back to it is a
// reload with nothing to resize or re-emulate.
export function SurfaceLayer( {
	active,
	loading,
	failed,
	design,
	responsive,
	children,
}: {
	active: boolean;
	loading?: boolean;
	failed?: boolean;
	design?: boolean;
	responsive?: {
		siteId: string;
		settings: ResponsivePreviewSettings;
		scale: number;
		active: boolean;
	};
	children: ReactNode;
} ) {
	return (
		<div
			className={ clsx( styles.realmLayer, ! active && styles.realmLayerHidden ) }
			data-loading={ loading || undefined }
			inert={ active ? undefined : true }
		>
			<ResponsiveViewport { ...responsive } active={ active && ( responsive?.active ?? true ) }>
				<div
					className={ clsx( styles.surfaceFrame, design && styles.designSurface ) }
					data-failed={ failed || undefined }
				>
					{ children }
				</div>
			</ResponsiveViewport>
		</div>
	);
}

function getIframeTitle( iframe: HTMLIFrameElement ) {
	try {
		return normalizeDocumentTitle( iframe.contentDocument?.title );
	} catch {
		return null;
	}
}

// Non-Electron fallback: plain iframe, with the annotation inspector where the
// connector can reach the frame's pages. Reloads by remounting; back/forward
// aren't reachable from the host.
export function FrameSurface( {
	src,
	title,
	onLoad,
	onSettle,
	onNavigate,
	onLoadingChange,
	browserCommand,
	onCommandHandled,
	onAdminBarVisibilityChange,
	annotations,
	annotationTool = 'select',
	clearSelection,
	onInspectorReady,
	onInspectorEvent,
}: {
	src: string;
	title: string;
	onLoad: ( src: string ) => void;
	// Whether the server answered for the page, once asked.
	onSettle: ( src: string, title: string | null, failed: boolean ) => void;
	onNavigate?: ( url: string ) => void;
	onLoadingChange?: ( loading: boolean ) => void;
	browserCommand?: BrowserCommand | null;
	onCommandHandled?: () => void;
	onAdminBarVisibilityChange?: ( visible: boolean | null ) => void;
	annotations?: SiteAnnotations;
	annotationTool?: AnnotationTool;
	clearSelection?: string;
	onInspectorReady?: ( ready: boolean ) => void;
	onInspectorEvent?: ( event: InspectorEvent ) => void;
} ) {
	const connector = useConnector();
	const ref = useRef< HTMLIFrameElement | null >( null );
	const [ page, setPage ] = useState< { run( script: string ): void } | null >( null );
	const callbacks = useRef( {
		onAdminBarVisibilityChange,
		onNavigate,
		onLoadingChange,
		onSettle,
		onInspectorReady,
		onInspectorEvent,
	} );
	const navigationId = useRef( 0 );
	const pendingProbe = useRef( 0 );
	const reportedPage = useRef< {
		navigationId: number;
		url: string;
		title: string | null;
	} | null >( null );
	useEffect( () => {
		callbacks.current = {
			onAdminBarVisibilityChange,
			onNavigate,
			onLoadingChange,
			onSettle,
			onInspectorReady,
			onInspectorEvent,
		};
	}, [
		onAdminBarVisibilityChange,
		onNavigate,
		onLoadingChange,
		onSettle,
		onInspectorReady,
		onInspectorEvent,
	] );
	useEffect( () => {
		if ( browserCommand?.type !== 'login' && browserCommand?.type !== 'read-admin-bar' ) return;
		ref.current?.contentWindow?.postMessage(
			{
				type:
					browserCommand.type === 'login'
						? 'studio:preview:login'
						: 'studio:preview:read-admin-bar',
			},
			new URL( src ).origin
		);
		onCommandHandled?.();
	}, [ browserCommand, onCommandHandled, src ] );

	const inspector = !! annotations && !! connector.connectPreviewFrame;
	useEffect( () => {
		const iframe = ref.current;
		if ( ! inspector || ! iframe || ! connector.connectPreviewFrame ) return;
		const connection = connector.connectPreviewFrame( iframe, {
			onPage() {
				connection.run( INSPECTOR_PAGE_SCRIPT );
				// A new object for each page: its inspector starts with no notes.
				setPage( { ...connection } );
				callbacks.current.onInspectorReady?.( true );
			},
			onLog( message ) {
				const event = parseInspectorMessage( message, iframe.getBoundingClientRect() );
				if ( event ) callbacks.current.onInspectorEvent?.( event );
			},
		} );
		return () => {
			connection.dispose();
			setPage( null );
			callbacks.current.onInspectorReady?.( false );
		};
	}, [ connector, inspector ] );

	// Mirrors the notes into the page, in the theme's accent.
	const colorScheme = useColorScheme();
	useEffect( () => {
		if ( page && annotations && ref.current ) {
			page.run( buildInspectorCommandScript( annotations, ref.current, annotationTool ) );
		}
	}, [ annotations, annotationTool, colorScheme, page ] );
	useEffect( () => {
		if ( page && clearSelection ) page.run( buildClearSelectionScript( clearSelection ) );
	}, [ clearSelection, page ] );

	useEffect( () => {
		const onMessage = ( event: MessageEvent ) => {
			const iframe = ref.current;
			if (
				! iframe ||
				event.source !== iframe.contentWindow ||
				event.origin !== new URL( iframe.src ).origin
			) {
				return;
			}
			if ( event.data?.type === 'studio:preview:navigating' ) {
				if ( event.data.navigationId !== navigationId.current ) return;
				pendingProbe.current += 1;
				callbacks.current.onAdminBarVisibilityChange?.( null );
				callbacks.current.onLoadingChange?.( true );
				return;
			}
			if ( event.data?.type === 'studio:preview:admin-bar-state' ) {
				const { visible, url, title, navigationId: reportedNavigationId } = event.data;
				if (
					reportedNavigationId !== navigationId.current ||
					( typeof visible !== 'boolean' && visible !== null ) ||
					typeof url !== 'string'
				)
					return;
				try {
					if ( new URL( url ).origin !== event.origin ) return;
				} catch {
					return;
				}
				pendingProbe.current += 1;
				callbacks.current.onNavigate?.( url );
				const pageTitle = normalizeDocumentTitle( title );
				const previous = reportedPage.current;
				if (
					! previous ||
					previous.navigationId !== reportedNavigationId ||
					previous.url !== url ||
					previous.title !== pageTitle
				) {
					reportedPage.current = { navigationId: reportedNavigationId, url, title: pageTitle };
					callbacks.current.onSettle( url, pageTitle, false );
				}
				callbacks.current.onAdminBarVisibilityChange?.( visible );
				return;
			}
			if ( event.data?.type !== 'studio:preview-shortcuts:command-palette' ) return;
			iframe.blur();
			document.dispatchEvent(
				new KeyboardEvent( 'keydown', {
					key: 'k',
					code: 'KeyK',
					metaKey: isAppleOS(),
					ctrlKey: ! isAppleOS(),
					bubbles: true,
					cancelable: true,
				} )
			);
		};
		window.addEventListener( 'message', onMessage );
		return () => {
			pendingProbe.current += 1;
			window.removeEventListener( 'message', onMessage );
		};
	}, [] );

	return (
		<iframe
			ref={ ref }
			className={ styles.iframe }
			src={ src }
			title={ title }
			data-annotation-surface={ inspector || undefined }
			onLoad={ ( event ) => {
				callbacks.current.onAdminBarVisibilityChange?.( null );
				navigationId.current += 1;
				const probe = ++pendingProbe.current;
				const { src: loadedSrc } = event.currentTarget;
				event.currentTarget.contentWindow?.postMessage(
					{
						type: 'studio:preview-shortcuts:init',
						apple: isAppleOS(),
						navigationId: navigationId.current,
					},
					new URL( loadedSrc ).origin
				);
				const pageTitle = getIframeTitle( event.currentTarget );
				onLoad( loadedSrc );
				// A frame fires `load` for the browser's own error page too, and
				// it's cross-origin, so ask the server whether it's there at all.
				void fetch( new URL( '/', loadedSrc ).toString(), {
					method: 'HEAD',
					mode: 'no-cors',
					cache: 'no-store',
				} )
					.then(
						() => false,
						() => true
					)
					.then( ( failed ) => {
						if ( probe === pendingProbe.current )
							callbacks.current.onSettle( loadedSrc, pageTitle, failed );
					} );
			} }
		/>
	);
}

export function PreviewLoadFailed( { onRetry }: { onRetry: () => void } ) {
	return (
		<PanelLoadError
			className={ styles.loadFailed }
			message={ __( 'Browser could not load.' ) }
			onRetry={ onRetry }
		/>
	);
}
