import { __ } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { ResizeHandle, ResizeOverlay } from '@/components/resize-handle';
import { usePreviewSplit } from '@/hooks/use-preview-split';
import { useSidebarCollapsed } from '@/hooks/use-sidebar-collapsed';
import styles from './style.module.css';

// Keep in sync with the content-column transition duration in style.module.css.
const PREVIEW_TOGGLE_DURATION = 150;

export interface PreviewSplitFramePreviewProps {
	collapsed: boolean;
}

interface PreviewSplitFrameProps {
	// The preview panel content. Kept mounted while closed so the webview stays
	// warm. The split geometry is owned by usePreviewSplit; this component only
	// handles the open/close slide animation.
	preview?: ( props: PreviewSplitFramePreviewProps ) => ReactNode;
	previewOpen?: boolean;
	// Full preview: the preview takes the whole frame and the content column
	// collapses to zero width (kept mounted so chat state survives).
	previewFullscreen?: boolean;
	children?: ReactNode;
}

export function PreviewSplitFrame( {
	preview,
	previewOpen = false,
	previewFullscreen = false,
	children,
}: PreviewSplitFrameProps ) {
	const showPreview = previewOpen && preview != null;
	const showFullscreen = showPreview && previewFullscreen;
	const { rootRef, contentWidthVar, isResizing, handleProps } = usePreviewSplit( { showPreview } );
	const isSidebarCollapsed = useSidebarCollapsed();

	// Animate only open/close/fullscreen toggles of an already-mounted preview —
	// never the initial layout, so a route loading with the preview visible
	// doesn't replay the slide-in. The render-phase update lands the transition
	// class in the same commit as the width change; an effect-based update would
	// race it.
	const [ animatingPreviewToggle, setAnimatingPreviewToggle ] = useState( false );
	const [ previousPreview, setPreviousPreview ] = useState( {
		mounted: preview != null,
		open: showPreview,
		fullscreen: showFullscreen,
	} );
	if (
		previousPreview.mounted !== ( preview != null ) ||
		previousPreview.open !== showPreview ||
		previousPreview.fullscreen !== showFullscreen
	) {
		setPreviousPreview( {
			mounted: preview != null,
			open: showPreview,
			fullscreen: showFullscreen,
		} );
		if ( previousPreview.mounted && preview != null ) {
			setAnimatingPreviewToggle( true );
		}
	}

	useEffect( () => {
		if ( ! animatingPreviewToggle ) {
			return;
		}
		const timeoutId = window.setTimeout(
			() => setAnimatingPreviewToggle( false ),
			PREVIEW_TOGGLE_DURATION
		);
		return () => window.clearTimeout( timeoutId );
	}, [ animatingPreviewToggle, showPreview, showFullscreen ] );

	const previewVisible = showPreview || animatingPreviewToggle;
	const renderedPreview = preview?.( { collapsed: ! previewVisible } );
	const rootStyle = {
		// Fullscreen collapses the content column; the split geometry keeps its
		// last width so leaving fullscreen restores the previous split.
		'--preview-frame-content-width': showFullscreen ? '0px' : contentWidthVar,
	} as CSSProperties;
	// Keep the zero-width column visible while it animates shut, then hide it
	// so the (still mounted) chat can't be reached by focus or a screen reader.
	const contentHidden = showFullscreen && ! animatingPreviewToggle;

	return (
		<div
			ref={ rootRef }
			className={ clsx(
				styles.root,
				isSidebarCollapsed && styles.rootFrameless,
				showPreview && styles.rootPreviewOpen,
				isResizing && styles.rootPreviewResizing,
				animatingPreviewToggle && styles.rootPreviewAnimating
			) }
			style={ rootStyle }
		>
			<div
				className={ clsx( styles.contentColumn, contentHidden && styles.contentColumnHidden ) }
				aria-hidden={ contentHidden || undefined }
			>
				{ children }
			</div>
			{ preview ? (
				<div
					className={ clsx(
						styles.previewSlot,
						previewVisible && styles.previewSlotVisible,
						showPreview && styles.previewSlotInteractive
					) }
					aria-hidden={ ! showPreview }
				>
					{ renderedPreview }
				</div>
			) : null }
			{ showPreview && ! showFullscreen && ! animatingPreviewToggle ? (
				<ResizeHandle
					className={ styles.previewResizeHandle }
					label={ __( 'Resize site preview' ) }
					{ ...handleProps }
				/>
			) : null }
			{ isResizing ? <ResizeOverlay /> : null }
		</div>
	);
}
