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
import type { BrowserShortcutCommand } from '@studio/agent/protocol/inspector/page-script';
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
	hasDatabase: boolean;
	onOpenExternal?: () => void;
	responsive?: { active: boolean; disabled: boolean; onClick: () => void };
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
	hasDatabase,
	onOpenExternal,
	responsive,
	annotate,
	progress,
}: PreviewHeaderProps ) {
	const trafficLightSpace = useTrafficLightSpace();
	const sidebarCollapsed = useSidebarCollapsed();
	const windowControlsInset = useWindowControlsInset( 'toolbar' );
	const { host: headerHost, layout: headerLayout } = useSiteHeader();

	const addressBar = (
		<PreviewAddressBar
			site={ site }
			siteUrl={ siteUrl }
			path={ path }
			remote={ live }
			onNavigate={ ( nextPath ) => onPathChange?.( nextPath ) }
			onSwitchRealm={ onSwitchRealm }
			hasDesignSystem={ hasDesignSystem }
			hasDatabase={ hasDatabase }
			onOpenExternal={ onOpenExternal }
			responsive={ responsive }
			hideActions={ headerLayout !== 'inline' }
		/>
	);

	return (
		<div
			data-site-header
			data-site-header-layout={ headerLayout }
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
			{ toolbarStart ? (
				<div
					data-site-header-reserved
					data-site-header-split-start
					className={ styles.toolbarStart }
				>
					{ toolbarStart }
				</div>
			) : null }
			<div className={ styles.headerSide }>
				{ canPreview ? (
					<div
						data-site-header-navigation
						className={ clsx(
							styles.navigation,
							( headerLayout === 'navigation-overflow' || headerLayout === 'mobile-overflow' ) &&
								styles.navigationHidden
						) }
						aria-hidden={
							headerLayout === 'navigation-overflow' ||
							headerLayout === 'mobile-overflow' ||
							undefined
						}
						inert={ headerLayout === 'navigation-overflow' || headerLayout === 'mobile-overflow' }
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
					headerLayout !== 'mobile-overflow' ? (
						addressBar
					) : null
				) : null }
			</div>
			<div className={ styles.headerSide }>
				{ annotate ? (
					<span
						data-site-header-annotate
						className={ styles.headerItem }
						hidden={ headerLayout === 'mobile-overflow' }
					>
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
