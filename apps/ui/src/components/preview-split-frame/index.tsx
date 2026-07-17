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
	children?: ReactNode;
}

export function PreviewSplitFrame( {
	preview,
	previewOpen = false,
	children,
}: PreviewSplitFrameProps ) {
	const showPreview = previewOpen && preview != null;
	const { rootRef, contentWidthVar, isResizing, handleProps } = usePreviewSplit( { showPreview } );
	const isSidebarCollapsed = useSidebarCollapsed();

	// Animate only open/close toggles of an already-mounted preview — never the
	// initial layout, so a route loading with the preview visible doesn't replay
	// the slide-in. The render-phase update lands the transition class in the
	// same commit as the width change; an effect-based update would race it.
	const [ animatingPreviewToggle, setAnimatingPreviewToggle ] = useState( false );
	const [ previousPreview, setPreviousPreview ] = useState( {
		mounted: preview != null,
		open: showPreview,
	} );
	if ( previousPreview.mounted !== ( preview != null ) || previousPreview.open !== showPreview ) {
		setPreviousPreview( { mounted: preview != null, open: showPreview } );
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
	}, [ animatingPreviewToggle, showPreview ] );

	const previewVisible = showPreview || animatingPreviewToggle;
	const renderedPreview = preview?.( { collapsed: ! previewVisible } );
	const rootStyle = {
		'--preview-frame-content-width': contentWidthVar,
	} as CSSProperties;

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
			<div className={ styles.contentColumn }>{ children }</div>
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
			{ showPreview && ! animatingPreviewToggle ? (
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
