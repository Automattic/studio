import { __ } from '@wordpress/i18n';
import { privateApis } from '@wordpress/theme';
import { Button, Icon } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useCallback, useEffect, useState } from 'react';
import { AppMessageCards, AppMessageCardsDot } from '@/components/app-message-cards';
import { AppToasts } from '@/components/app-toasts';
import { CollapsedSiteSwitcher } from '@/components/collapsed-site-switcher';
import { ResizeHandle, ResizeOverlay } from '@/components/resize-handle';
import { SidebarHeader } from '@/components/sidebar-header';
import { SeenSessionTimestampsProvider, SiteList } from '@/components/site-list';
import { StudioBetaMenu } from '@/components/studio-beta-menu';
import { UserMenu } from '@/components/user-menu';
import { useConnector } from '@/data/core';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useResizablePanel } from '@/hooks/use-resizable-panel';
import { SidebarCollapsedContext } from '@/hooks/use-sidebar-collapsed';
import { useTrafficLightSpace } from '@/hooks/use-traffic-light-space';
import { drawerIcon } from '@/lib/icons';
import { SIDEBAR_PANEL_CONFIG, SIDEBAR_PANEL_STORAGE_KEY } from '@/lib/resizable-panels';
import { chromeBackground } from '@/lib/window-chrome';
import { unlock } from '@/lock-unlock';
import styles from './style.module.css';
import type { CSSProperties, ReactNode } from 'react';

const { ThemeProvider } = unlock( privateApis );

interface SidebarLayoutProps {
	children: ReactNode;
	// Hides the sidebar without touching the user's own collapsed state, so
	// clearing it restores whatever the sidebar was doing before (e.g. while
	// the site preview is fullscreen). The floating "Show sidebar" toggle is
	// suppressed too — the forcing feature owns the exit affordance.
	forceCollapsed?: boolean;
	// Called when the user asks to toggle the sidebar while it is force-
	// collapsed (the app-menu shortcut), so the forcing feature can stand down.
	// The sidebar expands alongside it.
	onForceCollapsedToggle?: () => void;
}

export function SidebarLayout( {
	children,
	forceCollapsed = false,
	onForceCollapsedToggle,
}: SidebarLayoutProps ) {
	const [ collapsed, setCollapsed ] = useState( false );
	const effectiveCollapsed = collapsed || forceCollapsed;
	const connector = useConnector();
	const reserveTrafficLightSpace = useTrafficLightSpace().start;
	const colorScheme = useColorScheme();
	const chromeBg = chromeBackground( colorScheme );
	const sidebarResize = useResizablePanel( {
		config: SIDEBAR_PANEL_CONFIG,
		edge: 'right',
		storageKey: SIDEBAR_PANEL_STORAGE_KEY,
	} );
	const toggleSidebar = useCallback( () => {
		if ( forceCollapsed ) {
			onForceCollapsedToggle?.();
			setCollapsed( false );
			return;
		}
		setCollapsed( ( value ) => ! value );
	}, [ forceCollapsed, onForceCollapsedToggle ] );
	const sidebarStyle = effectiveCollapsed
		? undefined
		: ( { '--sidebar-width': `${ sidebarResize.width }px` } as CSSProperties );

	useEffect( () => connector.onToggleSidebar( toggleSidebar ), [ connector, toggleSidebar ] );

	return (
		<SidebarCollapsedContext.Provider value={ effectiveCollapsed }>
			{ /* The aside's list and the collapsed switcher's list must agree on
			     which session updates the user has seen, or each mount would
			     re-seed and hide the other's unread indicators. */ }
			<SeenSessionTimestampsProvider>
				<div className={ styles.root } style={ { '--app-chrome-bg': chromeBg } as CSSProperties }>
					<aside
						className={ clsx(
							styles.sidebar,
							effectiveCollapsed && styles.sidebarCollapsed,
							sidebarResize.isResizing && styles.sidebarResizing
						) }
						style={ sidebarStyle }
					>
						{ /* The sidebar sits on the dark window chrome in both color
					     schemes, so its wpds tokens come from a nested dark theme
					     scope. */ }
						<ThemeProvider color={ { bg: chromeBg } }>
							<div className={ styles.sidebarThemeScope }>
								<SidebarHeader />
								<SiteList />
								<div className={ styles.sidebarFooter }>
									{ /* Toasts sit above the persistent cards: the footer is
								     bottom-anchored, so a transient toast arriving below a card
								     would shove it up and drop it back on expiry. */ }
									{ ! effectiveCollapsed ? <AppToasts className={ styles.sidebarToasts } /> : null }
									{ ! effectiveCollapsed ? (
										<AppMessageCards className={ styles.sidebarCards } />
									) : null }
									{ ! effectiveCollapsed ? (
										<StudioBetaMenu className={ styles.sidebarBeta } />
									) : null }
									<UserMenu onToggleSidebar={ toggleSidebar } />
								</div>
							</div>
						</ThemeProvider>
					</aside>
					{ ! effectiveCollapsed ? (
						// Same dark theme scope as the sidebar so the indicator's
						// brand token resolves against the dark ramp.
						<ThemeProvider color={ { bg: chromeBg } }>
							<ResizeHandle
								className={ styles.resizeHandle }
								label={ __( 'Resize sidebar' ) }
								minWidth={ sidebarResize.minWidth }
								maxWidth={ sidebarResize.maxWidth }
								width={ sidebarResize.width }
								isResizing={ sidebarResize.isResizing }
								onResizeStart={ sidebarResize.handleResizeStart }
								onKeyDown={ sidebarResize.handleKeyDown }
							/>
						</ThemeProvider>
					) : null }
					<main className={ styles.main }>
						{ effectiveCollapsed && ! forceCollapsed ? (
							<div
								className={ clsx(
									styles.floatingToggle,
									! reserveTrafficLightSpace && styles.floatingToggleFlush
								) }
							>
								<span className={ styles.floatingToggleButton }>
									<CollapsedSiteSwitcher
										backgroundColor={ chromeBg }
										trigger={
											// Not IconButton: its unconditional tooltip would
											// fight the hover-opened switcher popover. The
											// sizing overrides in `.floatingToggleControl`
											// replicate IconButton's box; see the note in
											// style.module.css.
											<Button
												type="button"
												variant="minimal"
												tone="neutral"
												size="small"
												className={ styles.floatingToggleControl }
												aria-label={ __( 'Show sidebar' ) }
												onClick={ toggleSidebar }
											>
												<Icon
													icon={ drawerIcon }
													size={ 24 }
													className={ styles.floatingToggleIcon }
												/>
											</Button>
										}
									/>
									<AppMessageCardsDot />
								</span>
							</div>
						) : null }
						{ children }
						{ effectiveCollapsed ? (
							<AppToasts
								className={ clsx(
									styles.floatingToasts,
									forceCollapsed && styles.floatingToastsOverPreview
								) }
								fit="content"
							/>
						) : null }
					</main>
					{ sidebarResize.isResizing ? <ResizeOverlay /> : null }
				</div>
			</SeenSessionTimestampsProvider>
		</SidebarCollapsedContext.Provider>
	);
}
