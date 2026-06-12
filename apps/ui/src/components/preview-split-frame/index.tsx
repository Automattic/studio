import { __ } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { ResizeHandle, ResizeOverlay } from '@/components/resize-handle';
import { useResizablePanel } from '@/hooks/use-resizable-panel';
import { PREVIEW_PANEL_CONFIG, PREVIEW_PANEL_STORAGE_KEY } from '@/lib/resizable-panels';
import styles from './style.module.css';

// Keep in sync with the flex-basis transition duration in style.module.css.
const PREVIEW_TOGGLE_DURATION = 150;

interface PreviewSplitFrameProps {
	// The preview panel content. Kept mounted (hidden behind the content
	// column) while `previewOpen` is false so the webview stays warm and the
	// panel can slide in and out.
	preview?: ReactNode;
	previewOpen?: boolean;
	children?: ReactNode;
}

// Splits the frame between the main content column and the site preview. The
// preview slot is pinned to the right edge at its resizable width; the
// content column sits on top of it and shrinks to reveal it, so toggling
// animates by transitioning only the content column's flex-basis while the
// preview keeps a constant width (no mid-animation webview reflow).
export function PreviewSplitFrame( {
	preview,
	previewOpen = false,
	children,
}: PreviewSplitFrameProps ) {
	const previewMounted = preview != null;
	const showPreview = previewMounted && previewOpen;
	const previewResize = useResizablePanel( {
		config: PREVIEW_PANEL_CONFIG,
		edge: 'left',
		storageKey: PREVIEW_PANEL_STORAGE_KEY,
	} );
	// Animate only open/close toggles of an already-mounted preview — never
	// the initial layout, so a route loading with the preview visible doesn't
	// replay the slide-in. The render-phase update makes the transition class
	// land in the same commit as the flex-basis change; an effect-based
	// update would race it.
	const [ animating, setAnimating ] = useState( false );
	const [ previousPreview, setPreviousPreview ] = useState( {
		mounted: previewMounted,
		open: showPreview,
	} );
	if ( previousPreview.mounted !== previewMounted || previousPreview.open !== showPreview ) {
		setPreviousPreview( { mounted: previewMounted, open: showPreview } );
		if ( previousPreview.mounted && previewMounted ) {
			setAnimating( true );
		}
	}
	useEffect( () => {
		if ( ! animating ) {
			return;
		}
		const timeoutId = window.setTimeout( () => setAnimating( false ), PREVIEW_TOGGLE_DURATION );
		return () => window.clearTimeout( timeoutId );
	}, [ animating, showPreview ] );

	const rootStyle = { '--site-preview-width': `${ previewResize.width }px` } as CSSProperties;

	return (
		<div
			className={ clsx(
				styles.root,
				showPreview && styles.rootPreviewOpen,
				animating && styles.rootPreviewAnimating
			) }
			style={ rootStyle }
		>
			<div className={ styles.contentColumn }>{ children }</div>
			{ previewMounted ? (
				<div className={ clsx( styles.previewSlot, showPreview && styles.previewSlotOpen ) }>
					{ preview }
				</div>
			) : null }
			{ showPreview && ! animating ? (
				<ResizeHandle
					className={ styles.previewResizeHandle }
					label={ __( 'Resize site preview' ) }
					minWidth={ previewResize.minWidth }
					maxWidth={ previewResize.maxWidth }
					width={ previewResize.width }
					isResizing={ previewResize.isResizing }
					onResizeStart={ previewResize.handleResizeStart }
					onKeyDown={ previewResize.handleKeyDown }
				/>
			) : null }
			{ previewResize.isResizing ? <ResizeOverlay /> : null }
		</div>
	);
}
