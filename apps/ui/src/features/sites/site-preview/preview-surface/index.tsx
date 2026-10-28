import {
	INSPECTOR_PAGE_SCRIPT,
	parseInspectorMessage,
	type InspectorEvent,
} from '@studio/agent/protocol/inspector/page-script';
import { __ } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { useEffect, useRef, useState } from 'react';
import { useConnector } from '@/data/core';
import { useColorScheme } from '@/data/host/use-color-scheme';
import { normalizeDocumentTitle } from '@/features/sites/site-preview/browser-state';
import { GlobeIcon } from '@/lib/icons';
import { Button, Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/lib/ui';
import { buildInspectorCommandScript } from './inspector-command';
import styles from './style.module.css';
import type { SiteAnnotations } from '@/features/annotations';
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
	children,
}: {
	active: boolean;
	loading?: boolean;
	design?: boolean;
	children: ReactNode;
} ) {
	return (
		<div
			className={ clsx( styles.realmLayer, ! active && styles.realmLayerHidden ) }
			data-loading={ loading || undefined }
			inert={ active ? undefined : true }
		>
			<div className={ clsx( styles.surfaceFrame, design && styles.designSurface ) }>
				{ children }
			</div>
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
	inspector = false,
	annotations,
	onInspectorReady,
	onInspectorEvent,
}: {
	src: string;
	title: string;
	onLoad: ( src: string ) => void;
	// Whether the server answered for the page, once asked.
	onSettle: ( src: string, title: string | null, failed: boolean ) => void;
	inspector?: boolean;
	annotations?: SiteAnnotations;
	onInspectorReady?: ( ready: boolean ) => void;
	onInspectorEvent?: ( event: InspectorEvent ) => void;
} ) {
	const connector = useConnector();
	const ref = useRef< HTMLIFrameElement | null >( null );
	const [ frame, setFrame ] = useState< { run( script: string ): void } | null >( null );
	const [ inspectorReady, setInspectorReady ] = useState( false );
	const listenersRef = useRef( { onInspectorReady, onInspectorEvent } );
	useEffect( () => {
		listenersRef.current = { onInspectorReady, onInspectorEvent };
	}, [ onInspectorReady, onInspectorEvent ] );

	useEffect( () => {
		const iframe = ref.current;
		if ( ! inspector || ! iframe || ! connector.connectPreviewFrame ) return;
		const connection = connector.connectPreviewFrame( iframe, {
			onPage() {
				connection.run( INSPECTOR_PAGE_SCRIPT );
				setInspectorReady( true );
				listenersRef.current.onInspectorReady?.( true );
			},
			onLog( message ) {
				const event = parseInspectorMessage( message, iframe.getBoundingClientRect() );
				if ( event ) listenersRef.current.onInspectorEvent?.( event );
			},
		} );
		setFrame( connection );
		return () => {
			connection.dispose();
			setFrame( null );
			setInspectorReady( false );
			listenersRef.current.onInspectorReady?.( false );
		};
	}, [ connector, inspector ] );

	// Mirrors the notes into the page, in the theme's accent.
	const colorScheme = useColorScheme();
	useEffect( () => {
		if ( inspectorReady && frame && annotations && ref.current ) {
			frame.run( buildInspectorCommandScript( annotations, ref.current ) );
		}
	}, [ annotations, colorScheme, frame, inspectorReady ] );

	return (
		<iframe
			ref={ ref }
			className={ styles.iframe }
			src={ src }
			title={ title }
			onLoad={ ( event ) => {
				const { src: loadedSrc } = event.currentTarget;
				const pageTitle = getIframeTitle( event.currentTarget );
				onLoad( loadedSrc );
				// A frame fires `load` for the browser's own error page too, and
				// it's cross-origin, so ask the server whether it's there at all.
				void fetch( loadedSrc, {
					method: 'HEAD',
					mode: 'no-cors',
					cache: 'no-store',
				} )
					.then(
						() => false,
						() => true
					)
					.then( ( failed ) => onSettle( loadedSrc, pageTitle, failed ) );
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
