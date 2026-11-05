import { __ } from '@wordpress/i18n';
import { isAppleOS } from '@wordpress/keycodes';
import { clsx } from 'clsx';
import { useEffect, useRef } from 'react';
import { normalizeDocumentTitle } from '@/features/sites/site-preview/browser-state';
import { GlobeIcon } from '@/lib/icons';
import { Button, Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/lib/ui';
import { ResponsiveViewport } from '../responsive-preview/viewport';
import styles from './style.module.css';
import type { ResponsivePreviewSettings } from '@/data/responsive-preview';
import type { BrowserCommand } from '@/features/sites/site-preview/browser-state';
import type { ReactNode } from 'react';

export { WebviewSurface } from './webview-surface';
export { isElectron } from './webview';

// One stacked layer per mounted surface. Only the active layer is visible; the
// other stays mounted and laid out at its own size, so coming back to it is a
// reload with nothing to resize or re-emulate.
export function SurfaceLayer( {
	active,
	loading,
	design,
	responsive,
	children,
}: {
	active: boolean;
	loading?: boolean;
	design?: boolean;
	responsive?: { siteId: string; settings: ResponsivePreviewSettings; scale: number };
	children: ReactNode;
} ) {
	return (
		<div
			className={ clsx( styles.realmLayer, ! active && styles.realmLayerHidden ) }
			data-loading={ loading || undefined }
			inert={ active ? undefined : true }
		>
			<ResponsiveViewport { ...responsive }>
				<div className={ clsx( styles.surfaceFrame, design && styles.designSurface ) }>
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

// Non-Electron fallback: plain iframe, no inspector. Reloads by remounting;
// back/forward aren't reachable from the host.
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
} ) {
	const frame = useRef< HTMLIFrameElement >( null );
	const callbacks = useRef( { onAdminBarVisibilityChange, onNavigate, onLoadingChange, onSettle } );
	const navigationId = useRef( 0 );
	const pendingProbe = useRef( 0 );
	useEffect( () => {
		callbacks.current = { onAdminBarVisibilityChange, onNavigate, onLoadingChange, onSettle };
	}, [ onAdminBarVisibilityChange, onNavigate, onLoadingChange, onSettle ] );
	useEffect( () => {
		if ( browserCommand?.type !== 'login' && browserCommand?.type !== 'read-admin-bar' ) return;
		frame.current?.contentWindow?.postMessage(
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
			const iframe = frame.current;
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
				callbacks.current.onSettle( url, normalizeDocumentTitle( title ), false );
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
			ref={ frame }
			className={ styles.iframe }
			src={ src }
			title={ title }
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
		<Empty className={ styles.loadFailed }>
			<EmptyHeader>
				<EmptyMedia>
					<GlobeIcon />
				</EmptyMedia>
				<EmptyTitle>{ __( 'Preview could not load' ) }</EmptyTitle>
				<EmptyDescription>
					{ __( 'Check that your site is running, then try again.' ) }
				</EmptyDescription>
			</EmptyHeader>
			<Button variant="outline" onClick={ onRetry }>
				{ __( 'Try again' ) }
			</Button>
		</Empty>
	);
}
