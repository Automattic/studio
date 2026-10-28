import { __ } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { normalizeDocumentTitle } from '@/features/sites/site-preview/browser-state';
import { GlobeIcon } from '@/lib/icons';
import { Button, Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/lib/ui';
import { ResponsiveViewport } from '../responsive-preview/viewport';
import styles from './style.module.css';
import type { ResponsivePreviewSettings } from '@/data/responsive-preview';
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
}: {
	src: string;
	title: string;
	onLoad: ( src: string ) => void;
	// Whether the server answered for the page, once asked.
	onSettle: ( src: string, title: string | null, failed: boolean ) => void;
} ) {
	return (
		<iframe
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
