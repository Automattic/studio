import { __, isRTL } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { WindowControlsCornerContext } from '@/data/host/use-window-controls-inset';
import { PANEL_SPLIT_MIN_WIDTH } from '@/data/resizable-panels';
import { useSidebarCollapsed } from '@/data/use-sidebar-collapsed';
import { getMotionDuration } from '@/lib/theme';
import { ResizeHandle, ResizeOverlay } from '@/lib/ui';
import styles from './style.module.css';
import { usePanelSplit } from './use-panel-split';

export interface PanelSplitFramePanelProps {
	collapsed: boolean;
}

interface PanelSplitFrameProps {
	siteId?: string;
	navigationKey?: string;
	header?: ReactNode;
	// The panel panel content. Kept mounted while closed so the webview stays
	// warm. The split geometry is owned by usePanelSplit; this component only
	// handles layout transitions.
	panel?: ( props: PanelSplitFramePanelProps ) => ReactNode;
	panelOpen?: boolean;
	onPanelClose?: () => void;
	// The panel fills the frame over the hidden chat; the sidebar stays.
	chatHidden?: boolean;
	// Skip movement when restoring a different workspace.
	instant?: boolean;
	children?: ReactNode;
}

export function PanelSplitFrame( {
	siteId,
	navigationKey,
	header,
	panel,
	panelOpen = false,
	onPanelClose,
	chatHidden = false,
	instant = false,
	children,
}: PanelSplitFrameProps ) {
	const showPanel = panelOpen && panel != null;
	const contentCollapsed = showPanel && chatHidden;
	const { rootRef, containerWidth, contentWidthVar, isResizing, handleProps } = usePanelSplit( {
		showPanel,
		siteId,
	} );
	const isSidebarCollapsed = useSidebarCollapsed();
	const resizable = ( containerWidth ?? Infinity ) >= PANEL_SPLIT_MIN_WIDTH;

	// Animate layout changes of an already-mounted panel —
	// never the initial layout, so a route loading with the panel visible
	// doesn't replay the slide-in. The render-phase update lands the transition
	// class in the same commit as the width change; an effect-based update would
	// race it.
	const [ animatingPanelToggle, setAnimatingPanelToggle ] = useState( false );
	if ( instant && animatingPanelToggle ) setAnimatingPanelToggle( false );
	const [ previousPanel, setPreviousPanel ] = useState( {
		siteId,
		navigationKey,
		mounted: panel != null,
		open: showPanel,
		collapsed: contentCollapsed,
	} );
	if (
		previousPanel.siteId !== siteId ||
		previousPanel.navigationKey !== navigationKey ||
		previousPanel.mounted !== ( panel != null ) ||
		previousPanel.open !== showPanel ||
		previousPanel.collapsed !== contentCollapsed
	) {
		setPreviousPanel( {
			siteId,
			navigationKey,
			mounted: panel != null,
			open: showPanel,
			collapsed: contentCollapsed,
		} );
		const toggled =
			previousPanel.open !== showPanel || previousPanel.collapsed !== contentCollapsed;
		const samePanel =
			previousPanel.siteId === siteId &&
			previousPanel.navigationKey === navigationKey &&
			previousPanel.mounted &&
			panel != null;
		if ( toggled || ! samePanel ) {
			setAnimatingPanelToggle( toggled && samePanel && ! instant );
		}
	}

	// Keep the outgoing site in the closing pane until it is hidden.
	const [ lastVisiblePanel, setLastVisiblePanel ] = useState( () => panel );
	if ( showPanel && lastVisiblePanel !== panel ) {
		setLastVisiblePanel( () => panel );
	}

	useEffect( () => {
		if ( ! animatingPanelToggle ) {
			return;
		}
		const timeoutId = window.setTimeout( () => {
			setAnimatingPanelToggle( false );
		}, getMotionDuration( 'layout' ) );
		return () => window.clearTimeout( timeoutId );
	}, [ animatingPanelToggle, siteId, navigationKey, showPanel, contentCollapsed ] );

	const [ lastExpanded, setLastExpanded ] = useState( contentCollapsed );
	if ( showPanel && lastExpanded !== contentCollapsed ) setLastExpanded( contentCollapsed );
	const panelVisible = showPanel || animatingPanelToggle;
	const renderPanel = ! showPanel && animatingPanelToggle ? lastVisiblePanel : panel;
	const renderedPanel = renderPanel?.( { collapsed: ! showPanel } );
	const rootStyle = {
		'--panel-layout-duration': animatingPanelToggle ? 'var(--motion-duration-layout)' : '0ms',
		'--panel-frame-boundary': showPanel ? ( contentCollapsed ? '0px' : contentWidthVar ) : '100%',
		'--panel-frame-content-width': contentWidthVar,
		'--panel-frame-visible-content-width': ( showPanel ? contentCollapsed : lastExpanded )
			? '0px'
			: contentWidthVar,
	} as CSSProperties;
	// The panel covers the chat as it closes; keep its layout intact underneath.
	const contentHidden = contentCollapsed && ! animatingPanelToggle;
	// Which pane reaches the window's top-right corner. The panel sits at the
	// inline end, so in RTL it only gets there when it fills the frame, and the
	// content only when the sidebar isn't there.
	const contentInCorner =
		! contentCollapsed && ( ! showPanel || ( isRTL() && isSidebarCollapsed ) );
	const panelInCorner = showPanel && ( contentCollapsed || ! isRTL() );

	return (
		<>
			<div
				ref={ rootRef }
				className={ clsx(
					styles.root,
					header && styles.rootWithHeader,
					showPanel && styles.rootPanelOpen,
					isResizing && styles.rootPanelResizing,
					animatingPanelToggle && styles.rootPanelAnimating,
					showPanel && ! contentCollapsed && styles.rootEdge
				) }
				style={ rootStyle }
				data-layout-moving={ animatingPanelToggle || undefined }
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
				{ panel ? (
					<div
						className={ clsx(
							styles.panelSlot,
							panelVisible && styles.panelSlotVisible,
							showPanel && styles.panelSlotInteractive
						) }
						aria-hidden={ ! showPanel }
						inert={ ! showPanel }
					>
						<WindowControlsCornerContext.Provider value={ panelInCorner }>
							{ renderedPanel }
						</WindowControlsCornerContext.Provider>
					</div>
				) : null }
				{ panel && resizable ? (
					<div
						className={ styles.panelResizeHandle }
						aria-hidden={ ! showPanel || contentCollapsed || animatingPanelToggle || undefined }
						inert={ ! showPanel || contentCollapsed || animatingPanelToggle }
					>
						<ResizeHandle
							className={ styles.panelResizeGrip }
							label={ __( 'Resize panel' ) }
							{ ...handleProps }
							onDoublePress={ onPanelClose }
						/>
					</div>
				) : null }
				{ isResizing ? <ResizeOverlay /> : null }
			</div>
		</>
	);
}
