import { __ } from '@wordpress/i18n';
import { SiteHeaderBrowserSpace, useSiteHeader } from '@/features/sites/site-header-actions';
import { PreviewAddressBar, type PreviewRealm } from '@/features/sites/site-preview/address-bar';
import { RotateCwIcon, ResponsiveIcon } from '@/lib/icons';
import { IconButton, VisuallyHidden } from '@/lib/ui';
import { BrowserHistoryButton } from './browser-history-button';
import styles from './style.module.css';
import type { SiteDetails } from '@/data/core';
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
	isStopping: boolean;
	browserState: BrowserNavigationState;
	shortcuts: ReturnType< typeof useBrowserShortcuts >;
	onBrowserCommand: ( command: BrowserShortcutCommand ) => void;
	onJump: ( historyIndex: number ) => void;
	onPathChange?: ( path: string ) => void;
	onSwitchRealm: ( realm: PreviewRealm ) => void;
	hasDesignSystem: boolean;
	onOpenExternal?: () => void;
	annotationControl?: ReactNode;
	responsive?: { active: boolean; disabled: boolean; onClick: () => void };
}

export function PreviewHeader( {
	site,
	siteUrl,
	path,
	live,
	canPreview,
	isStarting,
	isStopping,
	browserState,
	shortcuts,
	onBrowserCommand,
	onJump,
	onPathChange,
	onSwitchRealm,
	hasDesignSystem,
	onOpenExternal,
	responsive,
	annotationControl,
}: PreviewHeaderProps ) {
	const { layout: headerLayout } = useSiteHeader();
	const disabled = ! canPreview || isStarting || isStopping;

	const addressBar = (
		<PreviewAddressBar
			site={ site }
			siteUrl={ siteUrl }
			path={ path }
			remote={ live }
			onNavigate={ ( nextPath ) => onPathChange?.( nextPath ) }
			onSwitchRealm={ onSwitchRealm }
			hasDesignSystem={ hasDesignSystem }
			onOpenExternal={ onOpenExternal }
			disabled={ disabled }
		/>
	);

	return (
		<div
			data-preview-browser-controls
			data-site-header-layout={ headerLayout }
			className={ styles.header }
			role="toolbar"
			aria-label={ __( 'Preview browser controls' ) }
		>
			{ isStarting || isStopping ? (
				<VisuallyHidden role="status">
					{ isStopping ? __( 'Stopping site…' ) : __( 'Starting site…' ) }
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
					<BrowserHistoryButton
						direction="forward"
						browserState={ browserState }
						shortcut={ shortcuts.forward }
						disabled={ disabled }
						onStep={ () => onBrowserCommand( 'forward' ) }
						onJump={ onJump }
					/>
					<IconButton
						size="icon-sm"
						icon={ <RotateCwIcon /> }
						label={ __( 'Reload preview' ) }
						shortcut={ shortcuts.reload }
						tooltipSide="bottom"
						disabled={ disabled }
						onClick={ () => onBrowserCommand( 'reload' ) }
					/>
				</div>
			</div>
			<div className={ styles.browserLocation } data-site-header-address>
				{ headerLayout !== 'mobile-overflow' ? addressBar : null }
			</div>
			<div className={ styles.headerSide }>
				<SiteHeaderBrowserSpace />
				{ responsive || annotationControl ? (
					<div className={ styles.previewActions } data-preview-actions>
						{ annotationControl }
						{ responsive ? (
							<IconButton
								size="icon-sm"
								data-preview-responsive
								icon={ <ResponsiveIcon /> }
								label={ responsive.active ? __( 'Exit responsive mode' ) : __( 'Responsive mode' ) }
								aria-label={ __( 'Responsive mode' ) }
								variant="ghost"
								aria-pressed={ responsive.active }
								disabled={ responsive.disabled }
								onClick={ responsive.onClick }
								tooltipSide="bottom"
							/>
						) : null }
					</div>
				) : null }
			</div>
		</div>
	);
}
