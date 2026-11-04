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
	// The preview fills the frame over the hidden chat; the sidebar stays.
	chatHidden?: boolean;
	chatTabActive?: boolean;
	// Skip movement when restoring a different workspace.
	instant?: boolean;
	children?: ReactNode;
}

export function PreviewSplitFrame( {
	siteId,
	navigationKey,
	header,
	preview,
	previewOpen = false,
	chatHidden = false,
	chatTabActive = false,
	instant = false,
	children,
}: PreviewSplitFrameProps ) {
	const showPreview = previewOpen && preview != null;
	const contentCollapsed = showPreview && chatHidden;
	const showingChatTab = contentCollapsed && chatTabActive;
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
	if ( instant && animatingPreviewToggle ) setAnimatingPreviewToggle( false );
	const [ previousPreview, setPreviousPreview ] = useState( {
		siteId,
		navigationKey,
		mounted: preview != null,
		open: showPreview,
		collapsed: contentCollapsed,
		chatSelected: showingChatTab,
	} );
	if (
		previousPreview.siteId !== siteId ||
		previousPreview.navigationKey !== navigationKey ||
		previousPreview.mounted !== ( preview != null ) ||
		previousPreview.open !== showPreview ||
		previousPreview.collapsed !== contentCollapsed ||
		previousPreview.chatSelected !== showingChatTab
	) {
		setPreviousPreview( {
			siteId,
			navigationKey,
			mounted: preview != null,
			open: showPreview,
			collapsed: contentCollapsed,
			chatSelected: showingChatTab,
		} );
		const toggled =
			previousPreview.open !== showPreview || previousPreview.collapsed !== contentCollapsed;
		const samePreview =
			previousPreview.siteId === siteId &&
			previousPreview.navigationKey === navigationKey &&
			previousPreview.mounted &&
			preview != null;
		if ( toggled || ! samePreview ) {
			setAnimatingPreviewToggle(
				toggled && samePreview && ! instant && ! ( previousPreview.chatSelected && ! showPreview )
			);
		}
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
		const timeoutId = window.setTimeout( () => {
			setAnimatingPreviewToggle( false );
		}, getMotionDuration( 'layout' ) );
		return () => window.clearTimeout( timeoutId );
	}, [ animatingPreviewToggle, siteId, navigationKey, showPreview, contentCollapsed ] );

	const [ lastExpanded, setLastExpanded ] = useState( contentCollapsed );
	if ( showPreview && lastExpanded !== contentCollapsed ) setLastExpanded( contentCollapsed );
	const previewVisible = ( showPreview || animatingPreviewToggle ) && ! showingChatTab;
	const renderPreview = ! showPreview && animatingPreviewToggle ? lastVisiblePreview : preview;
	const renderedPreview = renderPreview?.( { collapsed: ! showPreview || showingChatTab } );
	const rootStyle = {
		'--preview-layout-duration': animatingPreviewToggle ? 'var(--motion-duration-layout)' : '0ms',
		'--preview-frame-boundary': showPreview
			? contentCollapsed
				? '0px'
				: contentWidthVar
			: '100%',
		'--preview-frame-content-width': contentWidthVar,
		'--preview-frame-visible-content-width': ( showPreview ? contentCollapsed : lastExpanded )
			? '0px'
			: contentWidthVar,
	} as CSSProperties;
	// The preview covers the chat as it closes; keep its layout intact underneath.
	const contentHidden = contentCollapsed && ! animatingPreviewToggle && ! showingChatTab;
	// Which pane reaches the window's top-right corner. The preview sits at the
	// inline end, so in RTL it only gets there when it fills the frame, and the
	// content only when the sidebar isn't there.
	const contentInCorner =
		showingChatTab ||
		( ! contentCollapsed && ( ! showPreview || ( isRTL() && isSidebarCollapsed ) ) );
	const previewInCorner = showPreview && ! showingChatTab && ( contentCollapsed || ! isRTL() );

	return (
		<>
			<div
				ref={ rootRef }
				className={ clsx(
					styles.root,
					header && styles.rootWithHeader,
					showPreview && styles.rootPreviewOpen,
					isResizing && styles.rootPreviewResizing,
					animatingPreviewToggle && styles.rootPreviewAnimating,
					showPreview && ! contentCollapsed && styles.rootEdge
				) }
				style={ rootStyle }
				data-layout-moving={ animatingPreviewToggle || undefined }
			>
				{ header }
				<div
					className={ clsx(
						styles.contentColumn,
						contentCollapsed && styles.contentColumnCollapsed,
						showingChatTab && styles.contentColumnFull,
						contentHidden && styles.contentColumnHidden
					) }
					aria-hidden={ contentHidden || undefined }
					inert={ contentCollapsed && ! showingChatTab }
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
							showPreview && ! showingChatTab && styles.previewSlotInteractive
						) }
						aria-hidden={ ! showPreview || showingChatTab }
						inert={ ! showPreview || showingChatTab }
					>
						<WindowControlsCornerContext.Provider value={ previewInCorner }>
							{ renderedPreview }
						</WindowControlsCornerContext.Provider>
					</div>
				) : null }
				{ preview && resizable ? (
					<div
						className={ styles.previewResizeHandle }
						aria-hidden={ ! showPreview || contentCollapsed || animatingPreviewToggle || undefined }
						inert={ ! showPreview || contentCollapsed || animatingPreviewToggle }
					>
						<ResizeHandle
							className={ styles.previewResizeGrip }
							label={ __( 'Resize panel' ) }
							{ ...handleProps }
						/>
					</div>
				) : null }
				{ isResizing ? <ResizeOverlay /> : null }
			</div>
		</>
	);
}
