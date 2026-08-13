import { __ } from '@wordpress/i18n';
import { privateApis } from '@wordpress/theme';
import { IconButton } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useCallback, useEffect, useState } from 'react';
import { AppMessageCards, AppMessageCardsDot } from '@/components/app-message-cards';
import { AppToasts } from '@/components/app-toasts';
import { GettingStartedChecklist } from '@/components/getting-started-card';
import { ResizeHandle, ResizeOverlay } from '@/components/resize-handle';
import { SidebarHeader } from '@/components/sidebar-header';
import { SiteList } from '@/components/site-list';
import { StudioBetaMenu } from '@/components/studio-beta-menu';
import { UserMenu } from '@/components/user-menu';
import { useConnector } from '@/data/core';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useResizablePanel } from '@/hooks/use-resizable-panel';
import { SidebarCollapsedContext } from '@/hooks/use-sidebar-collapsed';
import { useTrafficLightSpace } from '@/hooks/use-traffic-light-space';
import { drawerIcon } from '@/lib/icons';
import { SIDEBAR_PANEL_CONFIG, SIDEBAR_PANEL_STORAGE_KEY } from '@/lib/resizable-panels';
import { unlock } from '@/lock-unlock';
import styles from './style.module.css';
import type { CSSProperties, ReactNode } from 'react';

const { ThemeProvider } = unlock( privateApis );

// Dark window chrome behind the sidebar and the content frame, mimicking the
// legacy renderer's `bg-chrome` (rgba(30,30,30,1)) and the wp-admin dark
// chrome. Dark mode goes a step deeper so the chrome still contrasts with
// #1e1e1e content surfaces.
const CHROME_BG_LIGHT = '#1e1e1e';
const CHROME_BG_DARK = '#161616';

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
	const chromeBg = colorScheme === 'dark' ? CHROME_BG_DARK : CHROME_BG_LIGHT;
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
								{ ! effectiveCollapsed ? <GettingStartedChecklist /> : null }
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
								<IconButton
									variant="minimal"
									tone="neutral"
									size="small"
									icon={ drawerIcon }
									label={ __( 'Show sidebar' ) }
									onClick={ toggleSidebar }
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
		</SidebarCollapsedContext.Provider>
	);
}
