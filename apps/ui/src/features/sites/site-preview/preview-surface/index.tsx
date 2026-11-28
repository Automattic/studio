import { __ } from '@wordpress/i18n';
import { isAppleOS } from '@wordpress/keycodes';
import { clsx } from 'clsx';
import { useCallback, useEffect, useRef } from 'react';
import { PanelLoadError } from '@/features/sites/panel-load-error';
import { normalizeDocumentTitle } from '@/features/sites/site-preview/browser-state';
import { ResponsiveViewport } from '../responsive-preview/viewport';
import styles from './style.module.css';
import type { ResponsivePreviewSettings } from '@/data/responsive-preview';
import type { BrowserCommand } from '@/features/sites/site-preview/browser-state';
import type { ReactNode } from 'react';

export { WebviewSurface } from './webview-surface';
export { isElectron } from './webview';

const THEME_COLOR_RESPONSE_TIMEOUT_MS = 4000;

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
			data-tab-surface
			data-loading={ loading || undefined }
			inert={ active ? undefined : true }
		>
			<ResponsiveViewport { ...responsive } active={ active && ( responsive?.active ?? true ) }>
				<div
					className={ clsx( styles.surfaceFrame, design && styles.designSurface ) }
					data-design-surface={ design || undefined }
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

// Non-Electron fallback: plain iframe. Reloads by remounting; back/forward aren't reachable from
// the host, and the annotation inspector can't reach a cross-origin frame's pages.
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
	themeColorActive = false,
	onThemeColorChange,
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
	themeColorActive?: boolean;
	onThemeColorChange?: ( color: string | null ) => void;
} ) {
	const ref = useRef< HTMLIFrameElement | null >( null );
	const callbacks = useRef( {
		onAdminBarVisibilityChange,
		onThemeColorChange,
		onNavigate,
		onLoadingChange,
		onSettle,
	} );
	const navigationId = useRef( 0 );
	const themeColorActiveRef = useRef( themeColorActive );
	const themeDocumentReady = useRef( false );
	const themeColorTimeout = useRef< ReturnType< typeof setTimeout > | null >( null );
	const pendingProbe = useRef( 0 );
	const reportedPage = useRef< {
		navigationId: number;
		url: string;
		title: string | null;
	} | null >( null );
	const clearThemeColorTimeout = useCallback( () => {
		if ( themeColorTimeout.current !== null ) clearTimeout( themeColorTimeout.current );
		themeColorTimeout.current = null;
	}, [] );
	const requestThemeColor = useCallback(
		( enabled: boolean ) => {
			clearThemeColorTimeout();
			const iframe = ref.current;
			if ( ! iframe || ! themeDocumentReady.current ) return;
			iframe.contentWindow?.postMessage(
				{ type: 'studio:preview:theme-color', enabled },
				new URL( iframe.src ).origin
			);
			if ( enabled ) {
				const requestedNavigation = navigationId.current;
				themeColorTimeout.current = setTimeout( () => {
					themeColorTimeout.current = null;
					if (
						themeColorActiveRef.current &&
						themeDocumentReady.current &&
						navigationId.current === requestedNavigation
					) {
						callbacks.current.onThemeColorChange?.( null );
					}
				}, THEME_COLOR_RESPONSE_TIMEOUT_MS );
			}
		},
		[ clearThemeColorTimeout ]
	);
	useEffect( () => clearThemeColorTimeout, [ clearThemeColorTimeout ] );
	useEffect( () => {
		callbacks.current = {
			onAdminBarVisibilityChange,
			onThemeColorChange,
			onNavigate,
			onLoadingChange,
			onSettle,
		};
	}, [ onAdminBarVisibilityChange, onThemeColorChange, onNavigate, onLoadingChange, onSettle ] );
	useEffect( () => {
		themeColorActiveRef.current = themeColorActive;
		if ( ! navigationId.current ) return;
		requestThemeColor( themeColorActive );
	}, [ requestThemeColor, src, themeColorActive ] );
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
				themeDocumentReady.current = false;
				clearThemeColorTimeout();
				pendingProbe.current += 1;
				callbacks.current.onAdminBarVisibilityChange?.( null );
				callbacks.current.onLoadingChange?.( true );
				return;
			}
			if ( event.data?.type === 'studio:preview:theme-color' ) {
				const { color, navigationId: reportedNavigationId } = event.data;
				if (
					themeColorActiveRef.current &&
					themeDocumentReady.current &&
					reportedNavigationId === navigationId.current &&
					( color === null || ( typeof color === 'string' && /^#[\da-f]{6}$/i.test( color ) ) )
				) {
					clearThemeColorTimeout();
					callbacks.current.onThemeColorChange?.( color );
				}
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
	}, [ clearThemeColorTimeout ] );

	return (
		<iframe
			ref={ ref }
			className={ styles.iframe }
			src={ src }
			title={ title }
			onLoad={ ( event ) => {
				callbacks.current.onAdminBarVisibilityChange?.( null );
				navigationId.current += 1;
				themeDocumentReady.current = true;
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
				if ( themeColorActiveRef.current ) {
					requestThemeColor( true );
				}
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
