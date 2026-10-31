import { __, isRTL } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { WindowControlsCornerContext } from '@/data/host/use-window-controls-inset';
import { PREVIEW_SPLIT_MIN_WIDTH } from '@/data/resizable-panels';
import { useSidebarCollapsed } from '@/data/use-sidebar-collapsed';
import { getMotionDuration } from '@/lib/theme';
import { ResizeHandle, ResizeOverlay } from '@/lib/ui';
import styles from './style.module.css';
import { usePreviewSplit } from './use-preview-split';

export interface PreviewSplitFramePreviewProps {
	collapsed: boolean;
}

interface PreviewSplitFrameProps {
	siteId?: string;
	navigationKey?: string;
	header?: ReactNode;
	// The preview panel content. Kept mounted while closed so the webview stays
	// warm. The split geometry is owned by usePreviewSplit; this component only
	// handles layout transitions.
	preview?: ( props: PreviewSplitFramePreviewProps ) => ReactNode;
	previewOpen?: boolean;
	previewLoading?: boolean;
	// The preview fills the frame over the hidden chat; the sidebar stays.
	chatHidden?: boolean;
	// Open or close without the slide, as when a stopping site drops its preview.
	instant?: boolean;
	children?: ReactNode;
}

export function PreviewSplitFrame( {
	siteId,
	navigationKey,
	header,
	preview,
	previewOpen = false,
	previewLoading = false,
	chatHidden = false,
	instant = false,
	children,
}: PreviewSplitFrameProps ) {
	const showPreview = previewOpen && preview != null;
	const contentCollapsed = showPreview && chatHidden;
	const { rootRef, containerWidth, contentWidthVar, isResizing, handleProps } = usePreviewSplit( {
		showPreview,
		siteId,
	} );
	const isSidebarCollapsed = useSidebarCollapsed();
	const resizable = ( containerWidth ?? Infinity ) >= PREVIEW_SPLIT_MIN_WIDTH;

	// Animate layout changes of an already-mounted preview —
	// never the initial layout, so a route loading with the preview visible
	// doesn't replay the slide-in. The render-phase update lands the transition
	// class in the same commit as the width change; an effect-based update would
	// race it.
	const [ animatingPreviewToggle, setAnimatingPreviewToggle ] = useState( false );
	const [ fadingPreview, setFadingPreview ] = useState( false );
	if ( instant && animatingPreviewToggle ) setAnimatingPreviewToggle( false );
	const [ previousPreview, setPreviousPreview ] = useState( {
		siteId,
		navigationKey,
		mounted: preview != null,
		open: showPreview,
		loading: previewLoading,
		collapsed: contentCollapsed,
	} );
	if (
		previousPreview.siteId !== siteId ||
		previousPreview.navigationKey !== navigationKey ||
		previousPreview.mounted !== ( preview != null ) ||
		previousPreview.loading !== previewLoading ||
		previousPreview.open !== showPreview ||
		previousPreview.collapsed !== contentCollapsed
	) {
		setPreviousPreview( {
			siteId,
			navigationKey,
			mounted: preview != null,
			open: showPreview,
			loading: previewLoading,
			collapsed: contentCollapsed,
		} );
		const toggled =
			previousPreview.open !== showPreview || previousPreview.collapsed !== contentCollapsed;
		setFadingPreview( previousPreview.loading && ! previousPreview.open && showPreview );
		setAnimatingPreviewToggle(
			toggled &&
				previousPreview.siteId === siteId &&
				previousPreview.navigationKey === navigationKey &&
				previousPreview.mounted &&
				preview != null &&
				! instant
		);
	}

	// Keep the outgoing site in the closing pane until it is hidden.
	const [ lastVisiblePreview, setLastVisiblePreview ] = useState( () => preview );
	if ( showPreview && lastVisiblePreview !== preview ) {
		setLastVisiblePreview( () => preview );
	}

	useEffect( () => {
		if ( ! animatingPreviewToggle ) {
			return;
		}
		const timeoutId = window.setTimeout(
			() => {
				setAnimatingPreviewToggle( false );
			},
			getMotionDuration( fadingPreview ? 'surface' : 'layout' )
		);
		return () => window.clearTimeout( timeoutId );
	}, [
		animatingPreviewToggle,
		fadingPreview,
		siteId,
		navigationKey,
		showPreview,
		contentCollapsed,
	] );

	const previewVisible = showPreview || animatingPreviewToggle;
	const renderPreview = ! showPreview && animatingPreviewToggle ? lastVisiblePreview : preview;
	const renderedPreview = renderPreview?.( { collapsed: ! showPreview } );
	const rootStyle = {
		'--preview-frame-content-width': contentWidthVar,
		'--preview-frame-visible-content-width': contentCollapsed ? '0px' : contentWidthVar,
		'--preview-header-content-width': showPreview && ! contentCollapsed ? contentWidthVar : '0px',
	} as CSSProperties;
	// The preview covers the chat as it closes; keep its layout intact underneath.
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
					header && styles.rootWithHeader,
					showPreview && styles.rootPreviewOpen,
					isResizing && styles.rootPreviewResizing,
					animatingPreviewToggle &&
						( fadingPreview ? styles.rootPreviewFading : styles.rootPreviewAnimating ),
					showPreview && ! contentCollapsed && ! animatingPreviewToggle && styles.rootEdge
				) }
				style={ rootStyle }
			>
				{ header }
				<div
					className={ clsx(
						styles.contentColumn,
						contentCollapsed && styles.contentColumnCollapsed,
						contentHidden && styles.contentColumnHidden
					) }
					aria-hidden={ contentHidden || undefined }
					inert={ contentCollapsed }
				>
					<WindowControlsCornerContext.Provider value={ contentInCorner }>
						{ children }
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
						inert={ ! showPreview }
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
			</div>
		</>
	);
}
