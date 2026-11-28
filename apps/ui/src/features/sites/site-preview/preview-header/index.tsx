import { IconButton, VisuallyHidden } from '@studio/ds';
import { RotateCwIcon } from '@studio/ds/icons';
import { __ } from '@wordpress/i18n';
import { useLayoutEffect, useRef, useState } from 'react';
import { useWindowControlsInset } from '@/data/host/use-window-controls-inset';
import { useOpenSettings } from '@/data/use-open-settings';
import { PreviewAddressBar } from '@/features/sites/site-preview/address-bar';
import { BrowserHistoryButton } from './browser-history-button';
import {
	BrowserMenu,
	type PreviewBrowserActions,
	type PreviewResponsiveActions,
	type PreviewScreenshotActions,
} from './browser-menu';
import styles from './style.module.css';
import type { SiteDetails } from '@/data/core';
import type { useFrontendAdminBar } from '@/data/queries/use-frontend-admin-bar';
import type { BrowserNavigationState } from '@/features/sites/site-preview/browser-state';
import type { useBrowserShortcuts } from '@/features/sites/site-preview/use-browser-shortcuts';
import type { BrowserShortcutCommand } from '@studio/agent/protocol/inspector/page-script';
import type { ReactNode } from 'react';

interface PreviewHeaderProps {
	site: SiteDetails;
	siteUrl: string;
	path: string;
	live: boolean;
	canPreview: boolean;
	isStarting: boolean;
	isRestarting?: boolean;
	isStopping: boolean;
	browserState: BrowserNavigationState;
	shortcuts: ReturnType< typeof useBrowserShortcuts >;
	onBrowserCommand: ( command: BrowserShortcutCommand ) => void;
	onJump: ( historyIndex: number ) => void;
	onPathChange?: ( path: string ) => void;
	onOpenExternal?: () => void;
	browserActions?: PreviewBrowserActions;
	adminBarActions?: ReturnType< typeof useFrontendAdminBar >;
	onExternalNavigate?: ( url: string ) => void;
	responsive?: PreviewResponsiveActions;
	screenshot?: PreviewScreenshotActions;
	annotation?: ReactNode;
	closeTab?: ReactNode;
}

export function PreviewHeader( {
	site,
	siteUrl,
	path,
	live,
	canPreview,
	isStarting,
	isRestarting = false,
	isStopping,
	browserState,
	shortcuts,
	onBrowserCommand,
	onJump,
	onPathChange,
	onOpenExternal,
	browserActions,
	adminBarActions,
	onExternalNavigate,
	responsive,
	screenshot,
	annotation,
	closeTab,
}: PreviewHeaderProps ) {
	const headerRef = useRef< HTMLDivElement >( null );
	const [ compact, setCompact ] = useState( false );
	useLayoutEffect( () => {
		const header = headerRef.current;
		if ( ! header ) return;
		const measure = () => {
			if ( header.clientWidth > 0 ) setCompact( header.clientWidth <= 540 );
		};
		const observer = new ResizeObserver( measure );
		observer.observe( header );
		window.addEventListener( 'resize', measure );
		measure();
		return () => {
			observer.disconnect();
			window.removeEventListener( 'resize', measure );
		};
	}, [] );
	const windowControlsInset = useWindowControlsInset( 'toolbar' );
	const openSettings = useOpenSettings();
	const disabled = ! canPreview || isStarting || isStopping;

	const addressBar = (
		<PreviewAddressBar
			site={ site }
			siteUrl={ siteUrl }
			path={ path }
			remote={ live }
			onNavigate={ ( nextPath ) => onPathChange?.( nextPath ) }
			pageTitle={ browserState.title }
			loading={ browserState.loading }
			compact={ compact }
			onOpenExternal={ onOpenExternal }
			onOpenSiteSettings={ live ? undefined : () => openSettings( 'site', site.id ) }
			onExternalNavigate={ onExternalNavigate }
			disabled={ ! canPreview || isStarting || isStopping }
		/>
	);

	return (
		<div
			ref={ headerRef }
			data-preview-browser-controls
			data-site-header-layout={ compact ? 'mobile-overflow' : 'inline' }
			className={ styles.header }
			style={
				windowControlsInset
					? {
							paddingRight: `calc(var(--band-inset) + ${ windowControlsInset }px)`,
					  }
					: undefined
			}
			role="toolbar"
			aria-label={ __( 'Preview browser controls' ) }
		>
			{ isStarting || isStopping ? (
				<VisuallyHidden role="status">
					{ isRestarting
						? __( 'Restarting site…' )
						: isStopping
						? __( 'Stopping site…' )
						: __( 'Starting site…' ) }
				</VisuallyHidden>
			) : null }
			<div className={ styles.headerSide }>
				<div data-site-header-navigation className={ styles.navigation }>
					<BrowserHistoryButton
						direction="back"
						browserState={ browserState }
						shortcut={ shortcuts.back }
						disabled={ disabled }
						onStep={ () => onBrowserCommand( 'back' ) }
						onJump={ onJump }
					/>
					<span hidden={ compact && ! browserState.canGoForward }>
						<BrowserHistoryButton
							direction="forward"
							browserState={ browserState }
							shortcut={ shortcuts.forward }
							disabled={ disabled }
							onStep={ () => onBrowserCommand( 'forward' ) }
							onJump={ onJump }
						/>
					</span>
					<IconButton
						size="icon-sm"
						icon={ <RotateCwIcon /> }
						label={ __( 'Reload' ) }
						shortcut={ shortcuts.reload }
						tooltipSide="bottom"
						disabled={ disabled }
						variant="ghost"
						onClick={ () => onBrowserCommand( 'reload' ) }
					/>
				</div>
			</div>
			<div className={ styles.browserLocation } data-site-header-address>
				{ addressBar }
			</div>
			<div className={ styles.headerSide }>
				{ annotation }
				{ canPreview && ( browserActions || adminBarActions || responsive || screenshot ) ? (
					<BrowserMenu
						actions={ browserActions }
						adminBar={ adminBarActions }
						responsive={ responsive }
						screenshot={ screenshot }
						disabled={ disabled }
					/>
				) : null }
				{ closeTab }
			</div>
		</div>
	);
}
