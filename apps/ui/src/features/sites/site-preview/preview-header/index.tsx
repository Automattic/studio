import { __ } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { useTrafficLightSpace } from '@/data/host/use-traffic-light-space';
import { useWindowControlsInset } from '@/data/host/use-window-controls-inset';
import { useSidebarCollapsed } from '@/data/use-sidebar-collapsed';
import { SiteHeaderSpace, useSiteHeader } from '@/features/sites/site-header-actions';
import { PreviewAddressBar, type PreviewRealm } from '@/features/sites/site-preview/address-bar';
import { RotateCwIcon } from '@/lib/icons';
import { IconButton } from '@/lib/ui';
import { AnnotateButton } from './annotate-button';
import { BrowserHistoryButton } from './browser-history-button';
import styles from './style.module.css';
import type { SiteDetails } from '@/data/core';
import type { BrowserNavigationState } from '@/features/sites/site-preview/browser-state';
import type { useBrowserShortcuts } from '@/features/sites/site-preview/use-browser-shortcuts';
import type { BrowserShortcutCommand } from '@studio/common/ai/inspector/page-script';
import type { ComponentProps, ReactNode } from 'react';

interface PreviewHeaderProps {
	site: SiteDetails;
	siteUrl: string;
	path: string;
	live: boolean;
	canPreview: boolean;
	isStarting: boolean;
	isStopping: boolean;
	collapsed: boolean;
	toolbarStart?: ReactNode;
	atWindowStart: boolean;
	browserState: BrowserNavigationState;
	shortcuts: ReturnType< typeof useBrowserShortcuts >;
	onBrowserCommand: ( command: BrowserShortcutCommand ) => void;
	onJump: ( historyIndex: number ) => void;
	onPathChange?: ( path: string ) => void;
	onSwitchRealm: ( realm: PreviewRealm ) => void;
	hasDesignSystem: boolean;
	onOpenExternal?: () => void;
	onOpenSettings?: () => void;
	annotate?: Omit< ComponentProps< typeof AnnotateButton >, 'iconOnly' >;
	// Page-load progress, while a page is loading or just loaded.
	progress?: number;
}

export function PreviewHeader( {
	site,
	siteUrl,
	path,
	live,
	canPreview,
	isStarting,
	isStopping,
	collapsed,
	toolbarStart,
	atWindowStart,
	browserState,
	shortcuts,
	onBrowserCommand,
	onJump,
	onPathChange,
	onSwitchRealm,
	hasDesignSystem,
	onOpenExternal,
	onOpenSettings,
	annotate,
	progress,
}: PreviewHeaderProps ) {
	const trafficLightSpace = useTrafficLightSpace();
	const sidebarCollapsed = useSidebarCollapsed();
	const windowControlsInset = useWindowControlsInset( 'toolbar' );
	const { host: headerHost, layout: headerLayout } = useSiteHeader();

	return (
		<div
			data-site-header
			className={ clsx(
				styles.header,
				atWindowStart && sidebarCollapsed && trafficLightSpace.start && styles.headerTrafficLights
			) }
			style={ {
				// In RTL the preview pane sits at the physical left, so the
				// header's end-side controls land under the macOS traffic
				// lights — pad past them.
				...( trafficLightSpace.end && { paddingInlineEnd: 96 } ),
				...( windowControlsInset > 0 && {
					paddingRight: windowControlsInset + 8,
				} ),
			} }
		>
			{ /* Browser navigation stays at the start, the address field fills the
				available middle track, and preview actions stay at the end. */ }
			<div className={ styles.headerSide }>
				{ toolbarStart ? (
					<div data-site-header-reserved className={ styles.toolbarStart }>
						{ toolbarStart }
					</div>
				) : null }
				{ canPreview ? (
					<div
						data-site-header-navigation
						className={ clsx(
							styles.navigation,
							headerLayout === 'navigation-overflow' && styles.navigationHidden
						) }
						aria-hidden={ headerLayout === 'navigation-overflow' || undefined }
						inert={ headerLayout === 'navigation-overflow' }
					>
						<BrowserHistoryButton
							direction="back"
							browserState={ browserState }
							shortcut={ shortcuts.back }
							disabled={ isStopping }
							onStep={ () => onBrowserCommand( 'back' ) }
							onJump={ onJump }
						/>
						<BrowserHistoryButton
							direction="forward"
							browserState={ browserState }
							shortcut={ shortcuts.forward }
							disabled={ isStopping }
							onStep={ () => onBrowserCommand( 'forward' ) }
							onJump={ onJump }
						/>
						<IconButton
							icon={ <RotateCwIcon /> }
							label={ __( 'Reload preview' ) }
							shortcut={ shortcuts.reload }
							tooltipSide="bottom"
							disabled={ isStopping }
							onClick={ () => onBrowserCommand( 'reload' ) }
						/>
					</div>
				) : null }
			</div>
			<div
				className={ clsx(
					styles.browserLocation,
					headerLayout === 'inline' && styles.browserLocationInline
				) }
				data-site-header-address={ ( canPreview && ! isStarting && ! isStopping ) || undefined }
			>
				{ isStarting || isStopping ? (
					<span role="status" className={ styles.addressStatus }>
						{ isStopping ? __( 'Stopping site…' ) : __( 'Starting site…' ) }
					</span>
				) : canPreview ? (
					<PreviewAddressBar
						site={ site }
						siteUrl={ siteUrl }
						path={ path }
						remote={ live }
						onNavigate={ ( nextPath ) => onPathChange?.( nextPath ) }
						onSwitchRealm={ onSwitchRealm }
						hasDesignSystem={ hasDesignSystem }
						onOpenExternal={ onOpenExternal }
						onOpenSettings={ onOpenSettings }
						hideActions={ headerLayout !== 'inline' }
					/>
				) : null }
			</div>
			<div className={ styles.headerSide }>
				{ annotate ? (
					<span data-site-header-annotate className={ styles.headerItem }>
						<AnnotateButton { ...annotate } iconOnly={ headerLayout !== 'inline' } />
					</span>
				) : null }
				{ headerHost === 'preview' && ! collapsed ? <SiteHeaderSpace /> : null }
			</div>
			{ progress !== undefined ? (
				<div className={ styles.loadingProgress } aria-hidden="true">
					<span style={ { transform: `scaleX(${ Math.min( progress, 1 ) })` } } />
				</div>
			) : null }
		</div>
	);
}
