import { __, isRTL } from '@wordpress/i18n';
import { clsx } from 'clsx';
import {
	createContext,
	useContext,
	useEffect,
	useState,
	type CSSProperties,
	type ReactNode,
} from 'react';
import { ResizeHandle, ResizeOverlay } from '@/components/resize-handle';
import { useSidebarCollapsed } from '@/hooks/use-sidebar-collapsed';
import { WindowControlsCornerContext } from '@/hooks/use-window-controls-inset';
import { PREVIEW_SPLIT_MIN_WIDTH } from '@/lib/resizable-panels';
import { getMotionDuration } from '@/lib/theme/motion';
import styles from './style.module.css';
import { usePreviewSplit } from './use-preview-split';

// Keep in sync with the content-column transition duration in style.module.css.

// Whether the preview shows beside the content, for controls in the content
// column that only make sense next to it.
const PreviewBesideContext = createContext( false );

export function usePreviewBeside(): boolean {
	return useContext( PreviewBesideContext );
}

export interface PreviewSplitFramePreviewProps {
	collapsed: boolean;
}

interface PreviewSplitFrameProps {
	// The preview panel content. Kept mounted while closed so the webview stays
	// warm. The split geometry is owned by usePreviewSplit; this component only
	// handles the open/close slide animation.
	preview?: ( props: PreviewSplitFramePreviewProps ) => ReactNode;
	previewOpen?: boolean;
	// The chat is hidden: the content column collapses the same way, while the
	// sidebar stays.
	chatHidden?: boolean;
	// Drawn over the top inline-end corner, above whichever pane is there.
	actions?: ReactNode;
	// Open or close without the slide, as when a stopping site drops its preview.
	instant?: boolean;
	children?: ReactNode;
}

export function PreviewSplitFrame( {
	preview,
	previewOpen = false,
	chatHidden = false,
	actions,
	instant = false,
	children,
}: PreviewSplitFrameProps ) {
	const showPreview = previewOpen && preview != null;
	const contentCollapsed = showPreview && chatHidden;
	const { rootRef, containerWidth, contentWidthVar, isResizing, handleProps } = usePreviewSplit( {
		showPreview,
	} );
	const isSidebarCollapsed = useSidebarCollapsed();
	const resizable = ( containerWidth ?? Infinity ) >= PREVIEW_SPLIT_MIN_WIDTH;

	// Animate only open/close/hide-chat toggles of an already-mounted preview —
	// never the initial layout, so a route loading with the preview visible
	// doesn't replay the slide-in. The render-phase update lands the transition
	// class in the same commit as the width change; an effect-based update would
	// race it.
	const [ animatingPreviewToggle, setAnimatingPreviewToggle ] = useState( false );
	const [ previousPreview, setPreviousPreview ] = useState( {
		mounted: preview != null,
		open: showPreview,
		collapsed: contentCollapsed,
	} );
	if (
		previousPreview.mounted !== ( preview != null ) ||
		previousPreview.open !== showPreview ||
		previousPreview.collapsed !== contentCollapsed
	) {
		setPreviousPreview( {
			mounted: preview != null,
			open: showPreview,
			collapsed: contentCollapsed,
		} );
		if ( previousPreview.mounted && preview != null && ! instant ) {
			setAnimatingPreviewToggle( true );
		}
	}

	useEffect( () => {
		if ( ! animatingPreviewToggle ) {
			return;
		}
		const timeoutId = window.setTimeout(
			() => setAnimatingPreviewToggle( false ),
			getMotionDuration( 'layout' )
		);
		return () => window.clearTimeout( timeoutId );
	}, [ animatingPreviewToggle, showPreview, contentCollapsed ] );

	const previewVisible = showPreview || animatingPreviewToggle;
	const renderedPreview = preview?.( { collapsed: ! previewVisible } );
	const rootStyle = {
		// The collapsed content column keeps the split's last width in the
		// geometry, so showing it again restores the previous split.
		'--preview-frame-content-width': contentCollapsed ? '0px' : contentWidthVar,
	} as CSSProperties;
	// Keep the zero-width column visible while it animates shut, then hide it
	// so the (still mounted) chat can't be reached by focus or a screen reader.
	const contentHidden = contentCollapsed && ! animatingPreviewToggle;
	// Which pane reaches the window's top-right corner. The preview sits at the
	// inline end, so in RTL it only gets there when it fills the frame, and the
	// content only when the sidebar isn't there.
	const contentInCorner =
		! contentCollapsed && ( ! showPreview || ( isRTL() && isSidebarCollapsed ) );
	const previewInCorner = showPreview && ( contentCollapsed || ! isRTL() );

	return (
		<>
			<div
				ref={ rootRef }
				className={ clsx(
					styles.root,
					showPreview && styles.rootPreviewOpen,
					isResizing && styles.rootPreviewResizing,
					animatingPreviewToggle && styles.rootPreviewAnimating,
					showPreview &&
						! contentCollapsed &&
						! animatingPreviewToggle && [ styles.rootEdge, 'studio-column-edge' ]
				) }
				style={ rootStyle }
			>
				<div
					className={ clsx(
						styles.contentColumn,
						contentCollapsed && styles.contentColumnCollapsed,
						contentHidden && styles.contentColumnHidden
					) }
					aria-hidden={ contentHidden || undefined }
				>
					<WindowControlsCornerContext.Provider value={ contentInCorner }>
						<PreviewBesideContext.Provider value={ showPreview && ! contentCollapsed }>
							{ children }
						</PreviewBesideContext.Provider>
					</WindowControlsCornerContext.Provider>
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
						<WindowControlsCornerContext.Provider value={ previewInCorner }>
							{ renderedPreview }
						</WindowControlsCornerContext.Provider>
					</div>
				) : null }
				{ showPreview && ! contentCollapsed && ! animatingPreviewToggle && resizable ? (
					<ResizeHandle
						className={ styles.previewResizeHandle }
						label={ __( 'Resize site preview' ) }
						{ ...handleProps }
					/>
				) : null }
				{ isResizing ? <ResizeOverlay /> : null }
				{ actions }
			</div>
		</>
	);
}
